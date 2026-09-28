/**
 * Turning digital thresholds into dB HL with a biological reference: a helper with
 * typical hearing takes the same test on the same headphones at the same volume.
 * Their thresholds are taken to be the median for their age (ISO 7029), so
 *
 *   HL(person) = T(person) - T(helper) + median HL for the helper's age.
 *
 * Differences cancel the unknown headphone sensitivity and volume setting.
 */

import { FREQS } from "../audiogram";

/**
 * ISO 7029:2017 median threshold shift for otologically normal adults, 18 to 80 years:
 * dH = alpha * (age - 18)^beta dB (Table 1). The helper's sex is not asked, so the
 * men's and women's medians are averaged.
 */
const ISO7029: Record<number, { men: [number, number]; women: [number, number] }> = {
  500: { men: [4.59e-4, 2.537], women: [2.61e-4, 2.708] },
  1000: { men: [7.02e-4, 2.494], women: [2.21e-4, 2.805] },
  2000: { men: [1.56e-3, 2.404], women: [3.12e-4, 2.792] },
  3000: { men: [2.54e-3, 2.35], women: [4.88e-4, 2.728] },
  4000: { men: [3.4e-3, 2.325], women: [7.37e-4, 2.66] },
  6000: { men: [4.53e-3, 2.315], women: [1.47e-3, 2.539] },
  8000: { men: [5.06e-3, 2.328], women: [2.53e-3, 2.439] },
};

export function iso7029Median(age: number, f: number): number {
  const c = ISO7029[f];
  if (!c) return 0;
  const y = Math.min(80, Math.max(18, age)) - 18;
  if (y <= 0) return 0;
  return (c.men[0] * y ** c.men[1] + c.women[0] * y ** c.women[1]) / 2;
}

export interface EarThresholds {
  /** Frequency (Hz) -> threshold in dB FS, or null when there was no response at the loudest level. */
  [f: number]: number | null;
}

export interface EarResult {
  thresholds: EarThresholds;
  /** 1 kHz measured twice: first and retest. */
  retest1k?: [number | null, number | null];
}

export interface Session {
  right: EarResult;
  left: EarResult;
  falseAlarms: number;
  catchTrials: number;
}

export interface ReferencedEar {
  hl: number[]; // at FREQS
  /** True where the person gave no response at the loudest level: the value is a lower bound. */
  atLeast: boolean[];
}

/** The loudest digital level the test plays (keeps clipping and discomfort away). */
export const MAX_LEVEL = -3;

export function referenceEar(person: EarResult, helper: EarResult, helperAge: number): ReferencedEar {
  const hl: number[] = [];
  const atLeast: boolean[] = [];
  for (const f of FREQS) {
    const tp = person.thresholds[f];
    const th = helper.thresholds[f];
    const norm = iso7029Median(helperAge, f);
    if (th === null || th === undefined) {
      // Helper did not respond (should not happen with typical hearing): fall back to no information.
      hl.push(NaN);
      atLeast.push(false);
      continue;
    }
    const p = tp === null || tp === undefined ? MAX_LEVEL + 5 : tp;
    hl.push(Math.max(-10, Math.round((p - th + norm) / 5) * 5));
    atLeast.push(tp === null || tp === undefined);
  }
  return { hl, atLeast };
}

/** Fill any missing frequency from its neighbours so the simulator always has a full audiogram. */
export function fillGaps(v: number[]): number[] {
  const out = [...v];
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i])) continue;
    let l = i - 1;
    while (l >= 0 && !Number.isFinite(out[l])) l--;
    let r = i + 1;
    while (r < out.length && !Number.isFinite(out[r])) r++;
    out[i] = l >= 0 && r < out.length ? (out[l] + out[r]) / 2 : l >= 0 ? out[l] : r < out.length ? out[r] : 0;
  }
  return out;
}
