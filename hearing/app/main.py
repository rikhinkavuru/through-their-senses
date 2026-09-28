"""Hearing service: what she likely hears, and verified rewordings.

POST /hear   one recorded utterance -> aligned "what she likely hears", per-letter
             audibility, and playback audio (you vs her, same gain)
POST /score_audio  sentences spoken by the TTS service -> proxy-listener score for each
GET  /health
"""

from __future__ import annotations

import base64
import io
import json
import os
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.phonemes import word_audibility
from app.sim import (
    MSBG_FS,
    REFERENCE_MODEL,
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
from app.text import align, align_for_display, normalize_words, words_correct

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
pool = ThreadPoolExecutor(max_workers=3)  # per-request work items
# Separate pool for per-ear transcription, so items waiting on their ears can't starve it.
asr_pool = ThreadPoolExecutor(max_workers=4)
TOKEN = os.environ.get("HEARING_TOKEN", "")


@app.middleware("http")
async def require_token(request, call_next):
    """When HEARING_TOKEN is set, only the web app (which holds it) may call the service."""
    if TOKEN and request.url.path not in ("/health", "/warm") and request.headers.get("authorization") != f"Bearer {TOKEN}":
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


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


def _heard_display(ref: list[str], heard: list[str]) -> list[dict]:
    """Every heard token in order, marked ok / wrong / unclear, for the transcript view."""
    out: list[dict] = []
    prev_unclear = False
    for r, h in align_for_display(ref, heard):
        if h is None:
            continue
        if h == "…":
            if not prev_unclear:
                out.append(dict(w="…", s="unclear"))
            prev_unclear = True
            continue
        prev_unclear = False
        out.append(dict(w=h, s="ok" if h == r else "wrong", said=r))
    return out


def _heard_text(heard: list[str]) -> str:
    text, prev = [], None
    for t in heard:
        if t == "…" and prev == "…":
            continue
        text.append(t)
        prev = t
    return " ".join(text)


@app.get("/warm")
def warm() -> dict:
    """Load models ahead of the first recording (the Hear screen calls this on open)."""
    from app.sim import REFERENCE_MODEL as ref_model, WHISPER_MODEL, _babble, whisper

    whisper(WHISPER_MODEL)
    whisper(ref_model)
    _babble()
    return dict(ok=True)


@app.get("/health")
def health() -> dict:
    return dict(ok=True, cpus=os.cpu_count())


def _better_ear_listen(sim, ref: list[str], pta_better: str) -> tuple[list[str], list[dict], str]:
    """Listen with each ear in parallel and keep the ear that catches more words.

    This better-ear rule is the configuration validated on CPC2 (see validation/RESULTS.md).
    Ties go to the ear with the better audiogram.
    """
    futures = {side: asr_pool.submit(transcribe, for_asr(sig)) for side, sig in sim.ears.items()}
    best: tuple[int, int, str, list[str], list[dict]] | None = None
    for side, fut in futures.items():
        heard = _heard_tokens(fut.result())
        rows = _alignment(ref, heard)
        correct = sum(r["status"] == "heard" for r in rows)
        key = (correct, 1 if side == pta_better else 0)
        if best is None or key > best[:2]:
            best = (key[0], key[1], side, heard, rows)
    assert best is not None
    return best[3], best[4], best[2]


def _read_upload(raw: bytes) -> tuple[np.ndarray, int]:
    try:
        x, fs = sf.read(io.BytesIO(raw), dtype="float64")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"could not read audio as WAV: {e}") from e
    if x.ndim > 1:
        x = x.mean(axis=1)
    if len(x) / fs > MAX_SECONDS:
        x = x[: int(MAX_SECONDS * fs)]
    if len(x) == 0 or np.sqrt(np.mean(x**2)) < 1e-4:
        raise HTTPException(422, "recording is silent")
    return x, fs


@app.post("/hear")
def hear(
    audio: UploadFile = File(...),
    left: str = Form(...),
    right: str = Form(...),
    snr: str = Form(""),
    aided: str = Form("false"),
):
    """Stream newline-delimited JSON events as each stage finishes:

    said   what was said, with per-letter audibility (fast: reference transcript)
    her    what she likely heard, word alignment and her playback audio
    typical  (noise only) how many words a listener with typical hearing catches
    done
    """
    # A plain def: FastAPI runs it in a worker thread, so transcription never blocks the event loop.
    x, fs = _read_upload(audio.file.read())
    lis = _listener(json.loads(left), json.loads(right))
    snr_db = float(snr) if snr not in ("", "null", "none") else None
    is_aided = aided.lower() == "true"
    ear = lis.better_ear()
    thresholds = lis.left if ear == "left" else lis.right

    clean = set_spl(to_fs(x, fs, MSBG_FS), MSBG_FS, SPEECH_SPL)
    scene = add_babble(clean, snr_db) if snr_db is not None else clean
    said_words = transcribe(for_asr(clean), None, REFERENCE_MODEL)
    ref = normalize_words(" ".join(w["word"] for w in said_words))
    if not ref:
        raise HTTPException(422, "no speech detected")

    def events():
        yield json.dumps(
            dict(
                type="said",
                said=" ".join(ref),
                words=[dict(said=r, audibility=word_audibility(r, thresholds, snr_db, is_aided)) for r in ref],
                betterEar=ear,
                audio=dict(you=_wav_b64(for_playback(scene))),
            )
        ) + "\n"
        sim = simulate(x, fs, lis, snr_db, is_aided)
        heard, rows, ear_used = _better_ear_listen(sim, ref, ear)
        for row in rows:
            row["audibility"] = word_audibility(row["said"], thresholds, snr_db, is_aided)
        yield json.dumps(
            dict(
                type="her",
                herText=_heard_text(heard),
                heardTokens=_heard_display(ref, heard),
                words=rows,
                herCorrect=sum(r["status"] == "heard" for r in rows),
                total=len(rows),
                earUsed=ear_used,
                audio=dict(her=_wav_b64(np.stack([for_playback(sim.ears["left"]), for_playback(sim.ears["right"])]))),
            )
        ) + "\n"
        if snr_db is not None:
            # Same chain, same scene, same noise; only the audiogram differs (0 dB HL), so one ear is enough.
            typ = simulate(x, fs, Listener(left=[0.0] * 7, right=[0.0] * 7), snr_db, False, ears=("right",))
            yield json.dumps(dict(type="typical", typicalCorrect=words_correct(ref, _heard_tokens(transcribe(for_asr(typ.ears["right"])))))) + "\n"
        yield json.dumps(dict(type="done")) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


class ScoreItem(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    wav: str = Field(description="base64 WAV of the sentence spoken by the TTS service")


class ScoreRequest(BaseModel):
    items: list[ScoreItem] = Field(min_length=1, max_length=6)
    left: list[float]
    right: list[float]
    snr: float | None = None
    aided: bool = False


def _score_one(item: ScoreItem, lis: Listener, snr_db: float | None, aided: bool) -> dict:
    x, fs = sf.read(io.BytesIO(base64.b64decode(item.wav)), dtype="float64")
    if x.ndim > 1:
        x = x.mean(axis=1)
    sim = simulate(x, fs, lis, snr_db, aided)
    ref = normalize_words(item.text)
    heard, rows, _ = _better_ear_listen(sim, ref, lis.better_ear())
    correct = sum(r["status"] == "heard" for r in rows)
    return dict(text=item.text, correct=correct, total=len(ref), score=round(correct / max(1, len(ref)), 3), herText=_heard_text(heard), words=rows)


@app.post("/score_audio")
def score_audio(req: ScoreRequest) -> dict:
    """Score sentences already spoken by the TTS service, through this listener's hearing."""
    lis = _listener(req.left, req.right)
    futures = [pool.submit(_score_one, it, lis, req.snr, req.aided) for it in req.items]
    return dict(results=[f.result() for f in futures])
