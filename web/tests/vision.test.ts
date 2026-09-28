import { describe, expect, it } from "vitest";
import { normalThreshold, sensitivity, thresholdMultiplier, weberContrast } from "../src/lib/vision/csf";
import { assess, edgeContrast, findStepEdges, STEP_GUIDELINE, toDegrees, type ViewGeometry, looksLikeStep } from "../src/lib/vision/hazards";

describe("contrast sensitivity", () => {
  it("peaks at mid spatial frequencies and falls at both ends", () => {
    expect(sensitivity(4)).toBeGreaterThan(sensitivity(0.3));
    expect(sensitivity(4)).toBeGreaterThan(sensitivity(30));
    expect(normalThreshold(4)).toBeCloseTo(1 / sensitivity(4));
  });
  it("turns total deviation into a threshold multiplier, 10^(-TD/10)", () => {
    expect(thresholdMultiplier(0)).toBe(1);
    expect(thresholdMultiplier(-10)).toBeCloseTo(10);
    expect(thresholdMultiplier(-20)).toBeCloseTo(100);
    expect(thresholdMultiplier(3)).toBe(1); // better than average never lowers the threshold
  });
  it("computes Weber contrast symmetrically", () => {
    expect(weberContrast(0.2, 0.3)).toBeCloseTo(0.5);
    expect(weberContrast(0.3, 0.2)).toBeCloseTo(0.5);
  });
});

describe("hazard verdicts use the renderer's threshold model", () => {
  const geo: ViewGeometry = { shownHfovDeg: 60, aspect: 1, gaze: [0.5, 0.5] };
  const seg = { x0: 0.3, y0: 0.7, x1: 0.7, y1: 0.7, strength: 1 };
  it("places the lower part of the image in the lower field", () => {
    const [, y] = toDegrees(geo, 0.5, 0.7);
    expect(y).toBeLessThan(0);
  });
  it("is visible with typical vision and hidden where loss is deep", () => {
    const typical = assess(seg, 0.3, geo, () => 0, { light: "day", diffuseTd: 0, isStep: true });
    const deep = assess(seg, 0.3, geo, () => -25, { light: "day", diffuseTd: 0, isStep: true });
    expect(typical.verdict).toBe("visible");
    expect(deep.verdict).toBe("hidden");
    expect(deep.threshold / typical.threshold).toBeCloseTo(thresholdMultiplier(-25), 3);
    expect(typical.region).toBe("lower");
  });
  it("flags step edges below the 50% guideline", () => {
    expect(assess(seg, STEP_GUIDELINE - 0.01, geo, () => 0, { light: "day", diffuseTd: 0, isStep: true }).belowGuideline).toBe(true);
    expect(assess(seg, STEP_GUIDELINE + 0.01, geo, () => 0, { light: "day", diffuseTd: 0, isStep: true }).belowGuideline).toBe(false);
  });
  it("gets harder in dim light", () => {
    const day = assess(seg, 0.3, geo, () => -8, { light: "day", diffuseTd: 0, isStep: true });
    const night = assess(seg, 0.3, geo, () => -8, { light: "night", diffuseTd: 0, isStep: true });
    expect(night.threshold).toBeGreaterThan(day.threshold);
  });
});

describe("step rule", () => {
  it("accepts two similar horizontal surfaces a small jump apart (a tread nosing)", () => {
    expect(looksLikeStep(0.04, 1.0, 1.2)).toBe(true);
  });
  it("rejects a table edge (far side much lower, big jump) and a sofa back (wall beyond)", () => {
    expect(looksLikeStep(0.25, 1.0, 1.2)).toBe(false);
    expect(looksLikeStep(0.05, 0.1, 2.0)).toBe(false);
    expect(looksLikeStep(0.05, 1.0, -0.5)).toBe(false);
  });
});

describe("step edge finder", () => {
  it("finds the nosings of a synthetic staircase and measures their contrast", () => {
    const w = 200;
    const h = 200;
    const depth = new Float32Array(w * h);
    // Floor ramp towards the viewer plus a jump at every tread nosing.
    const nosings = [80, 110, 140, 170];
    for (let y = 0; y < h; y++) {
      const jumps = nosings.filter((n) => y >= n).length;
      for (let x = 0; x < w; x++) depth[y * w + x] = y * 0.5 + jumps * 12;
    }
    const segs = findStepEdges(depth, w, h);
    const ys = segs.map((s) => Math.round(((s.y0 + s.y1) / 2) * h)).sort((a, b) => a - b);
    for (const n of nosings) expect(ys.some((y) => Math.abs(y - n) <= 3)).toBe(true);

    // Dark treads, a light strip on each nosing: high contrast.
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = nosings.some((n) => y >= n && y < n + 6) ? 230 : 40;
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    const img = { width: w, height: h, data } as unknown as ImageData;
    const s = segs.find((q) => Math.abs(q.y0 * h - 110) < 4)!;
    expect(edgeContrast(img, s)).toBeGreaterThan(1);
  });
  it("ignores a smooth floor", () => {
    const w = 120;
    const h = 120;
    const depth = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) depth[y * w + x] = y * 0.8;
    expect(findStepEdges(depth, w, h)).toHaveLength(0);
  });
});
