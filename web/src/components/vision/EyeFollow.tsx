"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { Features } from "@/lib/gaze/features";
import { OneEuro } from "@/lib/gaze/filter";
import { crossValidatedError, fitGaze, predictGaze, type GazeModel } from "@/lib/gaze/regression";
import { EyeTracker } from "@/lib/gaze/tracker";

// Calibration targets in screen fractions: a 3x3 grid plus four points between.
const TARGETS: [number, number][] = [
  [0.5, 0.5],
  [0.1, 0.12],
  [0.5, 0.12],
  [0.9, 0.12],
  [0.9, 0.5],
  [0.9, 0.88],
  [0.5, 0.88],
  [0.1, 0.88],
  [0.1, 0.5],
  [0.3, 0.31],
  [0.7, 0.31],
  [0.7, 0.69],
  [0.3, 0.69],
];
const SETTLE_MS = 700; // eyes land on the dot
const COLLECT_MS = 900;
const MIN_SAMPLES = 8;
const LAMBDAS = [0.005, 0.02, 0.08, 0.3];

type Phase = "loading" | "intro" | "calibrating" | "result" | "tracking" | "error";

interface Props {
  personName: string;
  /** Degrees of the scene per screen pixel horizontally, to report accuracy in the picture's terms. */
  degPerPx: number;
  onGaze: (g: [number, number]) => void;
  onStop: () => void;
}

export function EyeFollow({ personName, degPerPx, onGaze, onStop }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [accuracyDeg, setAccuracyDeg] = useState<number | null>(null);
  const [lost, setLost] = useState(false);
  const trackerRef = useRef<EyeTracker | null>(null);
  const sink = useRef<((f: Features) => void) | null>(null);
  const modelRef = useRef<GazeModel | null>(null);
  const filters = useRef([new OneEuro(), new OneEuro()]);
  const lastFace = useRef(0);

  // Start the camera and face model once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await EyeTracker.create();
        if (cancelled) return t.close();
        trackerRef.current = t;
        await t.start((f, tMs) => {
          if (f && !f.blink) {
            lastFace.current = tMs;
            sink.current?.(f);
          }
        });
        if (!cancelled) setPhase("intro");
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera in your browser settings to follow your eyes."
            : "Eye tracking could not start here. It needs a webcam and a recent browser.",
        );
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      trackerRef.current?.close();
      trackerRef.current = null;
      sink.current = null;
    };
  }, []);

  const calibrate = useCallback(async () => {
    setPhase("calibrating");
    sink.current = null;
    const feats: number[][] = [];
    const tgts: [number, number][] = [];
    const groups: number[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < TARGETS.length; i++) {
      for (let attempt = 0; attempt < 2; attempt++) {
        setTarget(i);
        setCollecting(false);
        await wait(SETTLE_MS);
        setCollecting(true);
        const got: number[][] = [];
        sink.current = (f) => got.push(f.vector);
        await wait(COLLECT_MS);
        sink.current = null;
        if (got.length >= MIN_SAMPLES) {
          for (const v of got) {
            feats.push(v);
            tgts.push(TARGETS[i]);
            groups.push(i);
          }
          break;
        }
      }
    }
    setCollecting(false);
    if (new Set(groups).size < 9) {
      setError("It couldn’t see your eyes clearly enough. Face the screen, with light on your face, and try again.");
      setPhase("intro");
      return;
    }
    // Pick the penalty by leave-one-point-out error, then fit on everything.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toPx = (t: [number, number]) => [t[0] * w, t[1] * h] as [number, number];
    const pxTargets = tgts.map(toPx);
    let best = { lambda: LAMBDAS[1], err: Infinity };
    for (const lambda of LAMBDAS) {
      const err = crossValidatedError(feats, pxTargets, groups, lambda);
      if (err < best.err) best = { lambda, err };
    }
    modelRef.current = fitGaze(feats, tgts, best.lambda);
    setAccuracyDeg(best.err * degPerPx);
    setError(null);
    setPhase("result");
  }, [degPerPx]);

  // Follow the eyes.
  useEffect(() => {
    if (phase !== "tracking") return;
    filters.current.forEach((f) => f.reset());
    sink.current = (f) => {
      const m = modelRef.current;
      if (!m) return;
      const [x, y] = predictGaze(m, f.vector);
      const t = performance.now() / 1000;
      const gx = filters.current[0].filter(x, t);
      const gy = filters.current[1].filter(y, t);
      onGaze([Math.min(1, Math.max(0, gx)), Math.min(1, Math.max(0, gy))]);
    };
    const iv = setInterval(() => setLost(performance.now() - lastFace.current > 1200), 300);
    return () => {
      sink.current = null;
      clearInterval(iv);
    };
  }, [phase, onGaze]);

  if (phase === "tracking") {
    return (
      <div className="pointer-events-auto absolute inset-x-4 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] z-10 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-black/65 px-4 py-2.5 text-[0.95rem] backdrop-blur-md">
        <span className="mr-auto" role="status">
          {lost ? "Can’t see your eyes. Face the screen." : `Following your eyes, to within about ${accuracyDeg?.toFixed(1)}°.`}
        </span>
        <button onClick={calibrate} className="min-h-11 rounded-full bg-white/12 px-4">
          Calibrate again
        </button>
        <button onClick={onStop} className="min-h-11 rounded-full bg-white px-4 font-bold text-ink">
          Stop
        </button>
      </div>
    );
  }

  if (phase === "calibrating") {
    const [tx, ty] = TARGETS[target];
    return (
      <div className="fixed inset-0 z-40 cursor-none bg-[#20262a]" aria-live="polite">
        <p className="absolute inset-x-0 top-6 text-center text-[1rem] text-white/80">
          Look at the dot until it shrinks. Keep your head still. ({target + 1} of {TARGETS.length})
        </p>
        <div
          className="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-300 ease-[var(--ease-spring)]"
          style={{ left: `${tx * 100}%`, top: `${ty * 100}%` }}
          aria-hidden
        >
          <span
            className="absolute inset-0 rounded-full bg-[#c4382e]"
            style={{ transform: collecting ? "scale(0.35)" : "scale(1)", transition: `transform ${collecting ? COLLECT_MS : 200}ms linear` }}
          />
          <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="eyes-title" className="w-full max-w-md rounded-3xl bg-paper p-6 text-ink shadow-2xl">
        <h2 id="eyes-title" className="text-title font-light">
          Follow your eyes
        </h2>
        {phase === "loading" && <p className="mt-3 leading-relaxed text-graphite">Starting the camera and face tracker…</p>}
        {phase === "error" && <p className="mt-3 leading-relaxed">{error}</p>}
        {phase === "intro" && (
          <>
            <p className="mt-3 leading-relaxed">
              The webcam watches where you look, and {personName}’s field moves with your eyes, the way it moves with {personName}’s. The camera picture stays on this device.
            </p>
            <p className="mt-3 leading-relaxed text-graphite">
              First, look at {TARGETS.length} dots in turn (about 20 seconds). Sit about an arm’s length away with light on your face.
            </p>
            {error && <p className="mt-3 rounded-2xl bg-ink/[0.06] px-4 py-3 leading-relaxed">{error}</p>}
          </>
        )}
        {phase === "result" && accuracyDeg !== null && (
          <>
            <p className="mt-3 leading-relaxed">
              Tracking lands within about <strong className="tabular">{accuracyDeg.toFixed(1)}°</strong> of where you look, in this picture’s terms (checked by hiding each dot in turn and
              predicting it from the others).
            </p>
            <p className="mt-3 leading-relaxed text-graphite">
              {accuracyDeg <= 4
                ? "Good enough to follow: the field test points are 6° apart."
                : accuracyDeg <= 7
                  ? "Usable, but loose: the field test points are 6° apart, so small patches may drift. Better light usually helps."
                  : "Too loose to trust. Try more light on your face, keep your head still, and calibrate again."}
            </p>
          </>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button kind="secondary" onClick={onStop}>
            {phase === "result" ? "Cancel" : "Close"}
          </Button>
          {phase === "intro" && <Button onClick={calibrate}>Start</Button>}
          {phase === "result" && (
            <>
              <Button kind="secondary" onClick={calibrate}>
                Calibrate again
              </Button>
              <Button onClick={() => setPhase("tracking")} disabled={(accuracyDeg ?? 99) > 7}>
                Follow my eyes
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
