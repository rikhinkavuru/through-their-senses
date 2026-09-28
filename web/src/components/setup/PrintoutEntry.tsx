"use client";

import { isBlindSpot, PRINTOUT_ROWS } from "@/lib/field";
import type { Grid } from "@/lib/types";

/**
 * Type the Total Deviation numbers from a Humphrey 24-2 printout, laid out exactly
 * as printed for that eye. Empty cells count as not tested.
 */
export function PrintoutEntry({ eye, grid, onChange }: { eye: "right" | "left"; grid: Grid; onChange: (g: Grid) => void }) {
  const set = (r: number, c: number, raw: string) => {
    const next = grid.map((row) => [...row]);
    const t = raw.trim().replace("−", "-");
    const v = t === "" || t === "-" ? null : Number(t);
    next[r][c] = v === null || Number.isNaN(v) ? null : Math.max(-40, Math.min(10, v));
    onChange(next);
  };
  return (
    <fieldset>
      <legend className="font-bold">{eye === "right" ? "Right eye" : "Left eye"}</legend>
      <div className="mt-3 inline-grid gap-1" style={{ gridTemplateColumns: "repeat(10, minmax(0, 2.6rem))" }}>
        {PRINTOUT_ROWS.map((row, r) =>
          Array.from({ length: 10 }, (_, c) => {
            const active = row[eye].includes(c);
            if (!active) return <span key={`${r}-${c}`} aria-hidden />;
            const blind = isBlindSpot(eye, r, c);
            if (blind)
              return (
                <span key={`${r}-${c}`} className="grid h-11 place-items-center rounded-md bg-ink/[0.08] text-xs text-graphite" title="Blind spot, not used">
                  ·
                </span>
              );
            const v = grid[r][c];
            return (
              <input
                key={`${r}-${c}`}
                inputMode="numeric"
                aria-label={`${eye} eye, row ${r + 1}, point ${row[eye].indexOf(c) + 1}`}
                defaultValue={v === null ? "" : String(v)}
                onChange={(e) => set(r, c, e.target.value)}
                className="h-11 w-full rounded-md border border-ink/20 bg-white text-center text-[0.95rem] tabular focus:border-ink"
              />
            );
          }),
        )}
      </div>
    </fieldset>
  );
}
