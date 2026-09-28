"""Run the production proxy listener on every CPC2 test signal.

Per signal: HA-output wav (32 kHz, binaural) -> 44.1 kHz -> optional level offset ->
MSBG per ear with that listener's audiogram for that ear -> production internal
noise floor (sim.for_asr) -> faster-whisper (production decode settings) per ear.
Raw Whisper words (with probabilities) are cached as JSONL, one line per signal,
so reruns are incremental and scoring rules can be changed without re-decoding.

Run from the hearing env (read-only import of production code):
  cd /Users/rikhinkavuru/univabio/hearing && uv run python ../validation/run_cpc2.py [opts]
"""

from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_v, "1")

import argparse
import json
import sys
import time
from multiprocessing import get_context
from pathlib import Path

import numpy as np

HEARING = Path(__file__).resolve().parents[1] / "hearing"
sys.path.insert(0, str(HEARING))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cpc2_common import VAL, load_listeners, load_records, read_jsonl, signal_path  # noqa: E402

_CFG: dict = {}
_MODEL = None


def subset_signals(records: list[dict], n: int, seed: int = 20260928) -> set[str]:
    sigs = sorted(r["signal"] for r in records)
    rng = np.random.default_rng(seed)
    return set(rng.choice(sigs, size=min(n, len(sigs)), replace=False).tolist())


def config_name(model: str, floor: bool, level_offset_db: float) -> str:
    return f"{model}__floor{int(floor)}__off{level_offset_db:+.0f}"


def _init(cfg: dict) -> None:
    global _MODEL
    _CFG.update(cfg)
    import logging

    logging.getLogger("app.vendor").setLevel(logging.WARNING)
    logging.getLogger("app.vendor.faster_whisper").setLevel(logging.WARNING)
    from app.vendor.faster_whisper import WhisperModel

    from app import sim

    _MODEL = WhisperModel(cfg["model"], device="cpu", compute_type="int8", cpu_threads=cfg["threads"], num_workers=1)
    sim.whisper = lambda *a, **k: _MODEL  # production transcribe() looks this up at call time


def _msbg(signal: str, ag: dict) -> dict[str, np.ndarray]:
    """MSBG per ear, cached on disk (float32, 44.1 kHz) keyed by signal + level offset."""
    import soundfile as sf

    from app.sim import MSBG_FS, to_fs
    from app.vendor.clarity.audiogram import Audiogram
    from app.vendor.clarity.msbg.msbg import Ear

    off = _CFG["level_offset_db"]
    cdir = VAL / "msbg_cache" / f"off{off:+.0f}"
    cpath = cdir / f"{signal}.npz"
    if cpath.exists():
        try:
            z = np.load(cpath)
            return {"left": z["left"].astype(np.float64), "right": z["right"].astype(np.float64)}
        except Exception:  # noqa: BLE001  torn file from an interrupted run
            pass
    x, fs = sf.read(signal_path(signal), dtype="float64")  # int16 / 32768, as in the Clarity recipes
    assert x.ndim == 2 and x.shape[1] == 2
    x = x * 10 ** (off / 20)
    freqs = np.array(ag["audiogram_cfs"], dtype=float)
    out = {}
    for i, side in enumerate(("left", "right")):
        # Same clipping of audiogram levels as production Listener.audiogram().
        lv = np.clip(np.array(ag["audiogram_levels_l" if side == "left" else "audiogram_levels_r"], dtype=float), -10, 90)
        ear = Ear(src_pos="ff", sample_rate=MSBG_FS)  # production settings: equiv_0db_spl 100 + ahr 20
        ear.set_audiogram(Audiogram(levels=lv, frequencies=freqs))
        out[side] = np.asarray(ear.process(to_fs(x[:, i], fs, MSBG_FS))[0])
    cdir.mkdir(parents=True, exist_ok=True)
    tmp = cdir / f"{signal}.tmp.npz"
    np.savez(tmp, left=out["left"].astype(np.float32), right=out["right"].astype(np.float32))
    os.replace(tmp, cpath)
    return out


def work(item: tuple[str, dict]) -> dict:
    from app.sim import for_asr, transcribe

    signal, ag = item
    t0 = time.time()
    ears = _msbg(signal, ag)
    t1 = time.time()
    res = {}
    for side in ("left", "right"):
        res[side] = transcribe(for_asr(ears[side], with_floor=_CFG["floor"]))
    return dict(signal=signal, words=res, t_msbg=round(t1 - t0, 2), t_asr=round(time.time() - t1, 2))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--no-floor", action="store_true")
    ap.add_argument("--level-offset-db", type=float, default=0.0)
    ap.add_argument("--subset", type=int, default=0, help="fixed seeded subset size (0 = all)")
    ap.add_argument("--limit", type=int, default=0, help="debug: stop after N new signals")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--threads", type=int, default=1, help="CTranslate2 threads per worker")
    a = ap.parse_args()

    recs = load_records()
    lis = load_listeners()
    todo = sorted(recs, key=lambda r: r["signal"])
    if a.subset:
        keep = subset_signals(recs, a.subset)
        todo = [r for r in todo if r["signal"] in keep]
    name = config_name(a.model, not a.no_floor, a.level_offset_db)
    out = VAL / "cache" / f"{name}.jsonl"
    done = {r["signal"] for r in read_jsonl(out)}
    todo = [r for r in todo if r["signal"] not in done]
    if a.limit:
        todo = todo[: a.limit]
    print(f"[{name}] {len(done)} cached, {len(todo)} to run", flush=True)
    if not todo:
        return
    cfg = dict(model=a.model, floor=not a.no_floor, level_offset_db=a.level_offset_db, threads=a.threads)
    items = [(r["signal"], lis[r["listener"]]) for r in todo]
    t0 = time.time()
    with get_context("spawn").Pool(a.workers, initializer=_init, initargs=(cfg,)) as pool, out.open("a") as fp:
        for i, res in enumerate(pool.imap_unordered(work, items, chunksize=1), 1):
            res["config"] = cfg
            fp.write(json.dumps(res) + "\n")
            fp.flush()
            if i % 25 == 0 or i == len(items):
                el = time.time() - t0
                print(f"  {i}/{len(items)}  {el / 60:.1f} min  eta {el / i * (len(items) - i) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
