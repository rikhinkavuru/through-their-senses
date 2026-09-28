/**
 * Contrast sensitivity and threshold helpers shared by the GPU renderer and the
 * home-walk hazard verdicts, so the picture and the verdicts never disagree.
 */

/** Peak contrast sensitivity for an older adult in good light (threshold ~0.7%). */
export const PEAK_SENSITIVITY = 150;

/**
 * Mannos-Sakrison (1974) contrast sensitivity shape, scaled to PEAK_SENSITIVITY,
 * with a floor so very low and very high frequencies keep a finite threshold.
 */
export function sensitivity(cpd: number): number {
  const f = Math.max(cpd, 0.05);
  const shape = 2.6 * (0.0192 + 0.114 * f) * Math.exp(-Math.pow(0.114 * f, 1.1));
  // shape peaks at ~0.98 near 8 cpd
  return Math.max(2, (PEAK_SENSITIVITY * shape) / 0.981);
}

export function normalThreshold(cpd: number): number {
  return 1 / sensitivity(cpd);
}

/**
 * Humphrey perimetry reports sensitivity in dB of stimulus attenuation (0 dB =
 * 10,000 asb on a 31.5 asb background), so a total deviation of TD dB means the
 * increment threshold is 10^(-TD/10) times the age-matched normal. We apply that
 * multiplier to the contrast threshold at that point in the field.
 */
export function thresholdMultiplier(td: number): number {
  return Math.pow(10, -Math.min(td, 0) / 10);
}

/** Weber contrast of an edge between two linear luminances. */
export function weberContrast(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return (hi - lo) / Math.max(lo, 1e-3);
}

/** Linearize an sRGB channel (0-255). */
export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
