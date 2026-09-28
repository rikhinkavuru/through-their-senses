"""Shared CPC2 data access for the validation study (no production code changes)."""

from __future__ import annotations

import json
from pathlib import Path

import os

VAL = Path(__file__).resolve().parent
# CPC2_SPLIT=train selects the seeded 600-sentence training subset used for model
# selection (validation/cpc2_train/subset600.txt); the default is the test split.
SPLIT = os.environ.get("CPC2_SPLIT", "test")
DATA = VAL / ("cpc2_train" if SPLIT == "train" else "cpc2_data") / "clarity_CPC2_data" / "clarity_data"
TRACKS = (1, 2, 3)


def load_records() -> list[dict]:
    """CPC2 records (labels included), with a `track` field added."""
    if SPLIT == "train":
        keep = set((VAL / "cpc2_train" / "subset600.txt").read_text().split())
        recs = [dict(r, track=1) for r in json.loads((DATA / "metadata" / "CEC2.train.1.json").read_text()) if r["signal"] in keep]
        assert len(recs) == len(keep), "subset signals missing from train metadata"
        return recs
    recs = []
    for t in TRACKS:
        for r in json.loads((DATA / f"CPC2.test_labels.{t}.json").read_text()):
            r = dict(r)
            r["track"] = t
            recs.append(r)
    sigs = [r["signal"] for r in recs]
    assert len(sigs) == len(set(sigs)), "signals must be unique across tracks"
    return recs


def load_listeners() -> dict:
    return json.loads((DATA / "metadata" / "listeners.json").read_text())


def signal_path(signal: str) -> Path:
    return DATA / "HA_outputs" / "signals" / "CEC2" / f"{signal}.wav"


def ref_path(scene: str) -> Path:
    return DATA / "scenes" / "CEC2" / f"{scene}_target_anechoic.wav"


def read_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    out = []
    for line in p.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:  # a torn last line from an interrupted run
                pass
    return out
