/**
 * Where the lamps are in the sample photos (x0, y0, x1, y1 as fractions of the photo,
 * top-left origin), marked by hand. A photo can't tell a lamp from a white tablecloth:
 * both clip to white. Only these areas cast glare in evening and night light. Windows
 * are left out because at those times they would be dark. The live camera finds
 * bright areas automatically instead.
 */
export const LAMPS: Record<string, [number, number, number, number][]> = {
  hallway: [[0.17, 0.13, 0.25, 0.23]],
  dinner: [[0.5, 0, 0.82, 0.06]],
  stairs: [],
  "living-room": [],
};
