"use client";

type Msg =
  | { type: "progress"; loaded: number; total: number; file?: string }
  | { type: "status"; id: number; status: string }
  | { type: "result"; id: number; width: number; height: number; depth: Float32Array }
  | { type: "error"; id: number; message: string };

let worker: Worker | null = null;
let nextId = 1;

export interface DepthResult {
  width: number;
  height: number;
  depth: Float32Array;
}

/** Estimate relative depth for an image, on-device. onProgress reports model download bytes. */
export function estimateDepth(img: ImageData, onProgress?: (loaded: number, total: number) => void, onRunning?: () => void): Promise<DepthResult> {
  worker ??= new Worker(new URL("../../workers/depth.worker.ts", import.meta.url), { type: "module" });
  const id = nextId++;
  const w = worker;
  return new Promise((resolve, reject) => {
    const files = new Map<string, [number, number]>();
    const onMsg = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.type === "progress") {
        files.set(m.file ?? "model", [m.loaded, m.total]);
        let l = 0;
        let t = 0;
        files.forEach(([a, b]) => ((l += a), (t += b)));
        onProgress?.(l, t);
        return;
      }
      if (m.id !== id) return;
      if (m.type === "status") onRunning?.();
      if (m.type === "result") {
        w.removeEventListener("message", onMsg);
        resolve({ width: m.width, height: m.height, depth: m.depth });
      }
      if (m.type === "error") {
        w.removeEventListener("message", onMsg);
        reject(new Error(m.message));
      }
    };
    w.addEventListener("message", onMsg);
    const data = new Uint8ClampedArray(img.data);
    w.postMessage({ id, width: img.width, height: img.height, data }, [data.buffer]);
  });
}
