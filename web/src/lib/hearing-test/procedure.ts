/**
 * Pure-tone threshold search: the modified Hughson-Westlake method used in clinics
 * (ASHA 2005 guidelines for manual pure-tone audiometry), with a faster first descent.
 *
 *  - Familiarize: start clearly audible; if missed, go up 20 dB until heard.
 *  - Coarse descent: while heard, go down 20 dB (the clinical 10 dB rule, doubled,
 *    because a normal ear often starts 40+ dB above threshold here).
 *  - Then 10 down after a response, 5 up after a miss. A presentation that follows a
 *    miss is "ascending". Threshold = the lowest level with responses on at least 2
 *    ascending presentations and on at least half of them.
 *
 * Levels are digital (dB re full scale). Pure functions, unit-tested with simulated listeners.
 */

export interface SearchState {
  level: number;
  phase: "familiarize" | "coarse" | "fine";
  prevHeard: boolean | null;
  ascending: Record<string, { n: number; heard: number }>;
  history: { level: number; heard: boolean }[];
  done: boolean;
  threshold: number | null;
  /** Not heard at the loudest level allowed: threshold is above maxLevel. */
  noResponse: boolean;
  /** Heard at the quietest level allowed: threshold is at or below minLevel. */
  atFloor: boolean;
}

export interface SearchLimits {
  start: number;
  min: number;
  max: number;
  maxTrials: number;
}

export const DEFAULT_LIMITS: SearchLimits = { start: -45, min: -115, max: -3, maxTrials: 26 };

export function startSearch(lim: SearchLimits = DEFAULT_LIMITS): SearchState {
  return { level: lim.start, phase: "familiarize", prevHeard: null, ascending: {}, history: [], done: false, threshold: null, noResponse: false, atFloor: false };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function recordResponse(s: SearchState, heard: boolean, lim: SearchLimits = DEFAULT_LIMITS): SearchState {
  if (s.done) return s;
  const history = [...s.history, { level: s.level, heard }];
  const ascending = { ...s.ascending };
  const next: SearchState = { ...s, history, ascending, prevHeard: heard };

  if (s.phase === "fine" && s.prevHeard === false) {
    const k = String(s.level);
    const c = ascending[k] ?? { n: 0, heard: 0 };
    ascending[k] = { n: c.n + 1, heard: c.heard + (heard ? 1 : 0) };
    if (ascending[k].heard >= 2 && ascending[k].heard * 2 >= ascending[k].n) {
      return { ...next, done: true, threshold: s.level };
    }
  }

  if (s.phase === "familiarize") {
    if (heard) {
      next.phase = "coarse";
      next.level = s.level - 20;
    } else if (s.level >= lim.max) {
      return { ...next, done: true, noResponse: true, threshold: null };
    } else next.level = Math.min(lim.max, s.level + 20);
  } else if (s.phase === "coarse") {
    if (heard) next.level = s.level - 20;
    else {
      next.phase = "fine";
      next.level = s.level + 10;
    }
  } else {
    next.level = heard ? s.level - 10 : s.level + 5;
  }

  // Heard at the floor twice: stop, the true threshold is lower still.
  if (next.level < lim.min) {
    const floorHits = history.filter((h) => h.level <= lim.min && h.heard).length;
    next.level = lim.min;
    if (floorHits >= 2) return { ...next, done: true, atFloor: true, threshold: lim.min };
  }
  if (next.level > lim.max) {
    const topMisses = history.filter((h) => h.level >= lim.max && !h.heard).length;
    next.level = lim.max;
    if (topMisses >= 2) return { ...next, done: true, noResponse: true, threshold: null };
  }
  next.level = clamp(next.level, lim.min, lim.max);

  if (history.length >= lim.maxTrials) {
    // Out of trials: lowest level heard on an ascending run, else the lowest level heard.
    const asc = Object.entries(ascending)
      .filter(([, c]) => c.heard > 0)
      .map(([l]) => Number(l));
    const heardLevels = history.filter((h) => h.heard).map((h) => h.level);
    const t = asc.length ? Math.min(...asc) : heardLevels.length ? Math.min(...heardLevels) : null;
    return { ...next, done: true, threshold: t, noResponse: t === null };
  }
  return next;
}

/** Test order for one ear: 1 kHz first, up the scale, 1 kHz again as a reliability check, then 500 Hz. */
export const EAR_ORDER = [1000, 2000, 3000, 4000, 6000, 8000, 1000, 500] as const;
