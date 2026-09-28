import { describe, expect, it } from "vitest";
import { barten, ciePsf, diffuseLoss, diffuseWeight, dimFactor, glaucomaDimFactor, SCENES, sourceRatio } from "../src/lib/vision/light";

describe("Barten contrast sensitivity", () => {
  it("peaks at a few cycles per degree in daylight", () => {
    const freqs = [0.5, 1, 2, 3, 4, 6, 8, 12, 16];
    const s = freqs.map((u) => barten(u, 100));
    const peak = freqs[s.indexOf(Math.max(...s))];
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(peak).toBeLessThanOrEqual(6);
  });
  it("loses fine detail first as light falls", () => {
    for (const l of ["evening", "night"] as const) {
      expect(dimFactor(16, l)).toBeGreaterThan(dimFactor(1, l));
      expect(dimFactor(1, l)).toBeGreaterThanOrEqual(1);
    }
    expect(dimFactor(4, "night")).toBeGreaterThan(dimFactor(4, "evening"));
    expect(dimFactor(4, "day")).toBe(1);
  });
});

describe("scenes", () => {
  it("puts evening and night in the mesopic range (0.005 to 5 cd/m2)", () => {
    for (const l of ["evening", "night"] as const) {
      expect(SCENES[l].wallCdm2).toBeGreaterThan(0.005);
      expect(SCENES[l].wallCdm2).toBeLessThan(5);
    }
  });
  it("makes lamps relatively brighter at night", () => {
    expect(sourceRatio("night")).toBeGreaterThan(sourceRatio("evening"));
    expect(sourceRatio("day")).toBe(0);
  });
});

describe("glaucoma in dim light (diffuse loss deepens)", () => {
  it("takes the general height as the diffuse loss", () => {
    const tds = [...Array(45).fill(-20), ...Array(7).fill(-3)];
    expect(diffuseLoss(tds)).toBe(-3);
    expect(diffuseLoss([1, 2, 3])).toBe(0);
  });
  it("adds nothing in daylight and more at night", () => {
    expect(diffuseWeight("day")).toBe(0);
    expect(glaucomaDimFactor(-6, "day")).toBe(1);
    expect(glaucomaDimFactor(-6, "night")).toBeGreaterThan(glaucomaDimFactor(-6, "evening"));
    expect(glaucomaDimFactor(0, "night")).toBe(1);
  });
});

describe("CIE 146:2002 glare", () => {
  it("falls off with angle and grows with age", () => {
    expect(ciePsf(2, 70)).toBeGreaterThan(ciePsf(10, 70));
    expect(ciePsf(10, 70)).toBeGreaterThan(ciePsf(10, 25));
  });
  it("matches the equation at 10 degrees, age 70, brown eyes", () => {
    const expected = 10 / 1000 + (5 / 100 + 0.05 / 10) * (1 + (70 / 62.5) ** 4) + 0.0025 * 0.5;
    expect(ciePsf(10, 70)).toBeCloseTo(expected, 10);
  });
});
