"""Headline validation after the noise-floor fix (v2).

The internal noise floor in hearing/app/sim.py was originally an FIR design that sat
7-9 dB above the ISO 226 threshold at 250-4000 Hz. It now uses exact frequency-domain
shaping. The "__floorv2" caches were decoded with the corrected floor; older caches are
kept as a superseded ablation. Methods (grouped-CV logistic calibration, bootstrap CIs,
paired differences, word-level agreement) are reused from analyze.py unchanged.

Run with the validation env:
  /Users/rikhinkavuru/univabio/validation/.venv/bin/python analyze_v2.py
"""

from __future__ import annotations

import json

import numpy as np

import analyze as A
from cpc2_common import VAL, load_listeners, load_records, read_jsonl

# The noise-floor setting was chosen on the CPC2 training split by the pre-registered
# rule in SELECTION.md (select_floor.py -> selection_result.json). The other setting is
# reported on the full test set as the alternative.
_SEL = json.loads((VAL / "selection_result.json").read_text())
FLOOR_ON = {"small": "small.en__floor1__off-20__floorv2", "base": "base.en__floor1__off-20__floorv2"}
FLOOR_OFF_C = {"small": "small.en__floor0__off-20", "base": "base.en__floor0__off-20"}
CHOSE_OFF = _SEL["winner"] == "B_floor_off"
CHOSEN, ALT = (FLOOR_OFF_C, FLOOR_ON) if CHOSE_OFF else (FLOOR_ON, FLOOR_OFF_C)
SMALL, BASE = CHOSEN["small"], CHOSEN["base"]
SMALL_V1 = "small.en__floor1__off-20"
BASE_V1 = "base.en__floor1__off-20"
KEYS = ("rmse", "pearson", "spearman", "rmse_ci", "pearson_ci", "spearman_ci", "n")


def slim(d: dict) -> dict:
    return {k: d[k] for k in KEYS if k in d}


def main() -> None:
    recs = sorted(load_records(), key=lambda r: r["signal"])
    lis = load_listeners()
    y = np.array([r["correctness"] for r in recs])
    g = np.array([r["listener"] for r in recs])
    haspi = {c["signal"]: c["haspi"] for c in read_jsonl(VAL / "cache" / "haspi.jsonl")}
    small, base = A.load_cache(SMALL), A.load_cache(BASE)
    for name, c in ((SMALL, small), (BASE, base)):
        missing = sum(r["signal"] not in c for r in recs)
        assert missing == 0, f"{name}: {missing} signals missing"

    s_raw = A.proxy_pred(recs, small, lis)
    b_raw = A.proxy_pred(recs, base, lis)
    s_cal = A.cv_logistic(s_raw, y, g)
    b_cal = A.cv_logistic(b_raw, y, g)
    hx = np.array([haspi[r["signal"]] for r in recs])
    h_cal = A.cv_logistic(hx, y, g)
    ptas = np.array([min(A.listener_pta(lis[r["listener"]])) for r in recs])
    p_cal = A.cv_logistic(ptas, y, g)
    m_base = A.cv_mean(y, g)

    res: dict = dict(
        n_signals=len(recs),
        n_listeners=len(set(g)),
        floor_version=("internal noise floor OFF" if CHOSE_OFF else "internal noise floor ON (v2, exact ISO 226 shaping)")
        + "; chosen on the CPC2 training split by the pre-registered rule (SELECTION.md)",
        selection=dict(winner=_SEL["winner"], train_n=_SEL["n"], train_results={k: {"cal_rmse": v["cal"]["rmse"], "cal_pearson": v["cal"]["pearson"]} for k, v in _SEL["results"].items()}),
        cv="5-fold GroupKFold by listener; logistic 100/(1+exp(-k(x-x0))) fit per training fold",
        bootstrap=f"{A.N_BOOT} resamples of signals, seed {A.BOOT_SEED}, percentile 95% CI",
        ours_raw=slim(A.with_ci(s_raw, y)),
        ours_cal=slim(A.with_ci(s_cal, y)),
        production_base_en=dict(raw=slim(A.with_ci(b_raw, y)), cal=slim(A.with_ci(b_cal, y))),
        haspi_cal=slim(A.with_ci(h_cal, y)),
        pta_cal=slim(A.with_ci(p_cal, y)),
        mean_baseline=slim(A.with_ci(m_base, y)),
        paired_ours_cal_minus_haspi_cal=A.paired_diff(s_cal, h_cal, y),
        paired_base_cal_minus_haspi_cal=A.paired_diff(b_cal, h_cal, y),
        paired_base_minus_small=A.paired_diff(b_cal, s_cal, y),
        published=dict(
            source="claritychallenge.org/docs/cpc2/cpc2_results; pooled over test.1-3, 897 signals",
            cpc2_baseline_beHASPI=dict(rmse=28.7, pearson=0.70),
            top_E011_cuervo_marxer=dict(rmse=25.1, pearson=0.78),
            E002_mogridge_whisper=dict(rmse=25.3, pearson=0.77),
            note="Published systems were trained on the CPC2 training set; ours uses only a 2-parameter logistic fitted with listener-grouped CV on the test set.",
        ),
        word_level=A.word_level(recs, small, lis),
        word_level_base_en=A.word_level(recs, base, lis),
    )

    ab: dict = {}
    ab["ear_rule_pta_better (small.en)"] = {
        "cal": slim(A.with_ci(A.cv_logistic(p := A.proxy_pred(recs, small, lis, rule="pta_better"), y, g), y)),
        "raw": slim(A.with_ci(p, y)),
    }
    ab["unclear_threshold_none (small.en)"] = {
        "cal": slim(A.with_ci(A.cv_logistic(p := A.proxy_pred(recs, small, lis, thresh=0.0), y, g), y)),
        "raw": slim(A.with_ci(p, y)),
    }
    for label, name in (("floor_v1_superseded small.en", SMALL_V1), ("floor_v1_superseded base.en", BASE_V1)):
        c = A.load_cache(name)
        if all(r["signal"] in c for r in recs):
            p = A.proxy_pred(recs, c, lis)
            ab[label] = {"raw": slim(A.with_ci(p, y)), "cal": slim(A.with_ci(A.cv_logistic(p, y, g), y))}
    # The setting not chosen, on the full test set.
    alt_label = "alternative: floor ON (v2)" if CHOSE_OFF else "alternative: floor OFF"
    for model in ("small", "base"):
        c = A.load_cache(ALT[model])
        if all(r["signal"] in c for r in recs):
            p = A.proxy_pred(recs, c, lis)
            ab[f"{alt_label}, {model}.en"] = {"raw": slim(A.with_ci(p, y)), "cal": slim(A.with_ci(A.cv_logistic(p, y, g), y))}
    res["ablations"] = ab
    res["label_mean"] = float(y.mean())
    res["ours_raw_mean_pred"] = float(s_raw.mean())
    res["base_raw_mean_pred"] = float(b_raw.mean())

    (VAL / "results.json").write_text(json.dumps(res, indent=2, default=float))
    f = lambda d: f"RMSE {d['rmse']:.1f} [{d['rmse_ci'][0]:.1f}, {d['rmse_ci'][1]:.1f}]  r {d['pearson']:.3f} [{d['pearson_ci'][0]:.3f}, {d['pearson_ci'][1]:.3f}]"
    print("small.en v2 raw ", f(res["ours_raw"]))
    print("small.en v2 cal ", f(res["ours_cal"]))
    print("base.en  v2 raw ", f(res["production_base_en"]["raw"]))
    print("base.en  v2 cal ", f(res["production_base_en"]["cal"]))
    print("HASPI cal       ", f(res["haspi_cal"]))
    print("PTA cal         ", f(res["pta_cal"]))
    print("mean baseline   ", f"RMSE {res['mean_baseline']['rmse']:.1f}")
    for k in ("paired_ours_cal_minus_haspi_cal", "paired_base_cal_minus_haspi_cal", "paired_base_minus_small"):
        d = res[k]
        print(k, f"dRMSE {d['rmse_diff']:.2f} {np.round(d['rmse_diff_ci'], 2).tolist()}  dr {d['pearson_diff']:.3f} {np.round(d['pearson_diff_ci'], 3).tolist()}")
    for k, v in ab.items():
        print(" ", k, {kk: (round(vv["rmse"], 1), round(vv["pearson"], 3)) for kk, vv in v.items() if isinstance(vv, dict) and "rmse" in vv})
    print("word level small", {k: res["word_level"][k] for k in ("precision", "recall", "f1", "precision_if_random_within_sentence")})


if __name__ == "__main__":
    main()
