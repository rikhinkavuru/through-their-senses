"""Build audiogram profiles from NHANES 2017-2018 audiometry (public domain).

Outputs web/public/data/audiograms.json with:
  - demo: real individual audiograms aged 70-76 with mild-to-moderate, sloping,
    mildly asymmetric loss (so the seating planner has a better ear to pick)
  - typical: k-means centroids of all 60-80 year old audiograms, labeled by WHO
    2021 hearing-loss grade of the better-ear four-frequency average
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "public" / "data" / "audiograms.json"

FREQS = [500, 1000, 2000, 3000, 4000, 6000, 8000]
CODES = ["500", "1K1", "2K", "3K", "4K", "6K", "8K"]
RIGHT = [f"AUXU{c}R" for c in CODES]
LEFT = [f"AUXU{c}L" for c in CODES]


def who_grade(pta: float) -> str:
    # WHO World Report on Hearing (2021), better-ear 0.5/1/2/4 kHz average.
    for limit, name in [(20, "No hearing loss"), (35, "Mild"), (50, "Moderate"), (65, "Moderately severe"), (80, "Severe"), (95, "Profound")]:
        if pta < limit:
            return name
    return "Complete"


def pta4(t: np.ndarray) -> float:
    return float(np.mean([t[0], t[1], t[2], t[4]]))


def kmeans(x: np.ndarray, k: int, seed: int = 3, iters: int = 100) -> np.ndarray:
    rng = np.random.default_rng(seed)
    centers = x[rng.choice(len(x), k, replace=False)]
    for _ in range(iters):
        labels = ((x[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        new = np.stack([x[labels == i].mean(0) if (labels == i).any() else centers[i] for i in range(k)])
        if np.allclose(new, centers):
            break
        centers = new
    return centers


def main() -> None:
    aux = pd.read_sas(RAW / "AUX_J.XPT")
    demo = pd.read_sas(RAW / "DEMO_J.XPT")[["SEQN", "RIDAGEYR", "RIAGENDR"]]
    df = aux.merge(demo, on="SEQN").dropna(subset=RIGHT + LEFT)
    # 666 = no response, 888 = could not obtain; keep valid thresholds only.
    df = df[(df[RIGHT + LEFT] <= 120).all(axis=1)]

    old = df[(df.RIDAGEYR >= 60) & (df.RIDAGEYR <= 80)]
    r = old[RIGHT].to_numpy(float)
    l = old[LEFT].to_numpy(float)
    better = np.where(np.array([pta4(a) for a in r])[:, None] <= np.array([pta4(b) for b in l])[:, None], r, l)
    centers = kmeans(better, 6)
    centers = centers[np.argsort([pta4(c) for c in centers])]
    typical = [
        dict(
            id=f"nhanes-typical-{i}",
            label=f"{who_grade(pta4(c))} (typical profile {i + 1})",
            grade=who_grade(pta4(c)),
            pta4=round(pta4(c), 1),
            right=[round(float(v)) for v in c],
            left=[round(float(v)) for v in c],
            source="k-means centroid of NHANES 2017-2018 better-ear audiograms, ages 60-80",
        )
        for i, c in enumerate(centers)
    ]

    cand = df[(df.RIDAGEYR >= 70) & (df.RIDAGEYR <= 76)].copy()
    rows = []
    for _, row in cand.iterrows():
        rt = row[RIGHT].to_numpy(float)
        lt = row[LEFT].to_numpy(float)
        pr, pl = pta4(rt), pta4(lt)
        better_pta = min(pr, pl)
        slope = (np.mean([rt[4], lt[4]]) - np.mean([rt[0], lt[0]]))
        asym = abs(np.mean(rt[2:5]) - np.mean(lt[2:5]))
        if 25 <= better_pta <= 45 and slope >= 20 and 8 <= asym <= 20:
            rows.append((row, rt, lt, better_pta, slope, asym))
    rows.sort(key=lambda t: abs(t[3] - 34) + abs(t[5] - 12) / 2)
    demos = [
        dict(
            id=f"nhanes-{int(row.SEQN)}",
            age=int(row.RIDAGEYR),
            sex="F" if row.RIAGENDR == 2 else "M",
            right=[int(v) for v in rt],
            left=[int(v) for v in lt],
            betterEar="right" if pta4(rt) <= pta4(lt) else "left",
            grade=who_grade(better_pta),
            pta4=round(better_pta, 1),
            source="NHANES 2017-2018 audiometry (CDC/NCHS), individual record",
        )
        for row, rt, lt, better_pta, slope, asym in rows[:8]
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            dict(
                freqs=FREQS,
                citation="CDC/NCHS National Health and Nutrition Examination Survey 2017-2018, Audiometry (AUX_J). Public domain.",
                demo=demos,
                typical=typical,
            ),
            indent=1,
        )
    )
    print(f"{len(rows)} demo candidates; wrote {len(demos)} demo + {len(typical)} typical to {OUT}")
    for d in demos[:4]:
        print(d["id"], d["age"], d["sex"], d["betterEar"], d["pta4"], "R", d["right"], "L", d["left"])
    for t in typical:
        print(t["label"], t["right"])


if __name__ == "__main__":
    main()
