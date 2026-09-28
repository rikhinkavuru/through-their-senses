/**
 * Webcam face and iris tracking with MediaPipe Face Landmarker, entirely on the
 * device: frames never leave the browser.
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { gazeFeatures, type Features } from "./features";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL = "/models/face_landmarker.task";

export type FrameHandler = (f: Features | null, tMs: number) => void;

export class EyeTracker {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private lastTs = -1;

  private constructor(private landmarker: FaceLandmarker) {}

  /**
   * One face model per page, shared: creating two at once in the same Wasm runtime can
   * stall (React Strict Mode mounts effects twice), and reloading it is slow.
   */
  private static shared: Promise<FaceLandmarker> | null = null;

  static async create(): Promise<EyeTracker> {
    EyeTracker.shared ??= (async () => {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      const opts = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO" as const,
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      try {
        return await FaceLandmarker.createFromOptions(fileset, opts("GPU"));
      } catch {
        return await FaceLandmarker.createFromOptions(fileset, opts("CPU"));
      }
    })().catch((e) => {
      EyeTracker.shared = null;
      throw e;
    });
    return new EyeTracker(await EyeTracker.shared);
  }

  async start(onFrame: FrameHandler): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open the camera.");
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = document.createElement("video");
    v.playsInline = true;
    v.muted = true;
    v.srcObject = this.stream;
    await v.play();
    this.video = v;
    this.running = true;
    const step = () => {
      if (!this.running || !this.video) return;
      const now = performance.now();
      if (v.readyState >= 2 && now > this.lastTs) {
        this.lastTs = now;
        const res = this.landmarker.detectForVideo(v, now);
        const lm = res.faceLandmarks?.[0];
        if (!lm) onFrame(null, now);
        else {
          const blend: Record<string, number> = {};
          for (const c of res.faceBlendshapes?.[0]?.categories ?? []) blend[c.categoryName] = c.score;
          onFrame(gazeFeatures({ landmarks: lm, videoWidth: v.videoWidth, videoHeight: v.videoHeight, blend, matrix: res.facialTransformationMatrixes?.[0]?.data }), now);
        }
      }
      next();
    };
    const next = () => ("requestVideoFrameCallback" in v ? v.requestVideoFrameCallback(step) : requestAnimationFrame(step));
    next();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
  }

  /** Stops the camera; the shared face model stays loaded for next time. */
  close() {
    this.stop();
  }
}
