"""Generate an 8-talker babble track with Kokoro TTS (Apache-2.0 weights).

Each talker reads shuffled everyday sentences; tracks are level-matched and summed,
which gives a restaurant-like multi-talker background for the dinner-noise scene.
"""

from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "hearing" / "app" / "assets" / "babble.wav"
SENTENCES = [
    "Did you see the game last night, it went into overtime.",
    "We should try that new place on Main Street next weekend.",
    "My sister is flying in on Tuesday, so the guest room is taken.",
    "Could you pass the salt, and maybe the bread too.",
    "The traffic on the highway was terrible this morning.",
    "I think the meeting got moved to Thursday afternoon.",
    "They finally fixed the roof after the storm.",
    "Have you tried the soup, it is really good tonight.",
    "The kids have a recital at the school on Friday.",
    "I have been meaning to call my brother all week.",
    "We are thinking about getting a dog this spring.",
    "The garden needs rain, the tomatoes are struggling.",
    "Did you hear that the library is closing early.",
    "I would love another cup of coffee if there is any left.",
    "Our flight was delayed three hours because of weather.",
    "She started a new job downtown last month.",
    "That movie was much longer than I expected.",
    "We should book the hotel before the prices go up.",
    "The doctor said everything looks fine this year.",
    "Remember to bring the photos from the trip.",
]
VOICES = ["af_sarah", "am_adam", "bf_emma", "bm_george", "af_nicole", "am_michael", "bf_isabella", "bm_lewis"]
SECONDS = 60


def main() -> None:
    k = Kokoro(str(ROOT / "models" / "kokoro-v1.0.int8.onnx"), str(ROOT / "models" / "voices-v1.0.bin"))
    rng = np.random.default_rng(11)
    tracks = []
    sr = 24000
    for v in VOICES:
        chunks, total = [], 0
        while total < SECONDS * sr:
            for i in rng.permutation(len(SENTENCES)):
                s, sr = k.create(SENTENCES[i], voice=v, speed=float(rng.uniform(0.95, 1.1)), lang="en-gb" if v.startswith("b") else "en-us")
                gap = np.zeros(int(rng.uniform(0.05, 0.4) * sr))
                chunks += [s, gap]
                total += len(s) + len(gap)
                if total >= SECONDS * sr:
                    break
        t = np.concatenate(chunks)[: SECONDS * sr]
        t = np.roll(t, int(rng.integers(0, len(t))))
        tracks.append(t / (np.sqrt(np.mean(t**2)) + 1e-12))
    b = np.sum(tracks, axis=0)
    b = b / np.abs(b).max() * 0.8
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sf.write(OUT, b.astype(np.float32), sr, subtype="PCM_16")
    print(f"wrote {OUT} ({len(b) / sr:.0f} s)")


if __name__ == "__main__":
    main()
