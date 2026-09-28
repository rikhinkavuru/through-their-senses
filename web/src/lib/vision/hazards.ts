/**
 * Home walk-through: find edges that matter for falls and judge whether this person
 * can see them, using the same threshold model as the renderer.
 *
 * Step edges come from a monocular depth map (Depth Anything V2): a tread nosing
 * shows up as a horizontal discontinuity in relative depth. Contrast is measured on
 * the photo itself, as Weber contrast between thin strips either side of the edge.
 */

import { NIGHT, normalThreshold, thresholdMultiplier, weberContrast } from "./csf";

export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number; // normalized 0-1 image coordinates
  strength: number;
}

export type Verdict = "hidden" | "hard" | "visible";

export interface HazardAssessment {
  contrast: number; // Weber
  threshold: number; // her contrast threshold at that place in her field
  ratio: number; // contrast / threshold
  verdict: Verdict;
  belowGuideline: boolean; // step edges: under 50% Weber
  td: number; // total deviation where it falls
  region: "lower" | "upper" | "centre";
  xDeg: number;
  yDeg: number;
}

/** Spatial frequency used for edge visibility at walking distance, cycles/degree. */
export const EDGE_CPD = 1;
/** Contrast recommended for step-edge highlighting (stair nosing research). */
export const STEP_GUIDELINE = 0.5;

/** Box-blur a single-channel image in place (separable, radius r). */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/**
 * Find near-horizontal depth discontinuities (likely step edges or drop-offs).
 * depth: relative inverse depth (larger = closer), w x h.
 *
 * Works on vertical depth profiles averaged over narrow column bands. On a floor or
 * a flight of stairs, depth rises smoothly towards the bottom of the frame; a tread
 * nosing adds a small extra jump on top of that ramp. We measure each band's jump
 * against its local ramp (moving median) and its own noise (MAD), keep jumps that
 * are not immediately reversed (a thin rail rises then falls), and link bands.
 */
export function findStepEdges(depth: Float32Array, w: number, h: number, maxEdges = 6): Segment[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of depth) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const n = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; i++) n[i] = (depth[i] - lo) / Math.max(1e-6, hi - lo);
  const d = blur(n, w, h, 1);

  const bands = 24;
  const bw = Math.floor(w / bands);
  const top = Math.round(h * 0.33);
  const win = Math.max(6, Math.round(h * 0.03));
  const back = Math.max(4, Math.round(h * 0.035));
  const peaks: { band: number; y: number; s: number }[] = [];
  for (let b = 0; b < bands; b++) {
    const prof = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = b * bw; x < (b + 1) * bw; x++) acc += d[y * w + x];
      prof[y] = acc / bw;
    }
    const der = new Float32Array(h);
    for (let y = 2; y < h - 2; y++) der[y] = prof[y + 2] - prof[y - 2];
    const excess = new Float32Array(h);
    for (let y = top; y < h - 2; y++) {
      const neighbourhood: number[] = [];
      for (let k = Math.max(2, y - win); k <= Math.min(h - 3, y + win); k++) if (Math.abs(k - y) > 2) neighbourhood.push(der[k]);
      excess[y] = der[y] - median(neighbourhood);
    }
    const tail = Array.from(excess.slice(top, h - 2));
    const noise = median(tail.map((v) => Math.abs(v))) * 1.4826;
    const thr = Math.max(0.006, 3 * noise);
    for (let y = top + 2; y < h - 2 - back; y++) {
      const v = excess[y];
      if (v < thr) continue;
      let isMax = true;
      for (let k = -3; k <= 3; k++) if (k && excess[y + k] > v) isMax = false;
      if (!isMax) continue;
      let reversed = false;
      for (let k = 3; k <= back + 3 && y + k < h - 2; k++) if (excess[y + k] < -0.6 * v) reversed = true;
      if (!reversed) peaks.push({ band: b, y, s: v });
    }
  }

  // Greedy linking: chains of peaks in consecutive bands with small vertical drift.
  const used = new Set<number>();
  const segs: Segment[] = [];
  peaks.sort((a, b) => b.s - a.s);
  for (let i = 0; i < peaks.length; i++) {
    if (used.has(i)) continue;
    const chain = [peaks[i]];
    used.add(i);
    for (const dir of [-1, 1]) {
      let cur = peaks[i];
      for (;;) {
        let best = -1;
        let bestD = Infinity;
        for (let j = 0; j < peaks.length; j++) {
          if (used.has(j) || peaks[j].band !== cur.band + dir) continue;
          const dy = Math.abs(peaks[j].y - cur.y);
          if (dy <= Math.max(3, h * 0.025) && dy < bestD) {
            best = j;
            bestD = dy;
          }
        }
        if (best < 0) break;
        used.add(best);
        chain.push(peaks[best]);
        cur = peaks[best];
      }
    }
    if (chain.length < Math.max(4, bands * 0.2)) continue;
    chain.sort((a, b) => a.band - b.band);
    const first = chain[0];
    const last = chain[chain.length - 1];
    const slope = Math.abs(last.y - first.y) / Math.max(1, (last.band - first.band + 1) * bw);
    if (slope > 0.5) continue;
    segs.push({
      x0: (first.band * bw) / w,
      y0: first.y / h,
      x1: ((last.band + 1) * bw) / w,
      y1: last.y / h,
      strength: chain.reduce((s, c) => s + c.s, 0) / chain.length,
    });
  }
  segs.sort((a, b) => b.strength * (b.x1 - b.x0) - a.strength * (a.x1 - a.x0));
  const out: Segment[] = [];
  for (const s of segs) {
    const dup = out.some((o) => Math.abs((o.y0 + o.y1) / 2 - (s.y0 + s.y1) / 2) < 0.03 && Math.min(o.x1, s.x1) - Math.max(o.x0, s.x0) > 0);
    if (!dup) out.push(s);
    if (out.length >= maxEdges) break;
  }
  return out;
}

/** Linear luminance of an RGBA ImageData pixel. */
function lumAt(img: ImageData, x: number, y: number): number {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const k = (yi * img.width + xi) * 4;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(img.data[k]) + 0.7152 * lin(img.data[k + 1]) + 0.0722 * lin(img.data[k + 2]);
}

/** Weber contrast across a segment: mean luminance of thin strips just above and below. */
export function edgeContrast(img: ImageData, s: Segment): number {
  const n = 40;
  const off = Math.max(3, img.height * 0.012);
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = (s.x0 + (s.x1 - s.x0) * t) * img.width;
    const y = (s.y0 + (s.y1 - s.y0) * t) * img.height;
    for (const k of [1, 1.6, 2.2]) {
      a += lumAt(img, x, y - off * k);
      b += lumAt(img, x, y + off * k);
    }
  }
  return weberContrast(a / (3 * n), b / (3 * n));
}

/** Strongest local luminance edge around a tapped point, as a short segment. */
export function edgeAtPoint(img: ImageData, nx: number, ny: number): Segment {
  const cx = nx * img.width;
  const cy = ny * img.height;
  const r = Math.max(10, img.width * 0.04);
  let best = { angle: 0, c: 0 };
  for (let a = 0; a < 180; a += 15) {
    const rad = (a * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // Compare the two sides of a line through the point at this angle.
    let s1 = 0;
    let s2 = 0;
    for (let i = -4; i <= 4; i++) {
      const px = cx + dx * i * (r / 4);
      const py = cy + dy * i * (r / 4);
      s1 += lumAt(img, px - dy * r * 0.35, py + dx * r * 0.35);
      s2 += lumAt(img, px + dy * r * 0.35, py - dx * r * 0.35);
    }
    const c = weberContrast(s1 / 9, s2 / 9);
    if (c > best.c) best = { angle: a, c };
  }
  const rad = (best.angle * Math.PI) / 180;
  return {
    x0: (cx - Math.cos(rad) * r) / img.width,
    y0: (cy - Math.sin(rad) * r) / img.height,
    x1: (cx + Math.cos(rad) * r) / img.width,
    y1: (cy + Math.sin(rad) * r) / img.height,
    strength: best.c,
  };
}

export interface ViewGeometry {
  /** Field of view actually shown across the width, degrees. */
  shownHfovDeg: number;
  aspect: number; // width / height of the shown image
  /** Fixation in normalized coordinates. */
  gaze: [number, number];
}

export function toDegrees(geo: ViewGeometry, nx: number, ny: number): [number, number] {
  const f = 0.5 / Math.tan((geo.shownHfovDeg * Math.PI) / 360); // in widths
  const dx = (nx - geo.gaze[0]) / f;
  const dy = ((geo.gaze[1] - ny) / geo.aspect) / f;
  return [(Math.atan(dx) * 180) / Math.PI, (Math.atan(dy) * 180) / Math.PI];
}

/**
 * Judge one edge. td(x, y) returns total deviation at a visual angle (NaN if untested).
 * Uses the worse quartile of TD along the edge, so a partly hidden edge is not called visible.
 */
export function assess(
  s: Segment,
  contrast: number,
  geo: ViewGeometry,
  td: (xDeg: number, yDeg: number) => number,
  opts: { night: boolean; isStep: boolean },
): HazardAssessment {
  const samples: { td: number; x: number; y: number }[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const [x, y] = toDegrees(geo, s.x0 + (s.x1 - s.x0) * t, s.y0 + (s.y1 - s.y0) * t);
    const v = td(x, y);
    samples.push({ td: Number.isFinite(v) ? v : 0, x, y });
  }
  const sorted = [...samples].sort((a, b) => a.td - b.td);
  const q = sorted[Math.floor(sorted.length * 0.25)];
  const mid = samples[4];
  const night = opts.night ? NIGHT.typicalFactor * NIGHT.glaucomaExtraFactor : 1;
  const threshold = normalThreshold(EDGE_CPD) * thresholdMultiplier(q.td) * night;
  const ratio = contrast / threshold;
  const verdict: Verdict = ratio < 1 ? "hidden" : ratio < 3 ? "hard" : "visible";
  return {
    contrast,
    threshold,
    ratio,
    verdict,
    belowGuideline: opts.isStep && contrast < STEP_GUIDELINE,
    td: q.td,
    region: mid.y < -3 ? "lower" : mid.y > 3 ? "upper" : "centre",
    xDeg: mid.x,
    yDeg: mid.y,
  };
}
