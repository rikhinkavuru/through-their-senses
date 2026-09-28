// Prototype: on-device hazard models on a sample scene (Node, CPU).
import { pipeline, RawImage } from "@huggingface/transformers";
const img = await RawImage.read(process.argv[2] ?? "public/scenes/stairs.jpg");
let t = performance.now();
const depth = await pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { dtype: "q8" });
console.log("depth load", ((performance.now() - t) / 1000).toFixed(1), "s");
t = performance.now();
const d = await depth(img);
console.log("depth run", ((performance.now() - t) / 1000).toFixed(1), "s", d.depth.width, d.depth.height);
await d.depth.save("/private/tmp/claude-502/-Users-rikhinkavuru-univabio/289b7d22-d51a-4b93-a973-e16d069c7782/scratchpad/depth.png");
t = performance.now();
const det = await pipeline("zero-shot-object-detection", "Xenova/owlvit-base-patch32", { dtype: "q8" });
console.log("owl load", ((performance.now() - t) / 1000).toFixed(1), "s");
t = performance.now();
const labels = ["stairs", "step", "rug", "cable", "shoes", "box", "bag", "stool", "chair", "table", "plant pot", "toy", "handrail"];
const out = await det(img, labels, { threshold: 0.08, top_k: 12 });
console.log("owl run", ((performance.now() - t) / 1000).toFixed(1), "s");
console.log(out.map((o) => `${o.label} ${o.score.toFixed(2)} [${Object.values(o.box).map((v) => Math.round(v)).join(",")}]`).join("\n"));
