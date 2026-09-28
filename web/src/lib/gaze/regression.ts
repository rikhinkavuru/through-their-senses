/**
 * Calibration model for webcam gaze: ridge regression from eye features to a screen
 * point, one model per axis. Features are standardized on the calibration samples, so
 * one penalty works whatever their units. Pure functions, unit-tested.
 */

export interface GazeModel {
  mean: number[];
  std: number[];
  wx: number[]; // intercept first
  wy: number[];
}

/** Solve A x = b for a small symmetric positive-definite A (Gaussian elimination, partial pivoting). */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

function ridge(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const x = X[i];
    for (let j = 0; j < p; j++) {
      b[j] += x[j] * y[i];
      for (let k = 0; k < p; k++) A[j][k] += x[j] * x[k];
    }
  }
  // Do not penalize the intercept (column 0).
  for (let j = 1; j < p; j++) A[j][j] += lambda * X.length;
  return solve(A, b);
}

function design(f: number[], mean: number[], std: number[]): number[] {
  return [1, ...f.map((v, i) => (v - mean[i]) / std[i])];
}

export function fitGaze(features: number[][], targets: [number, number][], lambda = 0.02): GazeModel {
  if (features.length < 2) throw new Error("Not enough calibration samples.");
  const d = features[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const f of features) f.forEach((v, i) => (mean[i] += v / features.length));
  for (const f of features) f.forEach((v, i) => (std[i] += (v - mean[i]) ** 2 / features.length));
  for (let i = 0; i < d; i++) std[i] = Math.sqrt(std[i]) || 1;
  const X = features.map((f) => design(f, mean, std));
  return { mean, std, wx: ridge(X, targets.map((t) => t[0]), lambda), wy: ridge(X, targets.map((t) => t[1]), lambda) };
}

export function predictGaze(m: GazeModel, f: number[]): [number, number] {
  const x = design(f, m.mean, m.std);
  let gx = 0;
  let gy = 0;
  for (let i = 0; i < x.length; i++) {
    gx += m.wx[i] * x[i];
    gy += m.wy[i] * x[i];
  }
  return [gx, gy];
}

/**
 * Leave-one-target-out error: for each calibration point, fit on the others and
 * predict it. Honest accuracy without asking for extra validation points.
 */
export function crossValidatedError(features: number[][], targets: [number, number][], groups: number[], lambda = 0.02): number {
  const ids = [...new Set(groups)];
  let err = 0;
  let n = 0;
  for (const g of ids) {
    const tr = groups.map((v, i) => (v === g ? -1 : i)).filter((i) => i >= 0);
    const te = groups.map((v, i) => (v === g ? i : -1)).filter((i) => i >= 0);
    const m = fitGaze(tr.map((i) => features[i]), tr.map((i) => targets[i]), lambda);
    const pred = te.map((i) => predictGaze(m, features[i]));
    const mx = pred.reduce((s, p) => s + p[0], 0) / pred.length;
    const my = pred.reduce((s, p) => s + p[1], 0) / pred.length;
    const t = targets[te[0]];
    err += Math.hypot(mx - t[0], my - t[1]);
    n++;
  }
  return err / n;
}
