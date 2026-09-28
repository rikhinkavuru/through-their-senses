"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, ViewTransition } from "react";
import { TabBar, usePersonCtx } from "@/components/PersonShell";
import { HelpSheet, QuoteBlock, Toggle } from "@/components/ui";
import { VisionView, type VisionSource, type VisionViewHandle } from "@/components/vision/VisionView";
import { quoteFor } from "@/content/quotes";
import { gridPoints, whatStillWorks } from "@/lib/field";
import { cap } from "@/lib/pronouns";

const SCENES = [
  { id: "hallway", label: "Hallway", hfov: 75 },
  { id: "stairs", label: "Stairs", hfov: 55 },
  { id: "living-room", label: "Living room", hfov: 70 },
  { id: "dinner", label: "Dinner table", hfov: 50 },
] as const;

type SceneId = (typeof SCENES)[number]["id"] | "camera";

/** Where each tested point of the field lands on screen, given the shown field of view. */
function projectPoints(
  grid: ReturnType<typeof gridPoints>,
  w: number,
  h: number,
  srcW: number,
  srcH: number,
  hfov: number,
): { x: number; y: number; td: number }[] {
  if (!w || !h || !srcW || !srcH) return [];
  const srcAspect = srcW / srcH;
  const dstAspect = w / h;
  const sx = srcAspect > dstAspect ? dstAspect / srcAspect : 1;
  const shown = 2 * Math.atan(Math.tan((hfov * Math.PI) / 360) * sx);
  const f = w / 2 / Math.tan(shown / 2);
  const rad = Math.PI / 180;
  return grid.map((p) => ({ x: w / 2 + f * Math.tan(p.x * rad), y: h / 2 - f * Math.tan(p.y * rad), td: p.td }));
}

export default function See() {
  const { person, field, visit, setVisit, grid, p, base } = usePersonCtx();
  const [scene, setScene] = useState<SceneId>("hallway");
  const [facing] = useState<"environment" | "user">("environment");
  const [wipe, setWipe] = useState(0.5);
  const [night, setNight] = useState(false);
  const [showPoints, setShowPoints] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [src, setSrc] = useState<[number, number]>([0, 0]);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<VisionViewHandle>(null);
  const dragging = useRef(false);

  const sceneInfo = SCENES.find((s) => s.id === scene);
  const cameraHfov = src[1] > src[0] ? 52 : 68;
  const hfov = sceneInfo ? sceneInfo.hfov : cameraHfov;
  const source: VisionSource = scene === "camera" ? { kind: "camera", facing } : { kind: "image", src: `/scenes/${scene}.jpg`, hfovDeg: hfov };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Test points fade after the arrival moment unless kept on.
  useEffect(() => {
    const t = setTimeout(() => setShowPoints(false), 2600);
    return () => clearTimeout(t);
  }, []);

  const moveWipe = useCallback((clientX: number) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setWipe(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  }, []);

  const points = projectPoints(gridPoints(grid), box.w, box.h, src[0], src[1], hfov);
  const age = Math.round(field.visits[visit].age);
  const works = whatStillWorks(grid, p);

  return (
    <div className="fixed inset-0 bg-camera text-white">
      <div
        ref={stageRef}
        className="absolute inset-0 touch-none select-none"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          moveWipe(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && moveWipe(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <VisionView
          ref={viewRef}
          grid={grid}
          source={source}
          wipe={wipe}
          night={night}
          cameraHfov={cameraHfov}
          className="absolute inset-0 h-full w-full"
          label={`The ${scene === "camera" ? "camera view" : sceneInfo?.label.toLowerCase()} as ${person.name} sees it on the right of the divider, and as you see it on the left.`}
          onError={(m) => {
            setError(m);
            setScene("hallway");
          }}
          onReady={() => {
            setError(null);
            setSrc(viewRef.current?.videoSize() ?? [0, 0]);
          }}
        />

        {/* Test points projected into the room: the field test, lifted off the chart. */}
        <ViewTransition name="field-map">
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden style={{ opacity: showPoints ? 1 : 0, transition: "opacity 900ms var(--ease-spring)" }}>
            {points.map((q, i) => (
              <circle key={i} cx={q.x} cy={q.y} r={q.td > -4 ? 3 : 5} fill={q.td > -10 ? "white" : "none"} stroke="white" strokeWidth={1.5} opacity={q.td > -4 ? 0.55 : 0.95} />
            ))}
          </svg>
        </ViewTransition>

        {/* Fixation cross: the test assumes this is where she is looking. */}
        <svg className="pointer-events-none absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2" viewBox="-10 -10 20 20" aria-hidden>
          <path d="M-7 0H7M0 -7V7" stroke="black" strokeOpacity="0.5" strokeWidth="4" strokeLinecap="round" />
          <path d="M-7 0H7M0 -7V7" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>

        {/* Wipe divider */}
        {wipe > 0.005 && wipe < 0.995 && (
          <div className="pointer-events-none absolute inset-y-0" style={{ left: `${wipe * 100}%` }}>
            <div className="absolute inset-y-0 -left-px w-0.5 bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.5)]" />
            <div className="absolute top-[42%] -left-6 grid h-12 w-12 place-items-center rounded-full bg-white text-ink shadow-lg">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-4 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-center justify-between gap-3">
          <Link href={base} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/12 px-4 backdrop-blur-md">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {person.name}
          </Link>
          <HelpSheet title="What am I looking at?" dark>
            <p>
              Right of the divider is the room as {person.name} sees it, from {p.poss} own visual field tests. Left of it is how you see it. Drag anywhere to move the divider.
            </p>
            <p>
              Keep your eyes on the cross in the middle: that is where {p.subj} {p.is} looking. The test measures {p.poss} vision with {p.poss} eyes held still, so this is exact only while you do the same.
            </p>
            <p>
              Where {p.poss} vision is weaker, detail and contrast fade. Where it is very weak, things disappear into their surroundings. People with glaucoma describe it this way: 0 of 50 patients in one study
              said it looks like the black tunnel usually shown (Crabb et al., 2013).
            </p>
            <p>Night mode is an approximation of how dim light makes this worse. It is not measured for {p.obj}.</p>
          </HelpSheet>
        </div>
        <div className="mt-3 flex justify-between px-1 text-[0.95rem] font-bold [text-shadow:0_1px_6px_rgba(0,0,0,0.7)]">
          <span style={{ opacity: wipe > 0.12 ? 1 : 0 }}>You</span>
          <span style={{ opacity: wipe < 0.88 ? 1 : 0 }}>
            {person.name}, age {age}
          </span>
        </div>
      </div>

      {error && (
        <p role="status" className="absolute inset-x-4 top-28 rounded-2xl bg-black/70 px-4 py-3 text-[0.95rem] backdrop-blur-md">
          {error}
        </p>
      )}

      {/* Controls in the thumb zone, above the tabs */}
      <div className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pb-3 pt-16">
        <div className="mx-auto max-w-xl space-y-3">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="radiogroup" aria-label="What to look at">
            {[{ id: "camera" as const, label: "My camera" }, ...SCENES].map((s) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={scene === s.id}
                onClick={() => setScene(s.id)}
                className={`min-h-11 shrink-0 rounded-full px-4 text-[0.95rem] ${scene === s.id ? "bg-white font-bold text-ink" : "bg-white/12 backdrop-blur-md"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {field.visits.length > 1 && (
            <label className="flex items-center gap-3 text-[0.95rem]">
              <span className="w-24 shrink-0 tabular">Age {age}</span>
              <input
                type="range"
                min={0}
                max={field.visits.length - 1}
                step={1}
                value={visit}
                onChange={(e) => setVisit(Number(e.target.value))}
                className="h-11 w-full accent-white"
                aria-label="Which visual field test"
                aria-valuetext={`Test ${visit + 1} of ${field.visits.length}, age ${age}`}
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Toggle on={night} onChange={setNight} dark>
              Dim light
            </Toggle>
            <Toggle on={showPoints} onChange={setShowPoints} dark>
              Test points
            </Toggle>
            <button onClick={() => setAdaptOpen((o) => !o)} aria-expanded={adaptOpen} className="min-h-11 rounded-full bg-white/12 px-4 text-[0.95rem] backdrop-blur-md">
              How {p.subj} adapt{p.s}
            </button>
          </div>
        </div>
      </div>

      {adaptOpen && (
        <div className="absolute inset-x-3 bottom-[calc(3.8rem+env(safe-area-inset-bottom))] z-20 max-h-[60dvh] overflow-y-auto rounded-3xl bg-paper p-5 text-ink shadow-2xl sm:mx-auto sm:max-w-lg">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-title font-light">How {p.subj} adapt{p.s}</h2>
            <button onClick={() => setAdaptOpen(false)} className="min-h-11 rounded-full bg-ink/[0.06] px-4">
              Close
            </button>
          </div>
          <ul className="mt-3 space-y-2 leading-relaxed">
            {[...works, ...person.strategies].map((w) => (
              <li key={w} className="flex gap-3">
                <span aria-hidden className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-works" />
                {w}
              </li>
            ))}
            <li className="flex gap-3">
              <span aria-hidden className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-works" />
              {cap(p.subj)} move{p.s} {p.poss} eyes and head to fill in what this still picture can’t: the fading here is what is missed at a single glance.
            </li>
          </ul>
          <QuoteBlock className="mt-5" quote={quoteFor(night ? "light" : "scanning")} />
        </div>
      )}

      <TabBar base={base} dark />
    </div>
  );
}
