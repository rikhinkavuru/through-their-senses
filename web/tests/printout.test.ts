import { describe, expect, it } from "vitest";
import { isBlindSpot, PRINTOUT_ROWS } from "../src/lib/field";
import { placeRows } from "../src/lib/printout";

type Eye = "right" | "left";

/** A printout's values as the model should read them: each value in its own column slot. */
function truth(eye: Eye) {
  return PRINTOUT_ROWS.map((layout, r) => {
    const slots: (number | null)[] = Array(10).fill(null);
    for (const c of layout[eye]) if (!isBlindSpot(eye, r, c)) slots[c] = -(r * 4 + c + 1);
    return slots;
  });
}
const expected = (eye: Eye) => PRINTOUT_ROWS.map((layout, r) => layout[eye].map((c) => (isBlindSpot(eye, r, c) ? null : -(r * 4 + c + 1))));

describe("placeRows", () => {
  for (const eye of ["right", "left"] as Eye[]) {
    it(`keeps a correctly aligned ${eye}-eye read as is`, () => {
      expect(placeRows(eye, truth(eye))).toEqual({ rows: expected(eye), stray: 0 });
    });

    it(`moves ${eye}-eye rows read one slot off back into place`, () => {
      // Toward the side the eye's layout leaves empty (slot 9 for a right eye, slot 0 for a left).
      const off = truth(eye).map((row) => (eye === "right" ? [null, ...row.slice(0, 9)] : [...row.slice(1), null]));
      expect(placeRows(eye, off)).toEqual({ rows: expected(eye), stray: 0 });
    });

    it(`restores a dropped blind-spot blank in the ${eye}-eye middle rows`, () => {
      const read = truth(eye);
      for (const r of [3, 4]) {
        const values = read[r].filter((v) => v !== null);
        // Read as a run of numbers from the first printed slot, with no gap for the blind spot.
        const start = PRINTOUT_ROWS[r][eye][0];
        read[r] = Array.from({ length: 10 }, (_, c) => (c >= start && c - start < values.length ? values[c - start] : null));
      }
      expect(placeRows(eye, read).rows).toEqual(expected(eye));
    });
  }

  it("rejects a row that fits no layout and counts its stray numbers", () => {
    const read = truth("right");
    read[0] = [-1, -2, -3, -4, -5, -6, null, null, null, null];
    const { rows, stray } = placeRows("right", read);
    expect(rows[0]).toBeNull();
    expect(stray).toBe(3);
    expect(rows.slice(1)).toEqual(expected("right").slice(1));
  });

  it("keeps unreadable slots empty and drops impossible values", () => {
    const read = truth("left");
    read[2][4] = null;
    read[2][5] = -99;
    const rows = placeRows("left", read).rows;
    expect(rows[2]).toEqual(expected("left")[2].map((v, j) => ([3, 4].includes(j) ? null : v)));
  });

  it("rejects rows of the wrong length", () => {
    const read: unknown[] = truth("right");
    read[1] = [-1, -2, -3];
    expect(placeRows("right", read).rows[1]).toBeNull();
  });
});
