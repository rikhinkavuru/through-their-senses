/// <reference lib="webworker" />
// Monocular depth (Depth Anything V2 small, 8-bit weights) in a worker so the page stays responsive.
// The photo never leaves the device; only the model weights are downloaded, once, then cached.
import { pipeline, RawImage, type DepthEstimationPipeline } from "@huggingface/transformers";

let loading: Promise<DepthEstimationPipeline> | null = null;

function load() {
  loading ??= pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status: string; progress?: number; loaded?: number; total?: number; file?: string }) => {
      if (p.status === "progress") self.postMessage({ type: "progress", loaded: p.loaded ?? 0, total: p.total ?? 0, file: p.file });
    },
  }) as Promise<DepthEstimationPipeline>;
  // A failed download must not poison every later scan.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

self.onmessage = async (e: MessageEvent<{ id: number; width: number; height: number; data: Uint8ClampedArray }>) => {
  const { id, width, height, data } = e.data;
  try {
    const pipe = await load();
    self.postMessage({ type: "status", id, status: "running" });
    const out = (await pipe(new RawImage(data, width, height, 4))) as { depth: RawImage };
    const d = out.depth;
    const depth = new Float32Array(d.data.length);
    for (let i = 0; i < depth.length; i++) depth[i] = d.data[i];
    self.postMessage({ type: "result", id, width: d.width, height: d.height, depth }, [depth.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};
