"use client";

import { useEffect, useState } from "react";
import type { Audiogram, FieldIndexEntry, FieldProfile } from "./types";

const fieldCache = new Map<string, Promise<FieldProfile>>();

export function loadField(id: string): Promise<FieldProfile> {
  let p = fieldCache.get(id);
  if (!p) {
    p = fetch(`/data/fields/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`field ${id} not found`);
      return r.json();
    });
    fieldCache.set(id, p);
  }
  return p;
}

export function useField(id: string | undefined): FieldProfile | null {
  const [field, setField] = useState<FieldProfile | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    loadField(id).then((f) => live && setField(f));
    return () => {
      live = false;
    };
  }, [id]);
  return field && field.id === id ? field : null;
}

export interface FieldIndex {
  citation: string;
  profiles: FieldIndexEntry[];
}

export function useFieldIndex(): FieldIndex | null {
  const [idx, setIdx] = useState<FieldIndex | null>(null);
  useEffect(() => {
    fetch("/data/fields.json")
      .then((r) => r.json())
      .then(setIdx);
  }, []);
  return idx;
}

export interface AudiogramLibraryEntry {
  id: string;
  label: string;
  grade: string;
  pta4: number;
  right: number[];
  left: number[];
  source: string;
  age?: number;
  sex?: string;
}

export interface AudiogramLibrary {
  citation: string;
  demo: AudiogramLibraryEntry[];
  typical: AudiogramLibraryEntry[];
}

export function useAudiogramLibrary(): AudiogramLibrary | null {
  const [lib, setLib] = useState<AudiogramLibrary | null>(null);
  useEffect(() => {
    fetch("/data/audiograms.json")
      .then((r) => r.json())
      .then((d) =>
        setLib({
          citation: d.citation,
          demo: d.demo.map((a: AudiogramLibraryEntry) => ({ ...a, label: `Age ${a.age}, ${a.grade.toLowerCase()} loss` })),
          typical: d.typical,
        }),
      );
  }, []);
  return lib;
}

export function toAudiogram(e: AudiogramLibraryEntry): Audiogram {
  return { left: e.left, right: e.right, source: e.source, sourceId: e.id };
}
