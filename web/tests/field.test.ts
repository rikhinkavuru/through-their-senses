import { describe, expect, it } from "vitest";
import { emptyGrid, gridPoints, interpolateField, isBlindSpot, MAP_SIZE, mergeBinocular, PRINTOUT_ROWS, sampleMap, summarize } from "../src/lib/field";
import type { Grid } from "../src/lib/types";

function uniform(td: number, eye?: "right" | "left"): Grid {
  const g = emptyGrid();
  PRINTOUT_ROWS.forEach((row, r) => (eye ? row[eye] : [...new Set([...row.right, ...row.left])]).forEach((c) => (g[r][c] = isBlindSpot("right", r, c) && eye === "right" ? null : td)));
  return g;
}

describe("printout layout", () => {
  it("has the 24-2 row lengths for each eye (54 points)", () => {
    expect(PRINTOUT_ROWS.map((r) => r.right.length)).toEqual([4, 6, 8, 9, 9, 8, 6, 4]);
    expect(PRINTOUT_ROWS.reduce((s, r) => s + r.right.length, 0)).toBe(54);
    expect(PRINTOUT_ROWS.reduce((s, r) => s + r.left.length, 0)).toBe(54);
  });
  it("mirrors the eyes: right eye spans x=-27..21, left eye x=-21..27", () => {
    expect(Math.min(...PRINTOUT_ROWS.flatMap((r) => r.right))).toBe(0);
    expect(Math.max(...PRINTOUT_ROWS.flatMap((r) => r.right))).toBe(8);
    expect(Math.min(...PRINTOUT_ROWS.flatMap((r) => r.left))).toBe(1);
    expect(Math.max(...PRINTOUT_ROWS.flatMap((r) => r.left))).toBe(9);
  });
  it("puts the blind spot at +15 degrees for the right eye and -15 for the left", () => {
    expect(isBlindSpot("right", 3, 7)).toBe(true);
    expect(isBlindSpot("left", 4, 2)).toBe(true);
    expect(isBlindSpot("right", 3, 2)).toBe(false);
  });
});

describe("binocular merge (best location)", () => {
  it("takes the better eye at each point and fills gaps from the other eye", () => {
    const r = uniform(-20, "right");
    const l = uniform(-5, "left");
    const b = mergeBinocular(r, l);
    expect(b[3][4]).toBe(-5); // both tested: better (less negative) wins
    expect(b[3][0]).toBe(-20); // x=-27 only tested by the right eye
    expect(b[3][9]).toBe(-5); // x=+27 only tested by the left eye
  });
});

describe("interpolation", () => {
  it("reproduces a uniform field and marks the far periphery untested", () => {
    const map = interpolateField(uniform(-8));
    expect(sampleMap(map, 0, 0)).toBeCloseTo(-8, 5);
    expect(sampleMap(map, 15, -15)).toBeCloseTo(-8, 5);
    expect(Number.isNaN(sampleMap(map, 32, 32))).toBe(true);
    expect(map.length).toBe(MAP_SIZE * MAP_SIZE);
  });
  it("keeps a lower-field defect in the lower field", () => {
    const g = uniform(0);
    g.forEach((row, r) => row.forEach((v, c) => r >= 4 && v !== null && (g[r][c] = -25)));
    const map = interpolateField(g);
    expect(sampleMap(map, 0, -12)).toBeLessThan(-20);
    expect(sampleMap(map, 0, 12)).toBeGreaterThan(-2);
    expect(summarize(g).worstRegion).toBe("lower");
  });
});

describe("gridPoints", () => {
  it("skips untested cells", () => {
    expect(gridPoints(emptyGrid())).toHaveLength(0);
  });
});
