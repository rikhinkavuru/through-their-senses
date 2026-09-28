import type { Grid } from "./types";
import { cap, type Pronouns } from "./pronouns";

export const X_DEG = [-27, -21, -15, -9, -3, 3, 9, 15, 21, 27];
export const Y_DEG = [21, 15, 9, 3, -3, -9, -15, -21];

/** Extent of the interpolated map in degrees from fixation (each axis). */
export const MAP_EXTENT = 33;
export const MAP_SIZE = 66; // 1 texel per degree

export interface FieldPoint {
  x: number;
  y: number;
  td: number;
}

export function gridPoints(grid: Grid): FieldPoint[] {
  const pts: FieldPoint[] = [];
  grid.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v !== null && Number.isFinite(v)) pts.push({ x: X_DEG[c], y: Y_DEG[r], td: v });
    }),
  );
  return pts;
}

/**
 * Interpolate a total-deviation grid onto a 1-degree map covering +-33 degrees.
 * Gaussian-weighted average of tested points (sigma 3.5 degrees). Texels farther
 * than 5 degrees beyond the nearest tested point are marked untested (NaN): the
 * renderer leaves them unchanged and the field map hatches them.
 */
export function interpolateField(grid: Grid, size = MAP_SIZE, extent = MAP_EXTENT): Float32Array {
  const pts = gridPoints(grid);
  const out = new Float32Array(size * size);
  const sigma2 = 2 * 3.5 * 3.5;
  for (let j = 0; j < size; j++) {
    const y = extent - ((j + 0.5) / size) * 2 * extent;
    for (let i = 0; i < size; i++) {
      const x = -extent + ((i + 0.5) / size) * 2 * extent;
      let wsum = 0;
      let vsum = 0;
      let nearest = Infinity;
      for (const p of pts) {
        const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d2 < nearest) nearest = d2;
        const w = Math.exp(-d2 / sigma2);
        wsum += w;
        vsum += w * p.td;
      }
      out[j * size + i] = Math.sqrt(nearest) > 5 || wsum < 1e-6 ? Number.NaN : vsum / wsum;
    }
  }
  return out;
}

export function sampleMap(map: Float32Array, xDeg: number, yDeg: number, size = MAP_SIZE, extent = MAP_EXTENT): number {
  const i = Math.floor(((xDeg + extent) / (2 * extent)) * size);
  const j = Math.floor(((extent - yDeg) / (2 * extent)) * size);
  if (i < 0 || j < 0 || i >= size || j >= size) return Number.NaN;
  return map[j * size + i];
}

export function meanTd(pts: FieldPoint[], pred: (p: FieldPoint) => boolean): number | null {
  const sel = pts.filter(pred);
  if (!sel.length) return null;
  return sel.reduce((s, p) => s + p.td, 0) / sel.length;
}

export interface FieldSummary {
  md: number;
  central: number | null;
  upper: number | null;
  lower: number | null;
  left: number | null;
  right: number | null;
  worstRegion: "upper" | "lower" | "left" | "right" | null;
}

export function summarize(grid: Grid): FieldSummary {
  const pts = gridPoints(grid);
  const md = pts.reduce((s, p) => s + p.td, 0) / Math.max(1, pts.length);
  const central = meanTd(pts, (p) => Math.abs(p.x) <= 9 && Math.abs(p.y) <= 9);
  const upper = meanTd(pts, (p) => p.y > 0);
  const lower = meanTd(pts, (p) => p.y < 0);
  const left = meanTd(pts, (p) => p.x < 0);
  const right = meanTd(pts, (p) => p.x > 0);
  const regions = { upper, lower, left, right } as const;
  let worstRegion: FieldSummary["worstRegion"] = null;
  let worst = -3;
  for (const [k, v] of Object.entries(regions)) {
    if (v !== null && v < worst) {
      worst = v;
      worstRegion = k as FieldSummary["worstRegion"];
    }
  }
  return { md, central, upper, lower, left, right, worstRegion };
}

/** Plain-language strengths, so every view starts from what still works. */
export function whatStillWorks(grid: Grid, p: Pronouns): string[] {
  const s = summarize(grid);
  const out: string[] = [];
  if (s.central !== null && s.central > -4)
    out.push(`The centre of ${p.poss} vision is close to typical for ${p.poss} age, so reading and faces straight ahead stay clear.`);
  if (s.upper !== null && s.upper > -4)
    out.push(`${cap(p.poss)} upper field works well: signs, faces at eye level and cupboards are easier than the floor.`);
  if (s.lower !== null && s.lower > -4) out.push(`${cap(p.poss)} lower field works well, which helps with steps and kerbs.`);
  if (s.left !== null && s.right !== null && Math.abs(s.left - s.right) > 3) {
    out.push(`${cap(p.subj)} see${p.s} better on ${p.poss} ${s.left > s.right ? "left" : "right"} side.`);
  }
  if (!out.length)
    out.push(`${cap(p.subj)} still ${p.has} useful vision across much of ${p.poss} field, and ${p.has === "have" ? "have" : "has"} learned to scan with head and eyes.`);
  return out;
}

/** Describe a region's loss in words a family member can act on. */
export function lossWords(td: number): string {
  if (!Number.isFinite(td)) return "not tested";
  if (td > -4) return "typical for her age";
  if (td > -10) return "a little dimmer and softer";
  if (td > -20) return "much harder to see";
  return "very little gets through here";
}

/**
 * 24-2 layout as printed on a Humphrey report, per eye, in visual-field orientation
 * (as the patient sees it). Row lengths 4,6,8,9,9,8,6,4. Right eye spans x = -27..21
 * (shared columns 0..8), left eye x = -21..27 (shared columns 1..9). The blind spot
 * sits at x = +15 (right eye) or -15 (left eye), y = +-3.
 */
export const PRINTOUT_ROWS: { right: number[]; left: number[] }[] = [
  // Only the two middle rows differ between eyes: each has one extra point on the nasal side.
  { right: [3, 4, 5, 6], left: [3, 4, 5, 6] },
  { right: [2, 3, 4, 5, 6, 7], left: [2, 3, 4, 5, 6, 7] },
  { right: [1, 2, 3, 4, 5, 6, 7, 8], left: [1, 2, 3, 4, 5, 6, 7, 8] },
  { right: [0, 1, 2, 3, 4, 5, 6, 7, 8], left: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { right: [0, 1, 2, 3, 4, 5, 6, 7, 8], left: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { right: [1, 2, 3, 4, 5, 6, 7, 8], left: [1, 2, 3, 4, 5, 6, 7, 8] },
  { right: [2, 3, 4, 5, 6, 7], left: [2, 3, 4, 5, 6, 7] },
  { right: [3, 4, 5, 6], left: [3, 4, 5, 6] },
];

export function isBlindSpot(eye: "right" | "left", row: number, col: number): boolean {
  return (row === 3 || row === 4) && col === (eye === "right" ? 7 : 2);
}

export function emptyGrid(): Grid {
  return Array.from({ length: 8 }, () => Array.from({ length: 10 }, () => null));
}

/** Best-location binocular merge (Crabb and Viswanathan 1998). */
export function mergeBinocular(right: Grid, left: Grid): Grid {
  return right.map((row, r) =>
    row.map((v, c) => {
      const l = left[r][c];
      if (v === null) return l;
      if (l === null) return v;
      return Math.max(v, l);
    }),
  );
}
