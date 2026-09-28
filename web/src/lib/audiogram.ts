import type { Audiogram } from "./types";
import { cap, type Pronouns } from "./pronouns";

export const FREQS = [500, 1000, 2000, 3000, 4000, 6000, 8000] as const;

export function pta4(t: number[]): number {
  // WHO: average of 0.5, 1, 2 and 4 kHz
  return (t[0] + t[1] + t[2] + t[4]) / 4;
}

export function whoGrade(pta: number): string {
  const bands: [number, string][] = [
    [20, "no hearing loss"],
    [35, "mild hearing loss"],
    [50, "moderate hearing loss"],
    [65, "moderately severe hearing loss"],
    [80, "severe hearing loss"],
    [95, "profound hearing loss"],
  ];
  for (const [limit, name] of bands) if (pta < limit) return name;
  return "complete hearing loss";
}

export function betterEar(a: Audiogram): "left" | "right" {
  return pta4(a.left) < pta4(a.right) ? "left" : "right";
}

export function thresholdAt(t: number[], f: number): number {
  const lf = Math.log(f);
  const logs = FREQS.map((q) => Math.log(q));
  if (lf <= logs[0]) return t[0];
  if (lf >= logs[logs.length - 1]) return t[t.length - 1];
  for (let i = 0; i < logs.length - 1; i++) {
    if (lf <= logs[i + 1]) {
      const w = (lf - logs[i]) / (logs[i + 1] - logs[i]);
      return t[i] * (1 - w) + t[i + 1] * w;
    }
  }
  return t[t.length - 1];
}

/**
 * Everyday sounds placed at their approximate pitch and loudness, after the widely
 * used "familiar sounds audiogram" (Northern and Downs). Approximate by nature.
 */
export const FAMILIAR_SOUNDS: { label: string; f: number; db: number }[] = [
  { label: "leaves", f: 5000, db: 12 },
  { label: "birdsong", f: 4500, db: 30 },
  { label: "whisper", f: 2500, db: 25 },
  { label: "clock tick", f: 3200, db: 32 },
  { label: "dripping tap", f: 1200, db: 20 },
  { label: "fridge hum", f: 550, db: 40 },
  { label: "doorbell", f: 1500, db: 65 },
  { label: "dog bark", f: 800, db: 75 },
  { label: "phone ring", f: 2200, db: 80 },
];

/** Speech sounds on the same axes (the "speech banana"). */
export const SPEECH_SOUNDS: { label: string; f: number; db: number }[] = [
  { label: "m", f: 500, db: 45 },
  { label: "oo", f: 600, db: 50 },
  { label: "a", f: 900, db: 55 },
  { label: "ee", f: 2000, db: 42 },
  { label: "sh", f: 3000, db: 35 },
  { label: "t", f: 3000, db: 30 },
  { label: "k", f: 2500, db: 32 },
  { label: "s", f: 5000, db: 25 },
  { label: "f", f: 5000, db: 15 },
  { label: "th", f: 5600, db: 12 },
];

export function describeHearing(a: Audiogram, p: Pronouns): string {
  const ear = betterEar(a);
  const t = a[ear];
  const grade = whoGrade(pta4(t));
  const highs = (t[4] + t[5]) / 2;
  const lows = (t[0] + t[1]) / 2;
  const slope = highs - lows >= 20 ? ` High-pitched sounds are much harder for ${p.obj} than low ones.` : "";
  return `${cap(p.poss)} better ear (${ear}) has ${grade}.${slope}`;
}
