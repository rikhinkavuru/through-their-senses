"use client";

import { useRef, useState } from "react";
import { isBlindSpot, PRINTOUT_ROWS } from "@/lib/field";
import type { Grid } from "@/lib/types";

interface Reading {
  isHumphrey242: boolean;
  eye: "right" | "left" | "unknown";
  age: number | null;
  rows: ((number | null)[] | null)[];
  badRows: number;
  mdMismatch: boolean;
  error?: string;
}

/** Downscale a photo in the browser so the upload stays small (longest side 1600 px). */
async function toJpeg(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.88);
}

function toGrid(rows: Reading["rows"], eye: "right" | "left"): { grid: Grid; read: number; slots: number } {
  const grid: Grid = Array.from({ length: 8 }, () => Array.from({ length: 10 }, () => null));
  let read = 0;
  let slots = 0;
  PRINTOUT_ROWS.forEach((layout, r) =>
    layout[eye].forEach((c, i) => {
      if (isBlindSpot(eye, r, c)) return;
      slots++;
      const v = rows[r]?.[i];
      if (typeof v === "number") {
        grid[r][c] = v;
        read++;
      }
    }),
  );
  return { grid, read, slots };
}

/**
 * Photograph a Humphrey printout; Claude reads the Total Deviation numbers into the grid,
 * and the person checks them against the paper.
 */
export function PrintoutPhoto({ eye, onRead }: { eye: "right" | "left"; onRead: (g: Grid, age: number | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  const name = eye === "right" ? "right eye" : "left eye";

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const image = await toJpeg(file);
      const res = await fetch("/api/read-printout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }) });
      const j = (await res.json()) as Reading;
      if (!res.ok || j.error) throw new Error(j.error ?? "The printout could not be read.");
      if (!j.isHumphrey242) throw new Error("That doesn’t look like a Humphrey 24-2 printout. Type the numbers instead.");
      if (j.eye !== "unknown" && j.eye !== eye) throw new Error(`This printout is for the ${j.eye} eye. Use the ${j.eye} eye’s button.`);
      const { grid, read, slots } = toGrid(j.rows, eye);
      if (read === 0) throw new Error("No numbers could be read. Try a sharper photo, flat and in good light.");
      onRead(grid, j.age);
      const warn = j.mdMismatch || read < slots;
      setNote({
        warn,
        text:
          `Read ${read} of ${slots} numbers. ` +
          (j.mdMismatch ? "Their average doesn’t match the printed MD, so some may be from the wrong plot. " : "") +
          "Check every number against the printout before you continue.",
      });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : "The printout could not be read.", warn: true });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/25 px-4 text-[0.95rem] hover:bg-ink/[0.05] disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        {busy ? "Reading the printout…" : `Photograph the ${name} printout`}
      </button>
      {note && (
        <p role="status" className={`max-w-prose text-[0.95rem] leading-relaxed ${note.warn ? "rounded-2xl bg-ink/[0.06] px-4 py-3" : "text-graphite"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
