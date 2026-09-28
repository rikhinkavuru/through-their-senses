// Tune findStepEdges on sample scenes: runs depth in Node, prints segments and contrasts,
// and writes an overlay PNG for visual checking.
import { pipeline, RawImage } from "@huggingface/transformers";
import { edgeContrast, findStepEdges } from "../src/lib/vision/hazards.ts";

const out = process.env.OUT_DIR ?? ".";
const depth = await pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { dtype: "q8" });
for (const name of process.argv.slice(2)) {
  const img = await RawImage.read(`public/scenes/${name}.jpg`);
  const small = await img.resize(img.width >= img.height ? 518 : Math.round((img.width / img.height) * 518), img.width >= img.height ? Math.round((img.height / img.width) * 518) : 518);
  const d = await depth(small);
  const dw = d.depth.width, dh = d.depth.height;
  const arr = new Float32Array(dw * dh);
  for (let i = 0; i < arr.length; i++) arr[i] = d.depth.data[i];
  const segs = findStepEdges(arr, dw, dh);
  const rgba = small.rgba();
  const imgData = { width: rgba.width, height: rgba.height, data: rgba.data } as unknown as ImageData;
  console.log(`== ${name} (${dw}x${dh}) ${segs.length} edges`);
  for (const s of segs) console.log(`  y ${((s.y0 + s.y1) / 2).toFixed(2)} x ${s.x0.toFixed(2)}-${s.x1.toFixed(2)} strength ${s.strength.toFixed(3)} contrast ${(edgeContrast(imgData, s) * 100).toFixed(0)}%`);
  // overlay
  const o = rgba.clone();
  for (const s of segs) for (let t = 0; t <= 1; t += 0.002) {
    const x = Math.round((s.x0 + (s.x1 - s.x0) * t) * o.width), y = Math.round((s.y0 + (s.y1 - s.y0) * t) * o.height);
    for (let dy = -1; dy <= 1; dy++) { const k = ((y + dy) * o.width + x) * 4; if (k >= 0 && k < o.data.length) { o.data[k] = 255; o.data[k + 1] = 30; o.data[k + 2] = 30; } }
  }
  await o.save(`${out}/edges-${name}.png`);
}
