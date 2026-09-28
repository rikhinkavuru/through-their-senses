export type PronounSet = "she" | "he" | "they";

export interface Pronouns {
  subj: string; // she / he / they
  obj: string; // her / him / them
  poss: string; // her / his / their
  is: string; // is / is / are
  has: string; // has / has / have
  s: string; // verb suffix: "sees" vs "see"
}

const SETS: Record<PronounSet, Pronouns> = {
  she: { subj: "she", obj: "her", poss: "her", is: "is", has: "has", s: "s" },
  he: { subj: "he", obj: "him", poss: "his", is: "is", has: "has", s: "s" },
  they: { subj: "they", obj: "them", poss: "their", is: "are", has: "have", s: "" },
};

export function pronouns(set: PronounSet | undefined): Pronouns {
  return SETS[set ?? "they"];
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
