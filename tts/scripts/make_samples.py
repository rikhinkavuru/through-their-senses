"""Sample sentences for the Hear screen, spoken by Kokoro TTS (Apache-2.0 weights).

Lets people try the hearing model without a microphone. Labelled as a synthetic
voice in the app.
"""

import json
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "web" / "public" / "voices"
SAMPLES = [
    ("pickup", "I'll pick you up at fifteen past six on Thursday.", "am_michael"),
    ("pills", "Your pills are on the shelf next to the sink.", "af_sarah"),
    ("soup", "Do you want soup or salad with your fish?", "am_adam"),
    ("doctor", "The doctor's office moved your appointment to Friday.", "af_heart"),
]


def main() -> None:
    k = Kokoro(str(ROOT / "models" / "kokoro-v1.0.int8.onnx"), str(ROOT / "models" / "voices-v1.0.bin"))
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for sid, text, voice in SAMPLES:
        s, sr = k.create(text, voice=voice, speed=0.95, lang="en-us")
        y = resample_poly(np.asarray(s, dtype=float), 2, 3)  # 24 kHz -> 16 kHz
        y = y / (np.abs(y).max() + 1e-9) * 0.8
        pad = np.zeros(int(0.25 * 16000))
        sf.write(OUT / f"{sid}.wav", np.concatenate([pad, y, pad]).astype(np.float32), 16000, subtype="PCM_16")
        index.append(dict(id=sid, text=text, voice=voice))
    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    print(f"wrote {len(index)} samples to {OUT}")


if __name__ == "__main__":
    main()
