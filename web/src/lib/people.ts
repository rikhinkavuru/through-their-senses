"use client";

import { useSyncExternalStore } from "react";
import type { Person } from "./types";

/**
 * People live only in this browser (localStorage). Nothing about a person's
 * vision or hearing is sent anywhere except the audio of a sentence you record,
 * which the hearing service processes and does not keep.
 */
const KEY = "tts.people.v1";

/**
 * Example profile. A composite of two real, anonymized public records:
 * vision from UWHVF patient 817 (tested from age 61 to 71) and hearing from
 * NHANES 2017-2018 participant 96309 (age 76). "Meera" is a made-up name.
 */
export const EXAMPLE: Person = {
  id: "example",
  name: "Meera",
  pronouns: "she",
  setup: "together",
  fieldId: "uwhvf-817",
  audiogram: {
    right: [30, 30, 25, 30, 45, 70, 70],
    left: [30, 30, 30, 45, 60, 85, 85],
    source: "NHANES 2017-2018, participant 96309, age 76",
    sourceId: "nhanes-96309",
  },
  strategies: [
    "Turns her head to scan the floor before stepping down.",
    "Keeps the hallway light on at night.",
    "Asks people to face her when they talk.",
  ],
  fixes: [],
  notes: "",
  createdAt: "2026-09-28T00:00:00.000Z",
  isExample: true,
};

let cache: Person[] | null = null;
const listeners = new Set<() => void>();

function read(): Person[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Person[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(people: Person[]) {
  cache = people;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(people));
  } catch {
    // Private mode or storage full: keep the in-memory copy for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: Person[] = [];

export function usePeople(): Person[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function usePerson(id: string): Person | null | undefined {
  const people = usePeople();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  if (id === EXAMPLE.id) {
    return people.find((p) => p.id === EXAMPLE.id) ?? EXAMPLE;
  }
  if (!hydrated) return undefined;
  return people.find((p) => p.id === id) ?? null;
}

export function savePerson(person: Person) {
  const people = read();
  const i = people.findIndex((p) => p.id === person.id);
  write(i >= 0 ? people.map((p) => (p.id === person.id ? person : p)) : [...people, person]);
}

export function updatePerson(id: string, patch: Partial<Person>) {
  const base = read().find((p) => p.id === id) ?? (id === EXAMPLE.id ? EXAMPLE : null);
  if (!base) return;
  savePerson({ ...base, ...patch });
}

export function deletePerson(id: string) {
  write(read().filter((p) => p.id !== id));
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
