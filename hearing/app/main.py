"""Hearing service: what she likely hears, and verified rewordings.

POST /hear   one recorded utterance -> aligned "what she likely hears", per-letter
             audibility, and playback audio (you vs her, same gain)
POST /score  candidate sentences -> proxy-listener score for each (TTS, same voice)
GET  /health
"""

from __future__ import annotations

import base64
import io
import json
import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.phonemes import word_audibility
from app.sim import (
    MSBG_FS,
    SPEECH_SPL,
    Listener,
    add_babble,
    for_asr,
    for_playback,
    set_spl,
    simulate,
    to_fs,
    transcribe,
)
from app.text import align, normalize_words, words_correct

UNCLEAR_P = 0.4  # below this word probability the proxy listener is guessing
PLAYBACK_FS = 22050
MAX_SECONDS = 15

app = FastAPI(title="Through Their Senses hearing service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
pool = ThreadPoolExecutor(max_workers=4)


def _wav_b64(sig: np.ndarray, fs_in: int = MSBG_FS) -> str:
    y = to_fs(sig, fs_in, PLAYBACK_FS) if sig.ndim == 1 else np.stack([to_fs(c, fs_in, PLAYBACK_FS) for c in sig], axis=1)
    buf = io.BytesIO()
    sf.write(buf, y, PLAYBACK_FS, format="WAV", subtype="PCM_16")
    return base64.b64encode(buf.getvalue()).decode()


def _listener(left: list[float], right: list[float]) -> Listener:
    if len(left) != 7 or len(right) != 7:
        raise HTTPException(400, "audiograms need 7 thresholds: 500, 1k, 2k, 3k, 4k, 6k, 8k Hz")
    return Listener(left=[float(v) for v in left], right=[float(v) for v in right])


def _heard_tokens(words: list[dict]) -> list[str]:
    """Normalize the proxy listener's words, replacing low-confidence guesses."""
    out: list[str] = []
    for w in words:
        toks = normalize_words(w["word"])
        out.extend(toks if w["p"] >= UNCLEAR_P else ["…"] * max(1, len(toks)))
    return out


def _alignment(ref: list[str], heard: list[str]) -> list[dict]:
    rows = []
    for r, h in align(ref, heard):
        if r is None:
            continue
        if h == r:
            status = "heard"
        elif h is None or h == "…":
            status = "unclear"
        else:
            status = "misheard"
        rows.append(dict(said=r, heard=h, status=status))
    return rows


def _heard_text(heard: list[str]) -> str:
    text, prev = [], None
    for t in heard:
        if t == "…" and prev == "…":
            continue
        text.append(t)
        prev = t
    return " ".join(text)


@app.get("/health")
def health() -> dict:
    return dict(ok=True)


@app.post("/hear")
async def hear(
    audio: UploadFile = File(...),
    left: str = Form(...),
    right: str = Form(...),
    snr: str = Form(""),
    aided: str = Form("false"),
) -> dict:
    raw = await audio.read()
    try:
        x, fs = sf.read(io.BytesIO(raw), dtype="float64")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"could not read audio as WAV: {e}") from e
    if x.ndim > 1:
        x = x.mean(axis=1)
    if len(x) / fs > MAX_SECONDS:
        x = x[: int(MAX_SECONDS * fs)]
    if np.sqrt(np.mean(x**2)) < 1e-4:
        raise HTTPException(422, "recording is silent")

    lis = _listener(json.loads(left), json.loads(right))
    snr_db = float(snr) if snr not in ("", "null", "none") else None
    is_aided = aided.lower() == "true"
    ear = lis.better_ear()

    clean = set_spl(to_fs(x, fs, MSBG_FS), MSBG_FS, SPEECH_SPL)
    scene = add_babble(clean, snr_db) if snr_db is not None else clean
    sim = simulate(x, fs, lis, snr_db, is_aided)

    jobs = {
        "said": pool.submit(transcribe, for_asr(clean)),
        "her": pool.submit(transcribe, for_asr(sim.ears[ear])),
    }
    if snr_db is not None:
        jobs["typical"] = pool.submit(transcribe, for_asr(scene))
    res = {k: v.result() for k, v in jobs.items()}

    ref = normalize_words(" ".join(w["word"] for w in res["said"]))
    if not ref:
        raise HTTPException(422, "no speech detected")
    heard = _heard_tokens(res["her"])
    rows = _alignment(ref, heard)
    thresholds = lis.left if ear == "left" else lis.right
    for row in rows:
        row["audibility"] = word_audibility(row["said"], thresholds, snr_db, is_aided)

    out = dict(
        said=" ".join(ref),
        herText=_heard_text(heard),
        words=rows,
        herCorrect=sum(r["status"] == "heard" for r in rows),
        total=len(rows),
        betterEar=ear,
        audio=dict(you=_wav_b64(for_playback(scene)), her=_wav_b64(np.stack([for_playback(sim.ears["left"]), for_playback(sim.ears["right"])]))),
    )
    if "typical" in res:
        typ = _heard_tokens(res["typical"])
        out["typicalCorrect"] = words_correct(ref, typ)
    return out


class ScoreRequest(BaseModel):
    sentences: list[str] = Field(min_length=1, max_length=6)
    left: list[float]
    right: list[float]
    snr: float | None = None
    aided: bool = False
    voice: str = "af_heart"


@lru_cache(maxsize=1)
def _tts():
    from kokoro_onnx import Kokoro

    base = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
    return Kokoro(os.path.join(base, "kokoro-v1.0.int8.onnx"), os.path.join(base, "voices-v1.0.bin"))


def _score_one(text: str, lis: Listener, snr_db: float | None, aided: bool, voice: str) -> dict:
    samples, fs = _tts().create(text, voice=voice, speed=1.0, lang="en-us")
    sim = simulate(np.asarray(samples, dtype=float), fs, lis, snr_db, aided)
    ref = normalize_words(text)
    heard = _heard_tokens(transcribe(for_asr(sim.ears[lis.better_ear()])))
    rows = _alignment(ref, heard)
    correct = sum(r["status"] == "heard" for r in rows)
    return dict(text=text, correct=correct, total=len(ref), score=round(correct / max(1, len(ref)), 3), herText=_heard_text(heard), words=rows)


@app.post("/score")
def score(req: ScoreRequest) -> dict:
    lis = _listener(req.left, req.right)
    futures = [pool.submit(_score_one, s, lis, req.snr, req.aided, req.voice) for s in req.sentences]
    return dict(results=[f.result() for f in futures])
