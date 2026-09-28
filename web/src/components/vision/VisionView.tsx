"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { interpolateField, MAP_SIZE } from "@/lib/field";
import type { Grid } from "@/lib/types";
import { FieldRenderer, type RenderParams } from "@/lib/vision/renderer";

export type VisionSource =
  | { kind: "camera"; facing: "environment" | "user" }
  | { kind: "image"; src: string; hfovDeg: number; focus?: [number, number] };

export interface VisionViewHandle {
  /** Current frame (their view) as a data URL, for the walk-through scans. */
  snapshot(): string | null;
  /** Raw source frame as ImageData at working resolution, for hazard analysis. */
  sourceFrame(maxDim?: number): ImageData | null;
  videoSize(): [number, number];
}

interface Props {
  grid: Grid;
  source: VisionSource;
  wipe: number;
  night: boolean;
  gaze?: [number, number];
  /** Camera horizontal field of view when using the camera, degrees. */
  cameraHfov?: number;
  className?: string;
  onError?: (message: string) => void;
  onReady?: () => void;
  label: string;
}

export const VisionView = forwardRef<VisionViewHandle, Props>(function VisionView(
  { grid, source, wipe, night, gaze = [0.5, 0.5], cameraHfov = 66, className, onError, onReady, label },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const paramsRef = useRef<RenderParams>({ hfovDeg: cameraHfov, gaze, wipe, night, mirror: false });
  const [ready, setReady] = useState(false);

  paramsRef.current = {
    hfovDeg: source.kind === "image" ? source.hfovDeg : cameraHfov,
    gaze,
    wipe,
    night,
    mirror: source.kind === "camera" && source.facing === "user",
    focus: source.kind === "image" ? source.focus : undefined,
  };

  // Renderer lifetime follows the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new FieldRenderer(canvas);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not start the renderer.");
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setField(interpolateField(grid), MAP_SIZE);
  }, [grid]);

  // Keep the drawing buffer matched to the element size and pixel density.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  /** Draw one frame. Returns true once a real frame has been rendered. */
  const draw = useCallback((): boolean => {
    const r = rendererRef.current;
    const v = videoRef.current;
    if (!r) return false;
    const img = imageRef.current;
    if (v && v.readyState >= 2 && v.videoWidth) {
      r.render(v, v.videoWidth, v.videoHeight, paramsRef.current);
      return true;
    }
    if (img && img.complete && img.naturalWidth) {
      r.render(img, img.naturalWidth, img.naturalHeight, paramsRef.current);
      return true;
    }
    return false;
  }, []);

  // Source: camera stream or still image. One render loop per source; the view
  // becomes visible on the first frame that actually draws.
  useEffect(() => {
    let raf = 0;
    let stream: MediaStream | null = null;
    let cancelled = false;
    let shown = false;
    setReady(false);

    const loop = () => {
      if (cancelled) return;
      if (draw() && !shown) {
        shown = true;
        setReady(true);
        onReady?.();
      }
      raf = requestAnimationFrame(loop);
    };

    if (source.kind === "camera") {
      const video = document.createElement("video");
      video.playsInline = true;
      video.muted = true;
      videoRef.current = video;
      imageRef.current = null;
      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.("This browser cannot open the camera. Use a sample room instead.");
      } else {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: source.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
          .then(async (s) => {
            if (cancelled) {
              s.getTracks().forEach((t) => t.stop());
              return;
            }
            stream = s;
            video.srcObject = s;
            await video.play();
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            const name = e instanceof DOMException ? e.name : "";
            onError?.(
              name === "NotAllowedError"
                ? "Camera access was blocked. Allow the camera in your browser settings, or use a sample room."
                : "No camera is available here. Use a sample room instead.",
            );
          });
      }
    } else {
      videoRef.current = null;
      const img = new Image();
      img.decoding = "async";
      img.src = source.src;
      imageRef.current = img;
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind, source.kind === "camera" ? source.facing : source.src, draw]);

  useImperativeHandle(ref, () => ({
    snapshot() {
      return canvasRef.current?.toDataURL("image/jpeg", 0.85) ?? null;
    },
    videoSize() {
      const v = videoRef.current;
      const img = imageRef.current;
      if (v) return [v.videoWidth, v.videoHeight];
      if (img) return [img.naturalWidth, img.naturalHeight];
      return [0, 0];
    },
    sourceFrame(maxDim = 640) {
      const canvas = canvasRef.current;
      const el: CanvasImageSource | null = videoRef.current ?? imageRef.current;
      if (!canvas || !el) return null;
      const [sw, sh] = videoRef.current
        ? [videoRef.current.videoWidth, videoRef.current.videoHeight]
        : [imageRef.current!.naturalWidth, imageRef.current!.naturalHeight];
      if (!sw || !sh) return null;
      // Same cover-crop as the renderer so coordinates line up with the screen.
      const cw = canvas.width;
      const ch = canvas.height;
      const srcAspect = sw / sh;
      const dstAspect = cw / ch;
      let cropW = sw;
      let cropH = sh;
      if (srcAspect > dstAspect) cropW = sh * dstAspect;
      else cropH = sw / dstAspect;
      const [fx, fy] = paramsRef.current.focus ?? [0.5, 0.5];
      const x0 = Math.min(sw - cropW, Math.max(0, fx * sw - cropW / 2));
      const y0 = Math.min(sh - cropH, Math.max(0, fy * sh - cropH / 2));
      const scale = Math.min(1, maxDim / Math.max(cropW, cropH));
      const out = document.createElement("canvas");
      out.width = Math.round(cropW * scale);
      out.height = Math.round(cropH * scale);
      const ctx = out.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(el, x0, y0, cropW, cropH, 0, 0, out.width, out.height);
      return ctx.getImageData(0, 0, out.width, out.height);
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={className}
      style={{ opacity: ready ? 1 : 0, transition: "opacity 400ms var(--ease-spring)" }}
    />
  );
});
