"""Apply the pre-registered selection rule in SELECTION.md on the CPC2 training subset.

Run with the validation env and CPC2_SPLIT=train:
  CPC2_SPLIT=train /Users/rikhinkavuru/univabio/validation/.venv/bin/python select_floor.py
"""

from __future__ import annotations

import json
import os

import numpy as np

assert os.environ.get("CPC2_SPLIT") == "train", "run with CPC2_SPLIT=train"

import analyze as A  # noqa: E402
from cpc2_common import VAL, load_listeners, load_records  # noqa: E402

CANDIDATES = {"A_floor_on_v2": "base.en__floor1__off-20__floorv2__train600", "B_floor_off": "base.en__floor0__off-20__train600"}
TIE_MARGIN = 0.5  # percentage points; within this, keep A (principled)

recs = sorted(load_records(), key=lambda r: r["signal"])
lis = load_listeners()
y = np.array([r["correctness"] for r in recs])
g = np.array([r["listener"] for r in recs])
out: dict = dict(n=len(recs), n_listeners=len(set(g)), rule="SELECTION.md", results={})
for key, name in CANDIDATES.items():
    c = A.load_cache(name)
    assert all(r["signal"] in c for r in recs), f"{name} incomplete"
    raw = A.proxy_pred(recs, c, lis)
    cal = A.cv_logistic(raw, y, g)
    out["results"][key] = dict(cal=A.with_ci(cal, y), raw=A.with_ci(raw, y), mean_pred=float(raw.mean()))
a = out["results"]["A_floor_on_v2"]["cal"]["rmse"]
b = out["results"]["B_floor_off"]["cal"]["rmse"]
out["winner"] = "B_floor_off" if b < a - TIE_MARGIN else "A_floor_on_v2"
out["label_mean"] = float(y.mean())
(VAL / "selection_result.json").write_text(json.dumps(out, indent=2, default=float))
for k, v in out["results"].items():
    print(f"{k:16s} cal RMSE {v['cal']['rmse']:.2f} {np.round(v['cal']['rmse_ci'], 1).tolist()}  r {v['cal']['pearson']:.3f}  mean pred {v['mean_pred']:.1f} (labels {out['label_mean']:.1f})")
print("winner:", out["winner"])
