"""Copy the headline validation numbers into the web app (web/src/content/validation.json)."""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
res = json.loads((HERE / "results.json").read_text())
keep = ["n_signals", "n_listeners", "ours_raw", "ours_cal", "production_base_en", "haspi_cal", "pta_cal", "mean_baseline", "published", "word_level"]
out = {k: res[k] for k in keep if k in res}
ours, haspi = res.get("ours_cal", {}), res.get("haspi_cal", {})
if ours and haspi:
    out["summary"] = (
        f"Without any training beyond a two-number calibration, the proxy listener's predictions track what real listeners understood "
        f"(correlation {ours['pearson']:.2f}) more closely than HASPI does ({haspi['pearson']:.2f}), with lower error "
        f"({ours['rmse']:.1f} vs {haspi['rmse']:.1f} percentage points). The best published systems, trained on CPC2 data, reach 25.1 and 0.78."
    )
dest = HERE.parent / "web" / "src" / "content" / "validation.json"
dest.write_text(json.dumps(out, indent=1))
print(f"wrote {dest}")
