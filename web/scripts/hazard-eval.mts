// Evaluate findStepEdges on the labelled Commons set (scripts/hazard-set.json).
// Usage: npx tsx scripts/hazard-eval.mts [outDirForOverlays]
// Depth maps are cached in data/cache/hazard-set so re-runs only re-run the edge finder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline, RawImage } from "@huggingface/transformers";
import { findStepEdges } from "../src/lib/vision/hazards.ts";

const set = JSON.parse(readFileSync(new URL("./hazard-set.json", import.meta.url), "utf8")) as { items: { id: string; label: "step" | "none"; split: "dev" | "test"; thumb: string }[] };
const cache = new URL("../../data/cache/hazard-set/", import.meta.url).pathname;
mkdirSync(cache, { recursive: true });
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let depth: Awaited<ReturnType<typeof pipeline>> | null = null;

const rows: { id: string; label: string; split: string; n: number; before: number }[] = [];
for (const it of set.items) {
  const jpg = `${cache}${it.id}.jpg`;
  if (!existsSync(jpg)) {
    const r = await fetch(it.thumb, { headers: { "User-Agent": "ThroughTheirSenses-eval/1.0 (rikhinkavuru@gmail.com)" } });
    writeFileSync(jpg, Buffer.from(await r.arrayBuffer()));
  }
  const img = await RawImage.read(jpg);
  const long = 518;
  const small = await img.resize(img.width >= img.height ? long : Math.round((img.width / img.height) * long), img.width >= img.height ? Math.round((img.height / img.width) * long) : long);
  const bin = `${cache}${it.id}.depth.json`;
  let d: { w: number; h: number; data: number[] };
  if (existsSync(bin)) d = JSON.parse(readFileSync(bin, "utf8"));
  else {
    depth ??= await pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { dtype: "q8" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await (depth as any)(small)).depth;
    d = { w: res.width, h: res.height, data: Array.from(res.data as ArrayLike<number>) };
    writeFileSync(bin, JSON.stringify(d));
  }
  const segs = findStepEdges(Float32Array.from(d.data), d.w, d.h);
  const before = findStepEdges(Float32Array.from(d.data), d.w, d.h, 6, undefined, { stepRule: false });
  rows.push({ id: it.id, label: it.label, split: it.split, n: segs.length, before: before.length });
  if (process.env.FEATURES) for (const s of segs) console.log(`F ${it.label} ${it.id} y=${((s.y0 + s.y1) / 2).toFixed(2)} far=${(s.slopeFar! * 1000).toFixed(2)} near=${(s.slopeNear! * 1000).toFixed(2)} ratio=${(s.slopeFar! / s.slopeNear!).toFixed(2)} str=${s.strength.toFixed(3)} w=${(s.x1 - s.x0).toFixed(2)} x0=${s.x0.toFixed(3)} x1=${s.x1.toFixed(3)} y0=${s.y0.toFixed(3)} y1=${s.y1.toFixed(3)}`);
  if (out) {
    const o = small.rgba().clone();
    for (const s of segs)
      for (let t = 0; t <= 1; t += 0.002) {
        const x = Math.round((s.x0 + (s.x1 - s.x0) * t) * o.width);
        const y = Math.round((s.y0 + (s.y1 - s.y0) * t) * o.height);
        for (let dy = -1; dy <= 1; dy++) {
          const k = ((y + dy) * o.width + x) * 4;
          if (k >= 0 && k < o.data.length) o.data.set([255, 30, 30], k);
        }
      }
    await o.save(`${out}/${it.label}-${it.id}.png`);
  }
}
const summarize = (split: string, key: "n" | "before") => {
  const pos = rows.filter((r) => r.split === split && r.label === "step");
  const neg = rows.filter((r) => r.split === split && r.label === "none");
  return {
    stairPhotos: pos.length,
    stairPhotosWithAnEdge: pos.filter((r) => r[key] > 0).length,
    noStepPhotos: neg.length,
    noStepPhotosWithAFalseEdge: neg.filter((r) => r[key] > 0).length,
    falseEdgesPerNoStepPhoto: +(neg.reduce((s, r) => s + r[key], 0) / neg.length).toFixed(2),
  };
};
const result = {
  generatedBy: "web/scripts/hazard-eval.mts",
  set: "web/scripts/hazard-set.json",
  rule: "STEP_RULE in src/lib/vision/hazards.ts",
  dev: { before: summarize("dev", "before"), after: summarize("dev", "n") },
  test: { before: summarize("test", "before"), after: summarize("test", "n") },
};
console.log(JSON.stringify(result, null, 1));
writeFileSync(new URL("../src/content/hazard-eval.json", import.meta.url), JSON.stringify(result, null, 1) + "\n");
