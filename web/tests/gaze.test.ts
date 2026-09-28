import { describe, expect, it } from "vitest";
import { gazeFeatures, type Pt } from "../src/lib/gaze/features";
import { OneEuro } from "../src/lib/gaze/filter";
import { crossValidatedError, fitGaze, predictGaze } from "../src/lib/gaze/regression";

/** Seeded pseudo-random numbers so the tests are repeatable. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

describe("gaze calibration", () => {
  const rand = rng(7);
  const targets: [number, number][] = [];
  const feats: number[][] = [];
  const groups: number[] = [];
  const grid = [0.1, 0.3, 0.5, 0.7, 0.9];
  grid.forEach((x, i) =>
    grid.forEach((y, j) => {
      for (let k = 0; k < 10; k++) {
        // Features are a noisy linear function of the target plus a nuisance feature.
        feats.push([0.2 * x - 0.05 + 0.002 * (rand() - 0.5), -0.1 * y + 0.01 * (rand() - 0.5), rand()]);
        targets.push([x, y]);
        groups.push(i * 5 + j);
      }
    }),
  );

  it("recovers a linear mapping", () => {
    const m = fitGaze(feats, targets, 0.001);
    const [x, y] = predictGaze(m, [0.2 * 0.42 - 0.05, -0.1 * 0.61, 0.5]);
    expect(x).toBeCloseTo(0.42, 1);
    expect(y).toBeCloseTo(0.61, 1);
  });

  it("reports held-out error that grows with feature noise", () => {
    const clean = crossValidatedError(feats, targets, groups, 0.001);
    const noisy = feats.map((f) => [f[0] + 0.02 * (rand() - 0.5), f[1] + 0.02 * (rand() - 0.5), f[2]]);
    expect(clean).toBeLessThan(0.05);
    expect(crossValidatedError(noisy, targets, groups, 0.001)).toBeGreaterThan(clean);
  });
});

describe("eye features", () => {
  function face(irisShift: number): Pt[] {
    const lm: Pt[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    // Subject's right eye appears on the image left.
    lm[33] = { x: 0.36, y: 0.45 };
    lm[133] = { x: 0.44, y: 0.45 };
    lm[159] = { x: 0.4, y: 0.435 };
    lm[145] = { x: 0.4, y: 0.465 };
    lm[468] = { x: 0.4 + irisShift, y: 0.45 };
    lm[362] = { x: 0.56, y: 0.45 };
    lm[263] = { x: 0.64, y: 0.45 };
    lm[386] = { x: 0.6, y: 0.435 };
    lm[374] = { x: 0.6, y: 0.465 };
    lm[473] = { x: 0.6 + irisShift, y: 0.45 };
    return lm;
  }

  it("moves the horizontal iris feature with the iris, in the same direction for both eyes", () => {
    const a = gazeFeatures({ landmarks: face(-0.01), videoWidth: 640, videoHeight: 480 })!;
    const b = gazeFeatures({ landmarks: face(0.01), videoWidth: 640, videoHeight: 480 })!;
    expect(b.vector[0]).toBeGreaterThan(a.vector[0]);
    expect(Math.abs(a.vector[0] + b.vector[0])).toBeLessThan(1e-9);
    expect(a.blink).toBe(false);
  });

  it("flags a blink when the lids close", () => {
    const lm = face(0);
    lm[159] = { x: 0.4, y: 0.449 };
    lm[145] = { x: 0.4, y: 0.451 };
    lm[386] = { x: 0.6, y: 0.449 };
    lm[374] = { x: 0.6, y: 0.451 };
    expect(gazeFeatures({ landmarks: lm, videoWidth: 640, videoHeight: 480 })!.blink).toBe(true);
  });
});

describe("One Euro filter", () => {
  it("smooths jitter at rest and settles on a new value", () => {
    const f = new OneEuro();
    const rand = rng(3);
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(0.5 + 0.02 * (rand() - 0.5), i / 30);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.01);
    for (let i = 60; i < 120; i++) out = f.filter(0.8, i / 30);
    expect(out).toBeCloseTo(0.8, 2);
  });
});
