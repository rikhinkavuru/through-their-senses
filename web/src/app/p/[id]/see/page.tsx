"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, ViewTransition } from "react";
import { TabBar, usePersonCtx } from "@/components/PersonShell";
import { HelpSheet, QuoteBlock, Toggle } from "@/components/ui";
import { EyeFollow } from "@/components/vision/EyeFollow";
import { LightPicker, lightFromUrl } from "@/components/vision/LightPicker";
import { VisionView, type VisionSource, type VisionViewHandle } from "@/components/vision/VisionView";
import { LAMPS } from "@/content/lamps";
import { quoteFor } from "@/content/quotes";
import credits from "../../../../../public/scenes/credits.json";
import { gridPoints, whatStillWorks } from "@/lib/field";
import { cap } from "@/lib/pronouns";
import type { Light } from "@/lib/vision/light";

// focus: the part of each photo to keep when the screen crops it (x, y from top-left).
const SCENES = [
  { id: "hallway", label: "Hallway", hfov: 75, focus: [0.5, 0.55] },
  { id: "stairs", label: "Stairs", hfov: 55, focus: [0.6, 0.72] },
  { id: "living-room", label: "Living room", hfov: 70, focus: [0.5, 0.5] },
  { id: "dinner", label: "Dinner table", hfov: 50, focus: [0.5, 0.45] },
] as const;

type SceneId = (typeof SCENES)[number]["id"] | "camera";
/** Who moves the point of fixation: nobody (centre), a finger or mouse, or the viewer's eyes. */
type Follow = "off" | "pointer" | "eyes";

const noSubscribe = () => () => {};
/** Webcam eye tracking is offered on computers (fine pointer) with camera access. */
const canTrackEyes = () => window.matchMedia("(pointer: fine)").matches && !!navigator.mediaDevices?.getUserMedia;

function param(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

/** Horizontal field of view actually shown after the cover-crop, degrees. */
function shownHfov(w: number, h: number, srcW: number, srcH: number, hfov: number): number {
  if (!w || !h || !srcW || !srcH) return hfov;
  const sx = srcW / srcH > w / h ? w / h / (srcW / srcH) : 1;
  return (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) * sx) * 180) / Math.PI;
}

/** Where each tested point of the field lands on screen, around the point of fixation. */
function projectPoints(
  grid: ReturnType<typeof gridPoints>,
  w: number,
  h: number,
  shownDeg: number,
  gaze: [number, number],
): { x: number; y: number; td: number }[] {
  if (!w || !h) return [];
  const f = w / 2 / Math.tan((shownDeg * Math.PI) / 360);
  const rad = Math.PI / 180;
  return grid.map((p) => ({ x: gaze[0] * w + f * Math.tan(p.x * rad), y: gaze[1] * h - f * Math.tan(p.y * rad), td: p.td }));
}

export default function See() {
  const { person, field, visit, setVisit, grid, age: visitAge, diffuseTd, p, base } = usePersonCtx();
  // Deep links for filming and testing: ?scene=stairs&wipe=0&light=night&visit=0
  const [scene, setScene] = useState<SceneId>(() => {
    const sc = param("scene");
    return sc && (sc === "camera" || SCENES.some((x) => x.id === sc)) ? (sc as SceneId) : "hallway";
  });
  const [facing] = useState<"environment" | "user">("environment");
  const [wipe, setWipe] = useState(() => {
    const w = Number(param("wipe"));
    return param("wipe") !== null && Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.5;
  });
  const [light, setLight] = useState<Light>(lightFromUrl);
  // ?follow=pointer&gx=0.3&gy=0.6 fixes the gaze somewhere else, for filming.
  const [follow, setFollow] = useState<Follow>(() => (param("follow") === "pointer" ? "pointer" : "off"));
  const [gaze, setGaze] = useState<[number, number]>(() => {
    const gx = Number(param("gx"));
    const gy = Number(param("gy"));
    return param("gx") !== null && param("gy") !== null && Number.isFinite(gx + gy) ? [Math.min(1, Math.max(0, gx)), Math.min(1, Math.max(0, gy))] : [0.5, 0.5];
  });
  const eyesAvailable = useSyncExternalStore(noSubscribe, canTrackEyes, () => false);
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
  const source: VisionSource = scene === "camera" ? { kind: "camera", facing } : { kind: "image", src: `/scenes/${scene}.jpg`, hfovDeg: hfov, focus: [...(sceneInfo?.focus ?? [0.5, 0.5])] as [number, number], lamps: LAMPS[scene] };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ?visit=N picks an earlier test (applied once; the slider owns it afterwards).
  const visitParam = useRef(param("visit"));
  useEffect(() => {
    const v = Number(visitParam.current);
    if (visitParam.current !== null && Number.isInteger(v)) {
      visitParam.current = null;
      setVisit(Math.min(field.visits.length - 1, Math.max(0, v)));
    }
  }, [field.visits.length, setVisit]);

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

  const moveGaze = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setGaze([Math.min(1, Math.max(0, (clientX - r.left) / r.width)), Math.min(1, Math.max(0, (clientY - r.top) / r.height))]);
  }, []);

  const changeFollow = (f: Follow) => {
    setFollow(f);
    if (f === "off") setGaze([0.5, 0.5]);
  };

  // While the gaze moves, the whole screen is their view: a divider would split the field.
  const shownWipe = follow === "off" ? wipe : 0;
  const shownDeg = shownHfov(box.w, box.h, src[0], src[1], hfov);
  const points = projectPoints(gridPoints(grid), box.w, box.h, shownDeg, gaze);
  const age = Math.round(field.visits[visit].age);
  const works = whatStillWorks(grid, p);

  return (
    <div className="fixed inset-0 bg-camera text-white">
      <div
        ref={stageRef}
        role="slider"
        tabIndex={0}
        aria-label={follow === "off" ? `Divider: your view on the left, ${person.name}’s on the right` : `Where ${person.name} is looking, across the screen`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((follow === "off" ? wipe : gaze[0]) * 100)}
        aria-valuetext={
          follow === "off"
            ? `${Math.round((1 - wipe) * 100)}% of the screen shows ${person.name}’s view`
            : `Looking ${Math.round(gaze[0] * 100)}% across and ${Math.round(gaze[1] * 100)}% down`
        }
        onKeyDown={(e) => {
          if (follow !== "off") {
            const step = 0.04;
            const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            const m = d[e.key];
            if (m) {
              e.preventDefault();
              setGaze(([x, y]) => [Math.min(1, Math.max(0, x + m[0])), Math.min(1, Math.max(0, y + m[1]))]);
            }
            return;
          }
          if (e.key === "ArrowLeft") setWipe((w) => Math.max(0, w - 0.05));
          if (e.key === "ArrowRight") setWipe((w) => Math.min(1, w + 0.05));
          if (e.key === "Home") setWipe(0);
          if (e.key === "End") setWipe(1);
        }}
        className="absolute inset-0 touch-none select-none focus-visible:outline-offset-[-6px]"
        onPointerDown={(e) => {
          if (follow === "eyes") return;
          dragging.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          if (follow === "pointer") moveGaze(e.clientX, e.clientY);
          else moveWipe(e.clientX);
        }}
        onPointerMove={(e) => {
          // A mouse steers the gaze without pressing; a finger steers it while touching.
          if (follow === "pointer" && (dragging.current || e.pointerType === "mouse")) moveGaze(e.clientX, e.clientY);
          else if (follow === "off" && dragging.current) moveWipe(e.clientX);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <VisionView
          ref={viewRef}
          grid={grid}
          source={source}
          wipe={shownWipe}
          light={light}
          age={visitAge}
          diffuseTd={diffuseTd}
          gaze={gaze}
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

        {/* Fixation: a cross where the eyes should rest, or a ring where the tracker thinks they are. */}
        <svg
          className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${gaze[0] * 100}%`, top: `${gaze[1] * 100}%` }}
          viewBox="-10 -10 20 20"
          aria-hidden
        >
          {follow === "eyes" ? (
            <>
              <circle r="6" fill="none" stroke="black" strokeOpacity="0.45" strokeWidth="3.5" />
              <circle r="6" fill="none" stroke="white" strokeWidth="1.5" />
            </>
          ) : (
            <>
              <path d="M-7 0H7M0 -7V7" stroke="black" strokeOpacity="0.5" strokeWidth="4" strokeLinecap="round" />
              <path d="M-7 0H7M0 -7V7" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </svg>

        {/* Wipe divider */}
        {shownWipe > 0.005 && shownWipe < 0.995 && (
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
              Keep your eyes on the cross: that is where {p.subj} {p.is} looking. The test measures {p.poss} vision with {p.poss} eyes held still, so this is exact only while you do the same.
            </p>
            <p>
              Look around moves the cross with your finger or mouse, and the weaker areas move with it, as they do for {p.obj}.
              {eyesAvailable ? " On a computer with a webcam, Follow my eyes moves it with your eyes instead." : ""}
            </p>
            <p>
              Where {p.poss} vision is weaker, detail and contrast fade. Where it is very weak, things disappear into their surroundings. People with glaucoma describe it this way: 0 of 50 patients in one study
              said it looks like the black tunnel usually shown (Crabb et al., 2013).
            </p>
            <p>
              Evening and Night use light levels measured in real homes: a lamp-lit living room, and a room lit only by a TV. Everyone needs more contrast in low light, fine detail most
              (Barten’s model of contrast sensitivity), and glaucoma adds to it. Bright lamps and windows scatter light inside the eye, more with age, which veils what is near them (the CIE glare
              standard, for {p.poss} age). These are models from research, not measured for {p.obj}.
            </p>
            {scene !== "camera" &&
              (() => {
                const c = credits.find((x) => x.id === scene);
                return c ? (
                  <p className="text-sm text-graphite">
                    Photo by {c.artist}, {c.license}, via Wikimedia Commons.
                  </p>
                ) : null;
              })()}
          </HelpSheet>
        </div>
        <div className="mt-3 flex justify-between px-1 text-[0.95rem] font-bold [text-shadow:0_1px_6px_rgba(0,0,0,0.7)]">
          <span style={{ opacity: shownWipe > 0.12 ? 1 : 0 }}>You</span>
          <span style={{ opacity: shownWipe < 0.88 ? 1 : 0 }}>
            {person.name}, age {age}
          </span>
        </div>
      </div>

      {follow === "pointer" && (
        <p role="status" className="pointer-events-none absolute inset-x-4 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] mx-auto max-w-xl rounded-2xl bg-black/55 px-4 py-2.5 text-center text-[0.95rem] backdrop-blur-md">
          {eyesAvailable ? "Move the mouse" : "Drag your finger"} and look at the cross. {cap(p.poss)} weaker areas move with it.
        </p>
      )}

      {follow === "eyes" && (
        <EyeFollow personName={person.name} degPerPx={box.w ? shownDeg / box.w : 0.05} onGaze={setGaze} onStop={() => changeFollow("off")} />
      )}

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
            <LightPicker value={light} onChange={setLight} />
            <Toggle on={showPoints} onChange={setShowPoints} dark>
              Test points
            </Toggle>
            <Toggle on={follow === "pointer"} onChange={(on) => changeFollow(on ? "pointer" : "off")} dark>
              Look around
            </Toggle>
            {eyesAvailable && (
              <Toggle on={follow === "eyes"} onChange={(on) => changeFollow(on ? "eyes" : "off")} dark>
                Follow my eyes
              </Toggle>
            )}
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
          <QuoteBlock className="mt-5" quote={quoteFor(light !== "day" ? "light" : "scanning")} />
        </div>
      )}

      <TabBar base={base} dark />
    </div>
  );
}
