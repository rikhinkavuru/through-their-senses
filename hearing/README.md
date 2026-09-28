# Hearing service

FastAPI service behind the Hear screen.

- `POST /hear`: one recorded sentence plus an audiogram. Returns what was said, what the listener likely heard, per-letter audibility, and playback audio.
- `POST /score`: candidate sentences, spoken by Kokoro TTS and scored by the same proxy listener.

Pipeline: calibrate to 65 dB SPL, optional babble and NAL-R, Cambridge MSBG hearing loss simulation (vendored from pyClarity, MIT), an internal noise floor at the ISO 226 threshold, then Whisper (small.en) as the proxy listener.

Run locally:

```bash
uv sync
uv run python scripts/make_babble.py   # once
uv run uvicorn app.main:app --port 8765
```

Models live in `models/` (not in git): Kokoro int8 weights and voices, and the faster-whisper small.en and base.en CTranslate2 models (`Systran/faster-whisper-*`). Set `HEARING_TOKEN` to require a bearer token.
