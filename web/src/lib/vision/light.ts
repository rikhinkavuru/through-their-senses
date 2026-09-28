/**
 * How light level changes what someone can see: published models only, with the
 * assumptions named.
 *
 * Scenes. Eye illuminance measured in real homes (Miller & Kinzey 2018, IES LD+A,
 * 30 homes, medians): 23 lx in a living room under normal evening lighting, 2 lx with
 * only a TV on. Walls of reflectance 0.5 then have luminance L = 0.5 E / pi: about
 * 3.7 cd/m2 in the evening and 0.3 cd/m2 at night, both mesopic (CIE 191:2010,
 * 0.005-5 cd/m2). Daytime indoors is taken as 100 cd/m2, where the normal contrast
 * sensitivity curve in csf.ts applies.
 *
 * 1. Everyone: contrast sensitivity falls in dim light, and more for fine detail.
 *    Barten's (1999) model gives the ratio at each spatial frequency.
 * 2. Glaucoma: in dim light the diffuse part of the loss deepens while local scotomas
 *    keep their depth (Drum, Armaly & Huppert 1986: diffuse scotopic loss about twice
 *    the photopic, in log units). We add the diffuse loss again, scaled from 0 at the
 *    top of the mesopic range to 1 at its bottom (log-luminance interpolation, our
 *    assumption between their photopic and scotopic measurements).
 * 3. Glare: light scattered in the eye veils the scene near bright sources. CIE
 *    146:2002 gives the scatter for a given age (Vos & van den Berg). No study we found
 *    shows extra straylight from glaucoma itself, so only age enters.
 */

export type Light = "day" | "evening" | "night";

export const SCENES: Record<Light, { eyeLux: number; wallCdm2: number; display: number; label: string }> = {
  day: { eyeLux: 0, wallCdm2: 100, display: 1, label: "Daylight" },
  evening: { eyeLux: 23, wallCdm2: (0.5 * 23) / Math.PI, display: 0.42, label: "Evening lamps" },
  night: { eyeLux: 2, wallCdm2: (0.5 * 2) / Math.PI, display: 0.16, label: "TV light only" },
};

/** Assumed luminance of a lamp shade or bright window (cd/m2): photos clip these, so it cannot be measured from the picture. */
export const SOURCE_CDM2 = 1000;
/** Age of the person viewing the app, for the glare on the "you" side. */
export const VIEWER_AGE = 25;
/** CIE eye pigmentation factor: 0 very dark, 0.5 brown, 1 blue-green. Unknown, so the middle. */
export const PIGMENT = 0.5;

/**
 * Barten (1999) contrast sensitivity at spatial frequency u (c/deg) and luminance L
 * (cd/m2), for an object X0 degrees across; the pupil follows the whole adapting
 * field (fieldDeg), per Watson & Yellott (2012).
 */
export function barten(u: number, L: number, X0 = 4, fieldDeg = 40): number {
  const k = 3.0;
  const T = 0.1;
  const eta = 0.03;
  const Phi0 = 3e-8;
  const u0 = 7;
  const Xmax = 12;
  const Nmax = 15;
  const p = 1.2274e6;
  const s0 = 0.5 / 60;
  const Cab = 0.08 / 60;
  const d = 5 - 3 * Math.tanh(0.4 * Math.log10((L * fieldDeg * fieldDeg) / (40 * 40)));
  const E = ((Math.PI * d * d) / 4) * L * (1 - (d / 9.7) ** 2 + (d / 12.4) ** 4);
  const sigma = Math.sqrt(s0 * s0 + (Cab * d) ** 2);
  const M = Math.exp(-2 * Math.PI ** 2 * sigma ** 2 * u * u);
  const X = 1 / (X0 * X0) + 1 / (Xmax * Xmax) + (u * u) / (Nmax * Nmax);
  const uu = Math.max(u, 0.05);
  return M / k / Math.sqrt((2 / T) * X * X * (1 / (eta * p * E) + Phi0 / (1 - Math.exp(-((uu / u0) ** 2)))));
}

/** Factor by which everyone's contrast threshold rises at this frequency, relative to daylight. */
export function dimFactor(cpd: number, light: Light): number {
  if (light === "day") return 1;
  const u = Math.max(0.25, cpd);
  return barten(u, SCENES.day.wallCdm2) / barten(u, SCENES[light].wallCdm2);
}

/** Share of the diffuse loss added again in this light (0 at 5 cd/m2 and above, 1 at 0.005 cd/m2). */
export function diffuseWeight(light: Light): number {
  const L = SCENES[light].wallCdm2;
  return Math.min(1, Math.max(0, Math.log10(5 / L) / Math.log10(5 / 0.005)));
}

/**
 * Diffuse component of a field loss: the general height, taken as the 85th percentile
 * of total deviation (the 7th best of 52 points, as in pattern deviation), capped at 0.
 */
export function diffuseLoss(tds: number[]): number {
  if (!tds.length) return 0;
  const s = [...tds].sort((a, b) => b - a);
  return Math.min(0, s[Math.max(0, Math.min(s.length - 1, Math.floor(s.length * 0.15) - 1))]);
}

/** Extra threshold factor for glaucoma in this light, everywhere in the field. */
export function glaucomaDimFactor(diffuseTd: number, light: Light): number {
  return Math.pow(10, (-diffuseTd / 10) * diffuseWeight(light));
}

/**
 * CIE 146:2002 general disability glare equation: equivalent veiling luminance per
 * unit glare illuminance at the eye, (cd/m2)/lx = 1/sr, at angle theta (deg), age A.
 * Valid from 0.1 to about 100 degrees.
 */
export function ciePsf(thetaDeg: number, age: number, p = PIGMENT): number {
  const t = Math.max(0.1, thetaDeg);
  return 10 / t ** 3 + (5 / t ** 2 + (0.1 * p) / t) * (1 + (age / 62.5) ** 4) + 0.0025 * p;
}

/**
 * Brightness of a clipped light source in units of the picture's white (a white wall,
 * reflectance 0.9, under the scene's light), for the glare veil.
 */
export function sourceRatio(light: Light): number {
  if (light === "day") return 0;
  return SOURCE_CDM2 / ((0.9 / 0.5) * SCENES[light].wallCdm2);
}
