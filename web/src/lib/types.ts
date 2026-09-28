/** 8 rows x 10 columns of total deviation (dB) in visual-field space.
 *  Row 0 is 21 degrees above fixation, row 7 is 21 below; column 0 is 27 degrees
 *  left, column 9 is 27 right. null = not tested (or the blind spot). */
export type Grid = (number | null)[][];

export interface FieldVisit {
  age: number;
  binocular: Grid;
  binocularFit: Grid;
  right: Grid;
  left: Grid;
  rightFit: Grid;
  leftFit: Grid;
}

export interface FieldProfile {
  id: string;
  source: "UWHVF";
  sourcePatient: string;
  gender: string | null;
  md: number;
  supMd: number;
  infMd: number;
  mdSlopePerYear: number;
  demoCandidate: boolean;
  grid: { xDeg: number[]; yDeg: number[]; spacingDeg: number };
  citation: string;
  visits: FieldVisit[];
}

export interface FieldIndexEntry {
  id: string;
  gender: string | null;
  md: number;
  supMd: number;
  infMd: number;
  mdSlopePerYear: number;
  demoCandidate: boolean;
  firstAge: number;
  lastAge: number;
  nVisits: number;
  preview: Grid;
}

/** Thresholds in dB HL at 500, 1000, 2000, 3000, 4000, 6000, 8000 Hz. */
export interface Audiogram {
  left: number[];
  right: number[];
  source: string;
  sourceId?: string;
  /** Present when the audiogram was measured in the app rather than typed in. */
  measured?: {
    method: "tone-test";
    helperAge: number;
    /** No response at the loudest level: the value is a lower bound. */
    atLeast: { right: boolean[]; left: boolean[] };
    falseAlarms: number;
    catchTrials: number;
    /** Digits-in-noise check, when taken: speech reception thresholds in dB SNR. */
    din?: { person: number; helper: number; predictedDiff?: number };
  };
}

export type SetupMode = "self" | "together" | "for";

export interface AcceptedFix {
  hazardId: string;
  label: string;
  fix: string;
  decision: "yes" | "no" | "later";
  decidedAt: string;
}

export interface Person {
  id: string;
  name: string;
  pronouns: import("./pronouns").PronounSet;
  setup: SetupMode;
  setupBy?: string;
  /** Library field (UWHVF) id, used when customField is absent. */
  fieldId: string;
  /** Field entered by hand from the person's own printout. */
  customField?: FieldProfile;
  audiogram: Audiogram;
  strategies: string[];
  fixes: AcceptedFix[];
  seating?: { note: string };
  /** Rewordings that the hearing model showed come through better. */
  phrases?: string[];
  notes: string;
  createdAt: string;
  isExample?: boolean;
}
