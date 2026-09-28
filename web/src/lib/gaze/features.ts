/**
 * Eye features for webcam gaze estimation, from MediaPipe Face Landmarker output
 * (478 landmarks with irises, blendshapes, head transform). Pure and unit-tested.
 *
 * Each iris centre is expressed in its own eye's frame (origin between the corners,
 * x along the corner line, scaled by eye width), which removes head roll and
 * distance. Head yaw, pitch and position are included so the calibration can
 * absorb small head movements. Blendshape gaze scores add vertical information that
 * the iris position alone carries poorly (the lids cover it).
 */

export interface Pt {
  x: number;
  y: number;
  z?: number;
}

// MediaPipe Face Mesh indices. "Right" is the subject's right eye.
const R = { outer: 33, inner: 133, upper: 159, lower: 145, iris: 468 };
const L = { outer: 263, inner: 362, upper: 386, lower: 374, iris: 473 };

/** Eye openness below this (lid gap / eye width) counts as a blink. */
export const BLINK_OPENNESS = 0.1;

function eye(lm: Pt[], e: typeof R, w: number, h: number) {
  const p = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const a = p(e.outer);
  const b = p(e.inner);
  const ox = (a.x + b.x) / 2;
  const oy = (a.y + b.y) / 2;
  const width = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // x axis from the subject's right to left in the image (consistent for both eyes).
  const sgn = a.x < b.x ? 1 : -1;
  const ux = (sgn * (b.x - a.x)) / width;
  const uy = (sgn * (b.y - a.y)) / width;
  const i = p(e.iris);
  const dx = i.x - ox;
  const dy = i.y - oy;
  const up = p(e.upper);
  const lo = p(e.lower);
  return {
    ix: (dx * ux + dy * uy) / width,
    iy: (-dx * uy + dy * ux) / width,
    open: Math.hypot(lo.x - up.x, lo.y - up.y) / width,
    width,
  };
}

export interface FeatureInput {
  landmarks: Pt[];
  videoWidth: number;
  videoHeight: number;
  /** Blendshape name -> score. */
  blend?: Record<string, number>;
  /** 4x4 column-major facial transformation matrix. */
  matrix?: ArrayLike<number>;
}

export interface Features {
  vector: number[];
  blink: boolean;
  /** Iris-to-camera distance estimate in iris diameters is not needed; eye width (px) tracks distance. */
  eyeWidthPx: number;
}

export function gazeFeatures({ landmarks, videoWidth: w, videoHeight: h, blend = {}, matrix }: FeatureInput): Features | null {
  if (landmarks.length < 478) return null;
  const r = eye(landmarks, R, w, h);
  const l = eye(landmarks, L, w, h);
  const blink = Math.min(r.open, l.open) < BLINK_OPENNESS;
  const b = (k: string) => blend[k] ?? 0;
  const hBlend = (b("eyeLookInLeft") - b("eyeLookOutLeft") + b("eyeLookOutRight") - b("eyeLookInRight")) / 2;
  const vBlend = (b("eyeLookUpLeft") + b("eyeLookUpRight") - b("eyeLookDownLeft") - b("eyeLookDownRight")) / 2;
  let yaw = 0;
  let pitch = 0;
  let tx = 0;
  let ty = 0;
  let tz = 0;
  if (matrix && matrix.length >= 16) {
    // Forward axis of the face is the third column of the rotation.
    yaw = Math.atan2(matrix[8], matrix[10]);
    pitch = Math.asin(Math.max(-1, Math.min(1, matrix[9])));
    tx = matrix[12];
    ty = matrix[13];
    tz = matrix[14];
  } else {
    // Without the transform, use where the face sits in the frame.
    const nose = landmarks[1];
    tx = nose.x;
    ty = nose.y;
    tz = (r.width + l.width) / 2 / w;
  }
  return {
    vector: [(r.ix + l.ix) / 2, (r.iy + l.iy) / 2, yaw, pitch, tx, ty, tz, hBlend, vBlend],
    blink,
    eyeWidthPx: (r.width + l.width) / 2,
  };
}
