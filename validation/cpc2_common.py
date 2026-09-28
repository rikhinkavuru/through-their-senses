"""Shared CPC2 data access for the validation study (no production code changes)."""

from __future__ import annotations

import json
from pathlib import Path

VAL = Path(__file__).resolve().parent
DATA = VAL / "cpc2_data" / "clarity_CPC2_data" / "clarity_data"
TRACKS = (1, 2, 3)


def load_records() -> list[dict]:
    """All CPC2 test records (labels included), with a `track` field added."""
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
