// Tune the step finder on the desktop (5:3) crop of the stairs photo, as the Walk screen sees it.
import { pipeline, RawImage } from "@huggingface/transformers";
import { edgeContrast, findStepEdges } from "../src/lib/vision/hazards.ts";
const out = process.env.OUT_DIR ?? ".";
const depth = await pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { dtype: "q8" });
const img = await RawImage.read("public/scenes/stairs.jpg"); // 1200x1600 portrait
const cropW = img.width, cropH = Math.round(img.width * 3 / 5);
const y0 = Math.min(img.height - cropH, Math.max(0, Math.round(0.72 * img.height - cropH / 2)));
const crop = await img.crop([0, y0, cropW - 1, y0 + cropH - 1]);
const small = await crop.resize(518, Math.round(518 * cropH / cropW));
const d = await depth(small);
const arr = Float32Array.from(d.depth.data);
await d.depth.save(`${out}/depth-crop.png`); await small.save(`${out}/src-crop.png`);
const dbg: { peaks?: number; chains?: number[] } = {};
const segs = findStepEdges(arr, d.depth.width, d.depth.height, 6, dbg);
console.log("peaks", dbg.peaks, "chains", dbg.chains?.sort((a, b) => b - a).slice(0, 12));
const rgba = small.rgba();
const imgData = { width: rgba.width, height: rgba.height, data: rgba.data } as unknown as ImageData;
console.log(`${d.depth.width}x${d.depth.height} ${segs.length} edges`);
for (const s of segs) console.log(`  (${s.x0.toFixed(2)},${s.y0.toFixed(2)})-(${s.x1.toFixed(2)},${s.y1.toFixed(2)}) strength ${s.strength.toFixed(3)} contrast ${(edgeContrast(imgData, s) * 100).toFixed(0)}%`);
const o = rgba.clone();
for (const s of segs) for (let t = 0; t <= 1; t += 0.002) {
  const x = Math.round((s.x0 + (s.x1 - s.x0) * t) * o.width), y = Math.round((s.y0 + (s.y1 - s.y0) * t) * o.height);
  for (let dy = -1; dy <= 1; dy++) { const k = ((y + dy) * o.width + x) * 4; if (k >= 0 && k < o.data.length) { o.data[k] = 255; o.data[k + 1] = 30; o.data[k + 2] = 30; } }
}
await o.save(`${out}/edges-crop.png`);
