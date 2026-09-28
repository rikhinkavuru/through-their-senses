"""HASPI v2 better-ear for every CPC2 test signal (pyClarity), mirroring the official
CPC2 baseline recipe (recipes/cpc2/baseline/compute_haspi.py):
  - signals read as int16 / 32768, 32 kHz binaural
  - haspi_v2_be(..., listener=Listener) with pyClarity's default level (100 dB SPL at RMS 1)
  - np.random seeded from md5(signal name), as in the recipe
Difference: the recipe's reference is scenes/<scene>_target_ref.wav, which is not in the
CPC2 test release; we use scenes/<scene>_target_anechoic.wav (the binaural anechoic target).

Run with the separate validation env:
  /Users/rikhinkavuru/univabio/validation/.venv/bin/python compute_haspi.py --workers 9
"""

from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_v, "1")

import argparse
import hashlib
import json
import time
from multiprocessing import get_context

import numpy as np
from scipy.io import wavfile

from cpc2_common import DATA, VAL, load_records, read_jsonl, ref_path, signal_path

OUT = VAL / "cache" / "haspi.jsonl"


def work(rec: dict) -> dict:
    import logging

    logging.disable(logging.WARNING)
    from clarity.evaluator.haspi import haspi_v2_be
    from clarity.utils.audiogram import Listener

    listener = Listener.load_listener_dict(DATA / "metadata" / "listeners.json")[rec["listener"]]
    np.random.seed(int(hashlib.md5(rec["signal"].encode("utf-8")).hexdigest(), 16) % (10**8))
    sr_p, proc = wavfile.read(signal_path(rec["signal"]))
    sr_r, ref = wavfile.read(ref_path(rec["scene"]))
    assert sr_p == sr_r
    proc, ref = proc / 32768.0, ref / 32768.0
    t0 = time.time()
    h = haspi_v2_be(
        reference_left=ref[:, 0], reference_right=ref[:, 1],
        processed_left=proc[:, 0], processed_right=proc[:, 1],
        sample_rate=sr_p, listener=listener,
    )
    return dict(signal=rec["signal"], haspi=float(h), t=round(time.time() - t0, 1))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=9)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    done = {r["signal"] for r in read_jsonl(OUT)}
    todo = [r for r in sorted(load_records(), key=lambda r: r["signal"]) if r["signal"] not in done]
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(done)} cached, {len(todo)} to run", flush=True)
    t0 = time.time()
    with get_context("spawn").Pool(a.workers) as pool, OUT.open("a") as fp:
        for i, res in enumerate(pool.imap_unordered(work, todo), 1):
            fp.write(json.dumps(res) + "\n")
            fp.flush()
            if i % 25 == 0 or i == len(todo):
                el = time.time() - t0
                print(f"  {i}/{len(todo)} {el / 60:.1f} min eta {el / i * (len(todo) - i) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
