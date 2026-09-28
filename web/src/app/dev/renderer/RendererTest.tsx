"use client";

import { useEffect, useRef } from "react";
import { emptyGrid, interpolateField, MAP_SIZE, PRINTOUT_ROWS } from "@/lib/field";
import { ciePsf, SCENES, sourceRatio, VIEWER_AGE } from "@/lib/vision/light";
import { FieldRenderer } from "@/lib/vision/renderer";

const SIZE = 256;

function uniformGrid(td: number) {
  const g = emptyGrid();
  PRINTOUT_ROWS.forEach((row, r) => [...new Set([...row.right, ...row.left])].forEach((c) => (g[r][c] = td)));
  return g;
}

/** Test image: sine gratings at three scales plus a hard edge, mid-grey mean. */
function testImage(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const v = 0.5 + 0.15 * Math.sin(x / 3) + 0.12 * Math.sin(y / 9) + 0.1 * Math.sin((x + y) / 24) + (x > SIZE / 2 ? 0.08 : -0.08);
      const b = Math.round(Math.min(1, Math.max(0, v)) * 255);
      img.data.set([b, b, b, 255], (y * SIZE + x) * 4);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Glare test image: black, with one small white square (a lamp) in the middle. */
const LAMP = 8;
function lampImage(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "#fff";
  ctx.fillRect(SIZE / 2 - LAMP / 2, SIZE / 2 - LAMP / 2, LAMP, LAMP);
  return c;
}

function stats(px: Uint8Array) {
  let sum = 0;
  let sum2 = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] / 255;
    sum += v;
    sum2 += v * v;
  }
  const mean = sum / n;
  // Detail: mean absolute difference between horizontal neighbours (fine structure).
  let detail = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE - 1; x++) detail += Math.abs(px[(y * SIZE + x + 1) * 4] - px[(y * SIZE + x) * 4]) / 255;
  return { mean, rms: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), detail: detail / (SIZE * (SIZE - 1)) };
}

export function RendererTest() {
  const out = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    document.body.appendChild(canvas);
    const r = new FieldRenderer(canvas);
    const gl = canvas.getContext("webgl2")!;
    const src = testImage();
    const read = () => {
      const px = new Uint8Array(SIZE * SIZE * 4);
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const render = (td: number, wipe: number) => {
      r.setField(interpolateField(uniformGrid(td)), MAP_SIZE);
      // A narrow field of view keeps the whole image inside the tested 24-2 area.
      r.render(src, SIZE, SIZE, { hfovDeg: 30, gaze: [0.5, 0.5], wipe, light: "day", age: 70, diffuseTd: 0, mirror: false });
      return read();
    };
    const original = render(0, 1); // wipe = 1: everything shows the typical view
    const typical = render(0, 0); // TD 0 through the model
    let diff = 0;
    for (let i = 0; i < original.length; i += 4) diff += Math.abs(original[i] - typical[i]);
    const identityErr = diff / (original.length / 4) / 255;
    const s0 = stats(original);
    const levels = [0, -5, -10, -20, -30].map((td) => ({ td, ...stats(render(td, 0)) }));
    const monotonic = levels.every((l, i) => i === 0 || l.rms <= levels[i - 1].rms + 1e-3);
    // Deep loss keeps only the coarsest low-pass level (filling-in), so fine detail should vanish.
    const deepFraction = levels[4].detail / s0.detail;
    const meanDrift = Math.max(...levels.map((l) => Math.abs(l.mean - s0.mean)));
    // Glare: the veil beside a lamp should follow the CIE equation for the person's age
    // (their side) and the viewer's age (your side).
    r.setField(interpolateField(uniformGrid(0)), MAP_SIZE);
    const glare = (wipe: number) => {
      r.render(lampImage(), SIZE, SIZE, { hfovDeg: 30, gaze: [0.5, 0.5], wipe, light: "night", age: 70, diffuseTd: 0, mirror: false });
      return read();
    };
    const theirs = glare(0);
    const yours = glare(1);
    const focalPx = SIZE / 2 / Math.tan((15 * Math.PI) / 180);
    const lampSr = (LAMP / focalPx) ** 2;
    const scale = sourceRatio("night") * SCENES.night.display * lampSr;
    const lin = (b: number) => Math.pow(b / 255, 2.2);
    const glarePoints = [3, 6, 10].map((deg) => {
      const x = Math.round(SIZE / 2 + focalPx * Math.tan((deg * Math.PI) / 180));
      const i = ((SIZE / 2) * SIZE + x) * 4;
      return {
        deg,
        theirs: lin(theirs[i]),
        expectedTheirs: scale * ciePsf(deg, 70),
        yours: lin(yours[i]),
        expectedYours: scale * ciePsf(deg, VIEWER_AGE),
      };
    });
    const within = (a: number, b: number, tol: number) => Math.abs(a / b - 1) < tol;
    // A glint too small to be a lamp (3 px) should add no glare.
    const glint = document.createElement("canvas");
    glint.width = SIZE;
    glint.height = SIZE;
    const gctx = glint.getContext("2d")!;
    gctx.fillStyle = "#000";
    gctx.fillRect(0, 0, SIZE, SIZE);
    gctx.fillStyle = "#fff";
    gctx.fillRect(SIZE / 2 - 1, SIZE / 2 - 1, 3, 3);
    r.render(glint, SIZE, SIZE, { hfovDeg: 30, gaze: [0.5, 0.5], wipe: 0, light: "night", age: 70, diffuseTd: 0, mirror: false });
    const gpx = read();
    const glintVeil = lin(gpx[((SIZE / 2) * SIZE + Math.round(SIZE / 2 + focalPx * Math.tan((6 * Math.PI) / 180))) * 4]);
    const checks = {
      glareFollowsCie: glarePoints.every((g) => within(g.theirs, g.expectedTheirs, 0.25) && within(g.yours, g.expectedYours, 0.25)),
      glareGrowsWithAge: glarePoints.every((g) => g.theirs > 1.5 * g.yours),
      glintsDoNotGlare: glintVeil < 0.002,
      identity: identityErr < 0.01,
      monotonic,
      deepRemovesFineDetail: deepFraction < 0.1,
      moderateKeepsSome: levels[2].rms > 0.05 * s0.rms,
      meanPreserved: meanDrift < 0.04,
    };
    const result = { pass: Object.values(checks).every(Boolean), checks, identityErr, deepFraction, meanDrift, levels, originalRms: s0.rms, glarePoints };
    (window as unknown as { __rendererTest: unknown }).__rendererTest = result;
    if (out.current) out.current.textContent = JSON.stringify(result, null, 1);
    r.dispose();
  }, []);
  return (
    <pre ref={out} className="p-4 text-xs">
      running
    </pre>
  );
}
