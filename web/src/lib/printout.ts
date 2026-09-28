import { PRINTOUT_ROWS, isBlindSpot } from "./field";

/**
 * Place a photographed Total Deviation plot, read as 8 rows of 10 column slots, onto the
 * 24-2 layout for that eye. When a row's numbers don't sit exactly on the layout, the row is
 * moved one slot if that makes it fit; failing that, a row holding exactly as many numbers as
 * it has test points (the blind-spot blank was usually dropped) is filled in reading order.
 * Any other misfit is a misread row and comes back as null.
 */
export function placeRows(eye: "right" | "left", slots: unknown[]): { rows: ((number | null)[] | null)[]; stray: number } {
  const clean = (v: unknown) => (typeof v === "number" && v >= -40 && v <= 15 ? Math.round(v) : null);
  let stray = 0;
  const rows = PRINTOUT_ROWS.map((layout, i) => {
    const r = slots[i];
    if (!Array.isArray(r) || r.length !== 10) return null;
    const points = layout[eye].filter((c) => !isBlindSpot(eye, i, c));
    const filled = r.flatMap((v, c) => (typeof v === "number" ? [c] : []));
    const shift = [0, 1, -1].find((d) => filled.every((c) => points.includes(c + d)));
    const place = (at: (c: number) => unknown) => layout[eye].map((c) => (isBlindSpot(eye, i, c) ? null : clean(at(c))));
    if (shift !== undefined) return place((c) => r[c - shift]);
    if (filled.length === points.length) return place((c) => r[filled[points.indexOf(c)]]);
    // Numbers where no test point can be: probably part of another plot.
    stray += filled.filter((c) => !points.includes(c)).length;
    return null;
  });
  return { rows, stray };
}
