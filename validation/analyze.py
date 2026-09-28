"""Score cached proxy-listener transcripts against CPC2 listener correctness.

Uses production text normalization / alignment and the production unclear rule
(word probability < 0.4 -> unclear token that never counts as correct).
Run with the validation env:
  /Users/rikhinkavuru/univabio/validation/.venv/bin/python analyze.py
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np
from scipy.optimize import curve_fit
from scipy.stats import pearsonr, spearmanr
from sklearn.model_selection import GroupKFold

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "hearing"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.text import align, normalize_words, words_correct  # noqa: E402  (production, read-only)
from cpc2_common import VAL, load_listeners, load_records, read_jsonl  # noqa: E402

UNCLEAR_P = 0.4  # production value (app/main.py)
N_BOOT = 2000
BOOT_SEED = 0
SUBSET_N = 400
SUBSET_SEED = 20260928
MAIN = "small.en__floor1__off-20"
warnings.filterwarnings("ignore")


# ---------------------------------------------------------------- proxy scoring
def heard_tokens(words: list[dict], thresh: float) -> list[str]:
    """Production _heard_tokens with a configurable threshold."""
    out: list[str] = []
    for w in words:
        toks = normalize_words(w["word"])
        out.extend(toks if w["p"] >= thresh else ["…"] * max(1, len(toks)))
    return out


def ear_scores(rec: dict, words: dict, thresh: float) -> dict[str, float]:
    ref = normalize_words(rec["prompt"])
    return {s: min(words_correct(ref, heard_tokens(words[s], thresh)), rec["n_words"]) / rec["n_words"] * 100 for s in ("left", "right")}


def pta4(levels_by_cf: dict) -> float:
    return float(np.mean([levels_by_cf[f] for f in (500, 1000, 2000, 4000)]))


def listener_pta(ag: dict) -> tuple[float, float]:
    cfs = ag["audiogram_cfs"]
    l = pta4(dict(zip(cfs, ag["audiogram_levels_l"])))
    r = pta4(dict(zip(cfs, ag["audiogram_levels_r"])))
    return l, r


def proxy_pred(recs, cache, lis, thresh=UNCLEAR_P, rule="max"):
    out = []
    for r in recs:
        sc = ear_scores(r, cache[r["signal"]]["words"], thresh)
        if rule == "max":
            out.append(max(sc.values()))
        elif rule == "pta_better":  # production app rule: ear with lower 4-frequency PTA
            l, rr = listener_pta(lis[r["listener"]])
            out.append(sc["left"] if l < rr else sc["right"])
        elif rule == "mean":
            out.append((sc["left"] + sc["right"]) / 2)
    return np.array(out)


# ---------------------------------------------------------------- metrics
def metrics(p, y) -> dict:
    p, y = np.asarray(p, float), np.asarray(y, float)
    d = dict(rmse=float(np.sqrt(np.mean((p - y) ** 2))))
    if np.std(p) > 0:
        d["pearson"] = float(pearsonr(p, y)[0])
        d["spearman"] = float(spearmanr(p, y)[0])
    else:
        d["pearson"] = d["spearman"] = None
    return d


def boot_idx(n: int, seed: int = BOOT_SEED) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, n, size=(N_BOOT, n))


def with_ci(p, y) -> dict:
    p, y = np.asarray(p, float), np.asarray(y, float)
    d = metrics(p, y)
    idx = boot_idx(len(y))
    rm = np.sqrt(np.mean((p[idx] - y[idx]) ** 2, axis=1))
    d["rmse_ci"] = [float(v) for v in np.percentile(rm, [2.5, 97.5])]
    if d["pearson"] is not None:
        pr = [np.corrcoef(p[i], y[i])[0, 1] for i in idx]
        sr = [spearmanr(p[i], y[i])[0] for i in idx]
        d["pearson_ci"] = [float(v) for v in np.nanpercentile(pr, [2.5, 97.5])]
        d["spearman_ci"] = [float(v) for v in np.nanpercentile(sr, [2.5, 97.5])]
    d["n"] = int(len(y))
    return d


def paired_diff(pa, pb, y) -> dict:
    """Bootstrap CI of (A - B) for RMSE and Pearson on the same resampled signals."""
    pa, pb, y = (np.asarray(v, float) for v in (pa, pb, y))
    idx = boot_idx(len(y))
    dr = np.sqrt(np.mean((pa[idx] - y[idx]) ** 2, 1)) - np.sqrt(np.mean((pb[idx] - y[idx]) ** 2, 1))
    dp = np.array([np.corrcoef(pa[i], y[i])[0, 1] - np.corrcoef(pb[i], y[i])[0, 1] for i in idx])
    ma, mb = metrics(pa, y), metrics(pb, y)
    return dict(
        rmse_diff=ma["rmse"] - mb["rmse"], rmse_diff_ci=[float(v) for v in np.percentile(dr, [2.5, 97.5])],
        pearson_diff=ma["pearson"] - mb["pearson"], pearson_diff_ci=[float(v) for v in np.percentile(dp, [2.5, 97.5])],
    )


# ---------------------------------------------------------------- grouped-CV logistic mapping
def logistic(x, x0, k):
    return 100.0 / (1.0 + np.exp(-k * (x - x0)))


def fit_logistic(x, y):
    """Same functional form as the CPC2 baseline (predict.py); multi-start for robustness."""
    s = np.std(x) + 1e-9
    best, best_sse = None, np.inf
    for x0 in np.percentile(x, [25, 50, 75]):
        for k in (4 / s, -4 / s, 1 / s, -1 / s):
            try:
                prm, _ = curve_fit(logistic, x, y, p0=[x0, k], maxfev=20000)
            except RuntimeError:
                continue
            sse = np.sum((logistic(x, *prm) - y) ** 2)
            if sse < best_sse:
                best, best_sse = prm, sse
    return best


def folds(groups):
    return list(GroupKFold(n_splits=5).split(np.zeros(len(groups)), groups=groups))


def cv_logistic(x, y, groups):
    x, y = np.asarray(x, float), np.asarray(y, float)
    oof = np.zeros_like(y)
    for tr, te in folds(groups):
        oof[te] = logistic(x[te], *fit_logistic(x[tr], y[tr]))
    return oof


def cv_mean(y, groups):
    y = np.asarray(y, float)
    oof = np.zeros_like(y)
    for tr, te in folds(groups):
        oof[te] = y[tr].mean()
    return oof


# ---------------------------------------------------------------- word level
def missed_positions(ref: list[str], hyp: list[str]) -> set[int]:
    miss, i = set(), 0
    for r, h in align(ref, hyp):
        if r is None:
            continue
        if r != h:
            miss.add(i)
        i += 1
    return miss


def word_level(recs, cache, lis, thresh=UNCLEAR_P):
    tp = fp = fn = tn = 0
    exp_tp = 0.0
    n_sig = 0
    agree_hits = 0
    for r in recs:
        ref = normalize_words(r["prompt"])
        resp = normalize_words(r.get("response") or "")
        if words_correct(ref, resp) == r["hits"]:
            agree_hits += 1
        if not (0 < r["hits"] < r["n_words"]) or len(ref) != r["n_words"]:
            continue
        n_sig += 1
        words = cache[r["signal"]]["words"]
        sc = ear_scores(r, words, thresh)
        if sc["left"] != sc["right"]:
            ear = max(sc, key=sc.get)
        else:
            l, rr = listener_pta(lis[r["listener"]])
            ear = "left" if l < rr else "right"
        pm = missed_positions(ref, heard_tokens(words[ear], thresh))
        lm = missed_positions(ref, resp)
        n = len(ref)
        tp += len(pm & lm)
        fp += len(pm - lm)
        fn += len(lm - pm)
        tn += n - len(pm | lm)
        exp_tp += len(pm) * len(lm) / n  # random placement of the proxy's misses within the sentence
    prec = tp / (tp + fp) if tp + fp else None
    rec_ = tp / (tp + fn) if tp + fn else None
    f1 = 2 * prec * rec_ / (prec + rec_) if prec and rec_ else None
    n_words = tp + fp + fn + tn
    return dict(
        n_signals=n_sig, n_words=n_words, tp=tp, fp=fp, fn=fn, tn=tn,
        precision=prec, recall=rec_, f1=f1,
        listener_miss_rate=(tp + fn) / n_words, proxy_miss_rate=(tp + fp) / n_words,
        precision_if_random_within_sentence=exp_tp / (tp + fp) if tp + fp else None,
        response_rescoring_agrees_with_hits=agree_hits / len(recs),
    )


# ---------------------------------------------------------------- main
def subset(recs):
    sigs = sorted(r["signal"] for r in recs)
    keep = set(np.random.default_rng(SUBSET_SEED).choice(sigs, size=SUBSET_N, replace=False).tolist())
    return [r for r in recs if r["signal"] in keep]


def load_cache(name):
    return {c["signal"]: c for c in read_jsonl(VAL / "cache" / f"{name}.jsonl")}


def block(recs, pred_by_name: dict) -> dict:
    y = np.array([r["correctness"] for r in recs])
    tracks = np.array([r["track"] for r in recs])
    out = {}
    for nm, p in pred_by_name.items():
        p = np.asarray(p)
        d = with_ci(p, y)
        d["per_track"] = {str(t): with_ci(p[tracks == t], y[tracks == t]) for t in (1, 2, 3)}
        out[nm] = d
    return out


def main():
    recs = sorted(load_records(), key=lambda r: r["signal"])
    lis = load_listeners()
    main_c = load_cache(MAIN)
    missing = [r["signal"] for r in recs if r["signal"] not in main_c]
    assert not missing, f"{len(missing)} signals missing from main cache"
    haspi = {c["signal"]: c["haspi"] for c in read_jsonl(VAL / "cache" / "haspi.jsonl")}
    y = np.array([r["correctness"] for r in recs])
    g = np.array([r["listener"] for r in recs])

    raw = proxy_pred(recs, main_c, lis)
    res = dict(
        n_signals=len(recs), n_listeners=len(set(g)), main_config=MAIN,
        n_per_track={str(t): sum(r["track"] == t for r in recs) for t in (1, 2, 3)},
        cv="5-fold GroupKFold by listener (sklearn, deterministic); logistic 100/(1+exp(-k(x-x0))) fit per training fold",
        bootstrap=f"{N_BOOT} resamples of signals, seed {BOOT_SEED}, percentile 95% CI; calibrated models use fixed out-of-fold predictions",
        folds=[sorted(set(g[te])) for _, te in folds(g)],
    )
    preds = dict(ours_raw=raw, ours_cal=cv_logistic(raw, y, g), mean_baseline=cv_mean(y, g))
    ptas = np.array([min(listener_pta(lis[r["listener"]])) for r in recs])
    preds["pta_cal"] = cv_logistic(ptas, y, g)
    have_haspi = all(r["signal"] in haspi for r in recs)
    if have_haspi:
        hx = np.array([haspi[r["signal"]] for r in recs])
        preds["haspi_cal"] = cv_logistic(hx, y, g)
    res.update(block(recs, preds))
    if have_haspi:
        res["paired_ours_cal_minus_haspi_cal"] = paired_diff(preds["ours_cal"], preds["haspi_cal"], y)
        res["haspi_raw_vs_ours_raw_spearman"] = float(spearmanr(hx, raw)[0])
    res["published"] = dict(
        source="claritychallenge.org/docs/cpc2/cpc2_results (static/cpc2_results.json in github.com/claritychallenge/claritychallenge.github.io); pooled over test.1-3, 897 signals",
        cpc2_baseline_beHASPI=dict(rmse=28.7, pearson=0.70),
        top_E011_cuervo_marxer=dict(rmse=25.1, pearson=0.78, intrusive=False),
        E002_mogridge_whisper=dict(rmse=25.3, pearson=0.77, intrusive=False,
                                   per_track_rmse={"1": 28.2, "2": 23.8, "3": 23.3}, per_track_source="arXiv:2401.13611 Table 1"),
        prior_train_mean=dict(rmse=40.0),
        note="Published systems were trained on the CPC2 training set (disjoint listeners/systems); our calibrated numbers use 5-fold listener-grouped CV on the test set only.",
    )

    # ---------------- full-set cheap ablations (no re-decoding)
    ab = {}
    ab["full_unclear_threshold_none"] = block(recs, {"raw": (p := proxy_pred(recs, main_c, lis, thresh=0.0)), "cal": cv_logistic(p, y, g)})
    ab["full_ear_rule_pta_better (production app rule)"] = block(recs, {"raw": (p := proxy_pred(recs, main_c, lis, rule="pta_better")), "cal": cv_logistic(p, y, g)})
    ab["full_ear_rule_mean"] = block(recs, {"raw": (p := proxy_pred(recs, main_c, lis, rule="mean")), "cal": cv_logistic(p, y, g)})
    off0 = load_cache("small.en__floor1__off+0")
    if all(r["signal"] in off0 for r in recs):
        ab["full_level_0dBFS=120dBSPL (CPC1-recipe as-is input)"] = block(recs, {"raw": (p := proxy_pred(recs, off0, lis)), "cal": cv_logistic(p, y, g)})

    # ---------------- subset ablations (re-decoding)
    sub = subset(recs)
    ys = np.array([r["correctness"] for r in sub])
    gs = np.array([r["listener"] for r in sub])
    subres = {}
    variants = {
        "main (small.en, floor on, p<0.4 unclear)": (MAIN, UNCLEAR_P),
        "unclear threshold none": (MAIN, 0.0),
        "base.en": ("base.en__floor1__off-20", UNCLEAR_P),
        "large-v3-turbo": ("large-v3-turbo__floor1__off-20", UNCLEAR_P),
        "internal noise floor off": ("small.en__floor0__off-20", UNCLEAR_P),
    }
    for nm, (cname, th) in variants.items():
        c = load_cache(cname)
        if not all(r["signal"] in c for r in sub):
            subres[nm] = f"incomplete ({sum(r['signal'] in c for r in sub)}/{len(sub)})"
            continue
        p = proxy_pred(sub, c, lis, thresh=th)
        subres[nm] = dict(raw=with_ci(p, ys), cal=with_ci(cv_logistic(p, ys, gs), ys), mean_pred=float(p.mean()))
    if have_haspi:
        hs = np.array([haspi[r["signal"]] for r in sub])
        subres["HASPI v2 better-ear (reference)"] = dict(cal=with_ci(cv_logistic(hs, ys, gs), ys))
    ab["subset"] = dict(n=len(sub), seed=SUBSET_SEED, n_listeners=len(set(gs)), results=subres)
    res["ablations"] = ab

    res["word_level"] = word_level(recs, main_c, lis)
    res["word_level_unclear_none"] = word_level(recs, main_c, lis, thresh=0.0)
    res["label_mean"] = float(y.mean())
    res["ours_raw_mean_pred"] = float(raw.mean())
    res["ours_raw_frac_100"] = float(np.mean(raw == 100))
    res["label_frac_100"] = float(np.mean(y == 100))
    res["timing_main_s_per_signal"] = dict(
        msbg=float(np.mean([c["t_msbg"] for c in main_c.values()])), asr=float(np.mean([c["t_asr"] for c in main_c.values()])))

    (VAL / "results_full.json").write_text(json.dumps(res, indent=2, default=float))
    # compact print
    for k in ("ours_raw", "ours_cal", "haspi_cal", "pta_cal", "mean_baseline"):
        if k in res:
            d = res[k]
            print(f"{k:14s} RMSE {d['rmse']:.1f} {np.round(d['rmse_ci'],1)}  r {d['pearson'] if d['pearson'] is None else round(d['pearson'],3)}  rho {d['spearman'] if d['spearman'] is None else round(d['spearman'],3)}  | per-track RMSE " + " ".join(f"{d['per_track'][t]['rmse']:.1f}" for t in '123'))
    print(json.dumps(res.get("paired_ours_cal_minus_haspi_cal"), indent=None))
    for k, v in ab.items():
        if k == "subset":
            for nm, d in v["results"].items():
                print("  subset", nm, d if isinstance(d, str) else {kk: (round(dd['rmse'], 1), dd['pearson'] and round(dd['pearson'], 3)) for kk, dd in d.items() if isinstance(dd, dict)})
        else:
            print("  full", k, {kk: (round(dd['rmse'], 1), dd['pearson'] and round(dd['pearson'], 3)) for kk, dd in v.items()})
    print(json.dumps(res["word_level"]))
    print(json.dumps(res["word_level_unclear_none"]))


if __name__ == "__main__":
    main()
