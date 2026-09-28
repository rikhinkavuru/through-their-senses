"""Build binocular visual field profiles from the UWHVF dataset.

UWHVF stores every eye in right-eye orientation on an 8x9 grid (24-2 pattern,
6 degree spacing, 100 = untested). In that orientation the columns run from
x = -27 (nasal) to x = +21 degrees, so a left eye mirrored back into visual space
covers x = -21 to +27. We place both eyes on a shared 8x10 grid (x = -27 to +27),
pair same-day tests of both eyes, and merge them with
the best-location rule (Crabb and Viswanathan 1998): at each location the
binocular value is the better of the two eyes.

Outputs:
  web/public/data/fields.json   curated profiles for the app
  data/cache/candidates.png     contact sheet for choosing the demo profile
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "uwhvf" / "alldata.json"
OUT = ROOT / "web" / "public" / "data" / "fields.json"
CACHE = ROOT / "data" / "cache"

UNTESTED = 100.0
# Blind spot in right-eye orientation: rows 3 and 4 (y = +3, -3), column 7 (x = +15).
BLIND_R = [(3, 7), (4, 7)]
X_DEG = [-27 + 6 * c for c in range(10)]
Y_DEG = [21 - 6 * r for r in range(8)]


def to_visual_space(grid: list[list[float]], eye: str) -> np.ndarray:
    """Return an 8x10 TD grid in visual-field coordinates, NaN where untested or blind spot.

    Right eye: stored column c sits at x = -27 + 6c, so it maps to shared column c.
    Left eye: mirrored back, stored column c sits at x = 27 - 6c, shared column 9 - c.
    """
    g = np.array(grid, dtype=float)
    g[g == UNTESTED] = np.nan
    for r, c in BLIND_R:
        g[r, c] = np.nan
    out = np.full((8, 10), np.nan)
    if eye == "R":
        out[:, :9] = g
    else:
        out[:, 1:] = g[:, ::-1]
    return out


def merge_best_location(right: np.ndarray, left: np.ndarray) -> np.ndarray:
    """Best-location binocular merge. Where only one eye is tested, use it."""
    return np.fmax(right, left)


def hemifield_md(g: np.ndarray) -> tuple[float, float, float]:
    sup = np.nanmean(g[:4])
    inf = np.nanmean(g[4:])
    return float(np.nanmean(g)), float(sup), float(inf)


def pair_visits(r_visits: list[dict], l_visits: list[dict], tol_years: float = 0.02) -> list[tuple[dict, dict]]:
    pairs = []
    used = set()
    for rv in r_visits:
        best, best_d = None, tol_years
        for i, lv in enumerate(l_visits):
            d = abs(lv["age"] - rv["age"])
            if i not in used and d <= best_d:
                best, best_d = i, d
        if best is not None:
            used.add(best)
            pairs.append((rv, l_visits[best]))
    return sorted(pairs, key=lambda p: p[0]["age"])


def plr_fit(stack: np.ndarray, ages: np.ndarray) -> np.ndarray:
    """Pointwise linear regression of TD on age; returns fitted grids at each age.

    Test-retest noise in damaged locations is large, so the app renders the fitted
    trend rather than any single noisy test.
    """
    fitted = np.full_like(stack, np.nan)
    for r in range(stack.shape[1]):
        for c in range(stack.shape[2]):
            y = stack[:, r, c]
            ok = ~np.isnan(y)
            if ok.sum() >= 3:
                slope, icpt = np.polyfit(ages[ok], y[ok], 1)
                fitted[:, r, c] = icpt + slope * ages
            elif ok.any():
                fitted[:, r, c] = np.nanmean(y)
    return fitted


def grid_to_list(g: np.ndarray) -> list[list[float | None]]:
    return [[None if np.isnan(v) else round(float(v), 2) for v in row] for row in g]


def main() -> None:
    data = json.loads(RAW.read_text())["data"]
    candidates = []
    for pid, p in data.items():
        if not p.get("R") or not p.get("L"):
            continue
        pairs = pair_visits(p["R"], p["L"])
        if len(pairs) < 4:
            continue
        ages = np.array([rv["age"] for rv, _ in pairs])
        right = np.stack([to_visual_space(rv["td"], "R") for rv, _ in pairs])
        left = np.stack([to_visual_space(lv["td"], "L") for _, lv in pairs])
        bino = np.stack([merge_best_location(r, l) for r, l in zip(right, left)])
        fit_b = plr_fit(bino, ages)
        md, sup, inf = hemifield_md(fit_b[-1])
        md0 = hemifield_md(fit_b[0])[0]
        candidates.append(
            dict(
                pid=pid,
                gender=p.get("gender"),
                ages=ages,
                right=right,
                left=left,
                bino=bino,
                fit=fit_b,
                fit_r=plr_fit(right, ages),
                fit_l=plr_fit(left, ages),
                md=md,
                sup=sup,
                inf=inf,
                slope=(md - md0) / max(ages[-1] - ages[0], 0.5),
                span=float(ages[-1] - ages[0]),
            )
        )
    print(f"{len(candidates)} patients with >=4 paired binocular visits")

    # Demo persona: early 70s at last visit, binocular loss that is real but not total,
    # inferior hemifield clearly worse (falls-relevant, Black 2011), visible progression.
    def demo_score(c: dict) -> float:
        return (c["sup"] - c["inf"]) + 2 * max(0.0, -c["slope"]) * c["span"] / 4

    demo_pool = [
        c
        for c in candidates
        if 67 <= c["ages"][-1] <= 78
        and -14 <= c["md"] <= -2.5
        and c["inf"] < c["sup"] - 2.5
        and c["span"] >= 3
        and len(c["ages"]) >= 4
    ]
    demo_pool.sort(key=demo_score, reverse=True)
    print(f"{len(demo_pool)} demo candidates")

    # Library: a spread of severities for people to explore.
    lib_pool = [c for c in candidates if 60 <= c["ages"][-1] <= 85 and c["span"] >= 3]
    lib_pool.sort(key=lambda c: c["md"])
    bands = [(-30, -18), (-18, -12), (-12, -8), (-8, -5), (-5, -2.5)]
    library = []
    rng = np.random.default_rng(7)
    for lo, hi in bands:
        band = [c for c in lib_pool if lo <= c["md"] < hi and c not in demo_pool[:12]]
        if band:
            for i in rng.choice(len(band), size=min(3, len(band)), replace=False):
                library.append(band[i])

    chosen = demo_pool[:12] + library
    profiles = []
    for c in chosen:
        visits = []
        for i, age in enumerate(c["ages"]):
            visits.append(
                dict(
                    age=round(float(age), 2),
                    binocular=grid_to_list(c["bino"][i]),
                    binocularFit=grid_to_list(c["fit"][i]),
                    right=grid_to_list(c["right"][i]),
                    left=grid_to_list(c["left"][i]),
                    rightFit=grid_to_list(c["fit_r"][i]),
                    leftFit=grid_to_list(c["fit_l"][i]),
                )
            )
        profiles.append(
            dict(
                id=f"uwhvf-{c['pid']}",
                source="UWHVF",
                sourcePatient=c["pid"],
                gender=c["gender"],
                md=round(c["md"], 2),
                supMd=round(c["sup"], 2),
                infMd=round(c["inf"], 2),
                mdSlopePerYear=round(c["slope"], 2),
                demoCandidate=c in demo_pool[:12],
                visits=visits,
            )
        )
    # One small file per profile plus an index with just the latest fitted field,
    # so the app never downloads the whole library to show one person.
    meta = dict(
        grid=dict(xDeg=X_DEG, yDeg=Y_DEG, spacingDeg=6),
        citation="Montesano G, Chen A, Lu R, Lee CS, Lee AY. UWHVF. Transl Vis Sci Technol. 2022;11(1):2. BSD-3-Clause.",
    )
    out_dir = OUT.parent / "fields"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old_file in out_dir.glob("*.json"):
        old_file.unlink()
    index = []
    for prof in profiles:
        (out_dir / f"{prof['id']}.json").write_text(json.dumps({**meta, **prof}, separators=(",", ":")))
        last = prof["visits"][-1]
        index.append({k: prof[k] for k in ("id", "gender", "md", "supMd", "infMd", "mdSlopePerYear", "demoCandidate")}
                     | dict(firstAge=prof["visits"][0]["age"], lastAge=last["age"], nVisits=len(prof["visits"]),
                            preview=last["binocularFit"]))
    OUT.write_text(json.dumps({**meta, "profiles": index}, separators=(",", ":")))
    print(f"wrote {len(profiles)} profiles to {out_dir} and index {OUT} ({OUT.stat().st_size // 1024} KB)")

    # Contact sheet of demo candidates: first vs last fitted binocular field.
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    CACHE.mkdir(parents=True, exist_ok=True)
    n = min(12, len(demo_pool))
    fig, axes = plt.subplots(n, 3, figsize=(7.5, 2.1 * n))
    for i, c in enumerate(demo_pool[:n]):
        for j, (g, title) in enumerate(
            [(c["fit"][0], f"{c['ages'][0]:.0f}y"), (c["fit"][-1], f"{c['ages'][-1]:.0f}y"), (c["bino"][-1], "raw last")]
        ):
            ax = axes[i, j]
            ax.imshow(g, cmap="gray", vmin=-30, vmax=3)
            ax.set_xticks([])
            ax.set_yticks([])
            ax.set_title(
                f"#{i} pid {c['pid']} {title} MD {hemifield_md(g)[0]:.1f}" if j == 0 else title, fontsize=7
            )
    plt.tight_layout()
    fig.savefig(CACHE / "candidates.png", dpi=90)
    print(f"contact sheet at {CACHE / 'candidates.png'}")


if __name__ == "__main__":
    main()
