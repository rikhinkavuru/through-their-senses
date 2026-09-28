export interface PhonemeAudibility {
  p: string;
  a: number;
  f: number;
}

export interface HeardWord {
  said: string;
  heard?: string | null;
  /** Missing until the proxy listener has run. */
  status?: "heard" | "misheard" | "unclear";
  audibility: { word: string; phonemes: PhonemeAudibility[]; letters: number[]; score: number };
}

/** Built up as the hearing service streams each stage. */
export interface HearResult {
  said: string;
  words: HeardWord[];
  betterEar: "left" | "right";
  audio: { you: string; her?: string };
  herText?: string;
  /** Every heard word in order (including ones that replace or add to what was said). */
  heardTokens?: { w: string; s: "ok" | "wrong" | "unclear"; said?: string | null }[];
  herCorrect?: number;
  total?: number;
  typicalCorrect?: number;
  pending: { her: boolean; typical: boolean };
}

export interface Suggestion {
  text: string;
  why: string;
  score: number;
  correct: number;
  total: number;
  herText: string;
}

export interface RewordResult {
  original: { text: string; score: number; correct: number; total: number; herText: string };
  suggestions: Suggestion[];
  checked: number;
}

/** ARPAbet to the spelling people recognise. */
const FRIENDLY: Record<string, string> = {
  S: "s", Z: "z", F: "f", V: "v", TH: "th", DH: "th", T: "t", D: "d", K: "k", G: "g", P: "p", B: "b",
  SH: "sh", ZH: "zh", CH: "ch", JH: "j", HH: "h", M: "m", N: "n", NG: "ng", L: "l", R: "r", W: "w", Y: "y",
  AA: "ah", AE: "a", AH: "uh", AO: "aw", AW: "ow", AY: "eye", EH: "e", ER: "er", EY: "ay", IH: "i", IY: "ee",
  OW: "oh", OY: "oy", UH: "u", UW: "oo",
};

export function friendly(p: string): string {
  return FRIENDLY[p] ?? p.toLowerCase();
}

/** Sounds in this sentence that fall mostly below her thresholds. */
export function hardSounds(r: HearResult, cutoff = 0.35): string[] {
  const set = new Set<string>();
  for (const w of r.words) for (const ph of w.audibility.phonemes) if (ph.a < cutoff) set.add(friendly(ph.p));
  return [...set];
}

export function missedWords(r: HearResult): string[] {
  return r.words.filter((w) => w.status !== "heard").map((w) => w.said);
}
