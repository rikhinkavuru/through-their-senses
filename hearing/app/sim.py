"""Hearing simulation and the proxy listener.

Pipeline for one utterance:
  1. Calibrate: scale the recording so active speech sits at 65 dB SPL, a normal
     conversational level. MSBG treats 0 dBFS RMS as 120 dB SPL.
  2. Optional scene: add multi-talker babble at a chosen signal-to-noise ratio.
  3. Optional hearing aids: NAL-R linear gain prescribed from the audiogram.
  4. MSBG (Cambridge hearing loss simulator) per ear: threshold elevation,
     loudness recruitment, spectral smearing.
  5. Proxy listener: add an internal noise floor at the normal free-field hearing
     threshold (ISO 226:2003), then transcribe with Whisper. Whisper normalizes
     level internally, so without this floor it would "hear" sounds far below any
     human threshold.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

from app.vendor.clarity.audiogram import Audiogram
from app.vendor.clarity.msbg.msbg import Ear
from app.vendor.clarity.nalr import NALR

logging.getLogger("app.vendor").setLevel(logging.WARNING)

MSBG_FS = 44100
ASR_FS = 16000
EQUIV_0DB_SPL = 120.0  # MSBG: equiv_0db_spl (100) + ahr (20)
SPEECH_SPL = 65.0
PLAYBACK_GAIN_DB = 45.0  # same gain for "you" and "her" so relative loudness is honest
AUDIOGRAM_FREQS = np.array([500, 1000, 2000, 3000, 4000, 6000, 8000])

# ISO 226:2003 threshold of hearing, free field, dB SPL, at 1/3-octave centres.
ISO226_F = np.array([20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000,
                     1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500])
ISO226_T = np.array([78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2, 4.4, 3.0,
                     2.2, 2.4, 3.5, 1.7, -1.3, -4.2, -6.0, -5.4, -1.5, 6.0, 12.6, 13.9, 12.3])

BABBLE_PATH = Path(__file__).resolve().parent / "assets" / "babble.wav"
# The proxy listener model. base.en is what the deployed app runs (validated on CPC2
# alongside small.en, which scores slightly better but is too slow for the free tier).
# The same model transcribes the clean recording, which only needs what was said.
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base.en").strip()
REFERENCE_MODEL = os.environ.get("REFERENCE_MODEL", "base.en").strip()
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"


def _model_path(name: str) -> str:
    """Prefer a bundled copy (deployments), fall back to the Hugging Face name (dev)."""
    local = MODEL_DIR / f"faster-whisper-{name}"
    return str(local) if (local / "model.bin").exists() else name


@dataclass
class Listener:
    left: list[float]
    right: list[float]

    def audiogram(self, ear: str) -> Audiogram:
        levels = np.clip(np.array(self.left if ear == "left" else self.right, dtype=float), -10, 90)
        return Audiogram(levels=levels, frequencies=AUDIOGRAM_FREQS)

    def better_ear(self) -> str:
        def pta(t: list[float]) -> float:
            return float(np.mean([t[0], t[1], t[2], t[4]]))

        return "left" if pta(self.left) < pta(self.right) else "right"


def to_fs(x: np.ndarray, fs_in: int, fs_out: int) -> np.ndarray:
    if fs_in == fs_out:
        return x
    g = np.gcd(int(fs_in), int(fs_out))
    return resample_poly(x, fs_out // g, fs_in // g)


def active_rms(x: np.ndarray, fs: int, frame_s: float = 0.02, rel_db: float = -35.0) -> float:
    """RMS over frames within rel_db of the loudest frame (skips pauses)."""
    n = max(1, int(frame_s * fs))
    frames = x[: len(x) // n * n].reshape(-1, n)
    if len(frames) == 0:
        return float(np.sqrt(np.mean(x**2)) + 1e-12)
    e = np.mean(frames**2, axis=1) + 1e-20
    keep = 10 * np.log10(e) >= 10 * np.log10(e.max()) + rel_db
    return float(np.sqrt(np.mean(e[keep])))


def set_spl(x: np.ndarray, fs: int, spl: float) -> np.ndarray:
    target_rms = 10 ** ((spl - EQUIV_0DB_SPL) / 20)
    return x * (target_rms / max(active_rms(x, fs), 1e-12))


@lru_cache(maxsize=1)
def _babble() -> np.ndarray | None:
    if not BABBLE_PATH.exists():
        return None
    import soundfile as sf

    b, fs = sf.read(BABBLE_PATH, dtype="float64")
    if b.ndim > 1:
        b = b.mean(axis=1)
    return to_fs(b, fs, MSBG_FS)


def add_babble(x: np.ndarray, snr_db: float, seed: int = 0) -> np.ndarray:
    b = _babble()
    if b is None:
        raise RuntimeError("babble asset missing; run scripts/make_babble.py")
    rng = np.random.default_rng(seed)
    start = rng.integers(0, max(1, len(b) - len(x)))
    seg = np.resize(b[start:], len(x))
    speech_rms = active_rms(x, MSBG_FS)
    seg = seg * (speech_rms / (np.sqrt(np.mean(seg**2)) + 1e-12)) * 10 ** (-snr_db / 20)
    return x + seg


def _threshold_gain(freqs: np.ndarray) -> np.ndarray:
    """Amplitude gain that shapes unit-variance white noise to the ISO 226 threshold.

    Target: each 1/3-octave band of the noise carries the power of a tone at the
    normal hearing threshold, so sounds below threshold sit at or below 0 dB SNR.
    For unit-variance white noise the one-sided PSD is 2/fs per Hz, so a band of
    width bw carries 2*bw/fs; the gain scales that to the target band power.
    """
    fc = np.clip(freqs, ISO226_F[0], ISO226_F[-1])
    t_db = np.interp(np.log(fc), np.log(ISO226_F), ISO226_T)
    band_power = 10 ** ((t_db - EQUIV_0DB_SPL) / 10)
    bw = fc * (2 ** (1 / 6) - 2 ** (-1 / 6))
    return np.sqrt(band_power * MSBG_FS / (2 * bw))


def internal_noise(n: int, seed: int = 1) -> np.ndarray:
    """Noise at the normal hearing threshold, shaped exactly in the frequency domain.

    (An FIR design cannot follow a target that spans more than 40 dB: the large
    low-frequency gain leaks into the mid frequencies.)
    """
    w = np.random.default_rng(seed).standard_normal(n)
    spec = np.fft.rfft(w)
    spec *= _threshold_gain(np.fft.rfftfreq(n, 1 / MSBG_FS))
    return np.fft.irfft(spec, n)


def nalr_gain(x: np.ndarray, ag: Audiogram) -> np.ndarray:
    nalr = NALR(nfir=220, sample_rate=MSBG_FS)
    fir, _ = nalr.build(ag)
    return nalr.apply(fir, x)


@dataclass
class SimResult:
    calibrated: np.ndarray  # 44.1 kHz mono at 65 dB SPL (plus scene)
    ears: dict[str, np.ndarray]  # MSBG output per ear, same calibration


def simulate(
    audio: np.ndarray,
    fs: int,
    listener: Listener,
    snr_db: float | None = None,
    aided: bool = False,
    ears: tuple[str, ...] = ("left", "right"),
) -> SimResult:
    x = to_fs(np.asarray(audio, dtype=float), fs, MSBG_FS)
    x = set_spl(x, MSBG_FS, SPEECH_SPL)
    if snr_db is not None:
        x = add_babble(x, snr_db)
    out: dict[str, np.ndarray] = {}
    for side in ears:
        ag = listener.audiogram(side)
        y = nalr_gain(x, ag) if aided else x
        ear = Ear(src_pos="ff", sample_rate=MSBG_FS)
        ear.set_audiogram(ag)
        out[side] = np.asarray(ear.process(y)[0])
    return SimResult(calibrated=x, ears=out)


def for_asr(sig: np.ndarray, with_floor: bool = True) -> np.ndarray:
    y = sig + internal_noise(len(sig)) if with_floor else sig
    y = to_fs(y, MSBG_FS, ASR_FS)
    return (y / (np.abs(y).max() + 1e-12) * 0.5).astype(np.float32)


def for_playback(sig: np.ndarray) -> np.ndarray:
    return np.clip(sig * 10 ** (PLAYBACK_GAIN_DB / 20), -1, 1).astype(np.float32)


@lru_cache(maxsize=2)
def whisper(name: str = WHISPER_MODEL):
    from app.vendor.faster_whisper import WhisperModel

    # num_workers lets the service transcribe several recordings in parallel.
    return WhisperModel(_model_path(name), device="cpu", compute_type="int8", num_workers=3)


def transcribe(audio16k: np.ndarray, prompt: str | None = None, model: str = WHISPER_MODEL) -> list[dict]:
    """Return words with timestamps and probabilities.

    No initial prompt and no previous-text conditioning: the proxy listener should
    not be told what was said.
    """
    segments, _ = whisper(model).transcribe(
        audio16k,
        language="en",
        beam_size=5,
        word_timestamps=True,
        condition_on_previous_text=False,
        vad_filter=False,
        initial_prompt=prompt,
    )
    words = []
    for s in segments:
        for w in s.words or []:
            words.append(dict(word=w.word.strip(), start=round(w.start, 2), end=round(w.end, 2), p=round(w.probability, 3)))
    return words
