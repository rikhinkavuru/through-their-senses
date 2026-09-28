"""Speech synthesis for scoring rewordings.

POST /tts  sentences -> WAV audio (base64), all in the same Kokoro voice so the hearing
           service can compare an original sentence with its rewordings fairly.
"""

from __future__ import annotations

import base64
import io
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

MODELS = Path(__file__).resolve().parents[1] / "models"
TOKEN = os.environ.get("TTS_TOKEN", "")
VOICES = {"af_heart", "am_michael", "af_sarah", "am_adam", "bf_emma", "bm_george"}

app = FastAPI(title="Through Their Senses TTS")


@app.middleware("http")
async def require_token(request: Request, call_next):
    if TOKEN and request.url.path != "/health" and request.headers.get("authorization") != f"Bearer {TOKEN}":
        return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


@lru_cache(maxsize=1)
def kokoro():
    from kokoro_onnx import Kokoro

    return Kokoro(str(MODELS / "kokoro-v1.0.int8.onnx"), str(MODELS / "voices-v1.0.bin"))


class TtsRequest(BaseModel):
    sentences: list[str] = Field(min_length=1, max_length=6)
    voice: str = "af_heart"


@app.get("/health")
def health() -> dict:
    return dict(ok=True)


@app.post("/tts")
def tts(req: TtsRequest) -> dict:
    if req.voice not in VOICES:
        raise HTTPException(400, "unknown voice")
    out = []
    for text in req.sentences:
        text = text.strip()[:300]
        samples, fs = kokoro().create(text, voice=req.voice, speed=1.0, lang="en-us")
        buf = io.BytesIO()
        sf.write(buf, np.asarray(samples, dtype=np.float32), fs, format="WAV", subtype="PCM_16")
        out.append(dict(text=text, wav=base64.b64encode(buf.getvalue()).decode()))
    return dict(results=out)
