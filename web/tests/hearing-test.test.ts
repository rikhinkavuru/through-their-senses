import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, recordResponse, startSearch } from "../src/lib/hearing-test/procedure";
import { fillGaps, iso7029Median, referenceEar } from "../src/lib/hearing-test/reference";

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

/** Simulated listener: logistic psychometric function around a true threshold, with lapses and false alarms. */
function runSearch(trueT: number, seed: number, start = DEFAULT_LIMITS.start, fa = 0.02, slope = 1.5) {
  const r = rng(seed);
  let s = startSearch({ ...DEFAULT_LIMITS, start });
  while (!s.done) {
    const p = fa + (1 - fa - 0.02) / (1 + Math.exp(-(s.level - trueT) / slope));
    s = recordResponse(s, r() < p);
  }
  return s;
}

function stats(errs: number[]) {
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / errs.length);
  return { mean, sd, within10: errs.filter((e) => Math.abs(e) <= 10).length / errs.length };
}

describe("Hughson-Westlake search", () => {
  // The method's small upward bias (it finds a level heard on most ascending runs) is the
  // same for the helper and the person, so it cancels in the difference.
  it("finds the threshold with a small, consistent bias and a spread of about 3 dB", () => {
    const errs: number[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      const t = -100 + (seed % 90);
      const s = runSearch(t, seed);
      expect(s.threshold).not.toBeNull();
      errs.push(s.threshold! - t);
    }
    const st = stats(errs);
    expect(st.mean).toBeGreaterThan(0);
    expect(st.mean).toBeLessThan(4);
    expect(st.sd).toBeLessThan(4);
    expect(st.within10).toBeGreaterThan(0.98);
  });

  it("is quicker when it starts near the threshold (the next frequency starts from the last)", () => {
    const far: number[] = [];
    const near: number[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const t = -95 + (seed % 60);
      far.push(runSearch(t, seed).history.length);
      near.push(runSearch(t, seed, t + 15).history.length);
    }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(near)).toBeLessThan(avg(far));
    expect(avg(near)).toBeLessThan(9);
  });

  it("reports no response when the tone is never heard", () => {
    let s = startSearch();
    while (!s.done) s = recordResponse(s, false);
    expect(s.noResponse).toBe(true);
    expect(s.threshold).toBeNull();
  });

  it("stops at the floor when everything is heard", () => {
    let s = startSearch();
    while (!s.done) s = recordResponse(s, true);
    expect(s.atFloor).toBe(true);
    expect(s.threshold).toBe(DEFAULT_LIMITS.min);
  });
});

describe("biological reference", () => {
  it("follows ISO 7029:2017: zero at 18, grows with age and frequency", () => {
    expect(iso7029Median(18, 4000)).toBe(0);
    expect(iso7029Median(16, 4000)).toBe(0);
    expect(iso7029Median(60, 4000)).toBeGreaterThan(iso7029Median(60, 1000));
    expect(iso7029Median(70, 4000)).toBeGreaterThan(iso7029Median(50, 4000));
    // Order of magnitude check against the standard's median at 70 years, 4 kHz (roughly 30 dB).
    expect(iso7029Median(70, 4000)).toBeGreaterThan(20);
    expect(iso7029Median(70, 4000)).toBeLessThan(45);
  });

  it("turns the difference from the helper into dB HL", () => {
    const helper = { thresholds: { 500: -80, 1000: -90, 2000: -92, 3000: -88, 4000: -85, 6000: -80, 8000: -75 } };
    const person = { thresholds: { 500: -50, 1000: -60, 2000: -55, 3000: -45, 4000: -40, 6000: null, 8000: null } };
    const r = referenceEar(person, helper, 18);
    expect(r.hl.slice(0, 5)).toEqual([30, 30, 35, 45, 45]);
    expect(r.atLeast).toEqual([false, false, false, false, false, true, true]);
  });

  it("fills gaps from neighbours", () => {
    expect(fillGaps([10, NaN, 30, NaN])).toEqual([10, 20, 30, 30]);
  });
});
