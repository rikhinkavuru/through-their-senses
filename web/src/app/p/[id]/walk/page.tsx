"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { TabBar, usePersonCtx } from "@/components/PersonShell";
import { HelpSheet, QuoteBlock } from "@/components/ui";
import { LightPicker, lightFromUrl } from "@/components/vision/LightPicker";
import { VisionView, type VisionSource, type VisionViewHandle } from "@/components/vision/VisionView";
import { LAMPS } from "@/content/lamps";
import { quoteFor } from "@/content/quotes";
import credits from "../../../../../public/scenes/credits.json";
import { interpolateField, sampleMap } from "@/lib/field";
import { cap } from "@/lib/pronouns";
import type { AcceptedFix } from "@/lib/types";
import { estimateDepth } from "@/lib/vision/depth-client";
import type { Light } from "@/lib/vision/light";
import { assess, edgeAtPoint, edgeContrast, findStepEdges, STEP_GUIDELINE, type HazardAssessment, type Segment, type ViewGeometry } from "@/lib/vision/hazards";

// focus: the part of each photo to keep when the screen crops it (x, y from top-left).
const SCENES = [
  { id: "stairs", label: "Stairs", hfov: 55, focus: [0.6, 0.72] },
  { id: "hallway", label: "Hallway", hfov: 75, focus: [0.5, 0.6] },
  { id: "living-room", label: "Living room", hfov: 70, focus: [0.5, 0.55] },
] as const;
type SceneId = (typeof SCENES)[number]["id"] | "camera";

/** Contrast assumed for a high-contrast strip along an edge (light strip on a dark step or the reverse). */
const STRIP_CONTRAST = 0.8;

interface Finding {
  id: string;
  kind: "step" | "spot";
  seg: Segment;
  contrast: number;
  a: HazardAssessment;
  fixed: boolean; // strip applied in the preview
  dismissed: boolean;
}

function pct(c: number) {
  return c >= 1 ? "over 100%" : `${Math.round(c * 100)}%`;
}

const VERDICT_TEXT: Record<HazardAssessment["verdict"], string> = {
  hidden: "Hidden from her here",
  hard: "Hard for her to see",
  visible: "Clear enough for her",
};

function VerdictMark({ v }: { v: HazardAssessment["verdict"] }) {
  // Shape carries the meaning, colour only reinforces it.
  if (v === "visible")
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--works)" strokeWidth="2" />
        <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="var(--works)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  if (v === "hard")
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--ink)" strokeWidth="2" />
        <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="var(--ink)" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden>
      <circle cx="8" cy="8" r="7.5" fill="var(--right-ear)" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Walk() {
  const { person, grid, age, diffuseTd, p, base, update } = usePersonCtx();
  const [scene, setScene] = useState<SceneId>("stairs");
  const [light, setLight] = useState<Light>(lightFromUrl);
  const [phase, setPhase] = useState<"aim" | "scanning" | "review">("aim");
  const [status, setStatus] = useState("");
  const [frozen, setFrozen] = useState<{ img: ImageData; url: string; geo: ViewGeometry } | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<[number, number]>([0, 0]);
  const viewRef = useRef<VisionViewHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const map = useMemo(() => interpolateField(grid), [grid]);
  const td = (x: number, y: number) => sampleMap(map, x, y);

  const sceneInfo = SCENES.find((s) => s.id === scene);
  const cameraHfov = src[1] > src[0] ? 52 : 68;
  const hfov = sceneInfo ? sceneInfo.hfov : cameraHfov;
  const source: VisionSource = scene === "camera" ? { kind: "camera", facing: "environment" } : { kind: "image", src: `/scenes/${scene}.jpg`, hfovDeg: hfov, focus: [...(sceneInfo?.focus ?? [0.5, 0.5])] as [number, number], lamps: LAMPS[scene] };
  const verdictText = (v: HazardAssessment["verdict"]) => VERDICT_TEXT[v].replace("her", p.obj);

  function geometry(): ViewGeometry | null {
    const el = stageRef.current;
    if (!el || !src[0]) return null;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const srcAspect = src[0] / src[1];
    const sx = srcAspect > w / h ? w / h / srcAspect : 1;
    const shown = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) * sx) * 180) / Math.PI;
    return { shownHfovDeg: shown, aspect: w / h, gaze: [0.5, 0.5] };
  }

  function judge(seg: Segment, contrast: number, kind: Finding["kind"], geo: ViewGeometry): HazardAssessment {
    return assess(seg, contrast, geo, td, { light, diffuseTd, isStep: kind === "step" });
  }

  async function scan() {
    setError(null);
    const img = viewRef.current?.sourceFrame(518);
    const url = viewRef.current?.snapshot();
    const geo = geometry();
    if (!img || !url || !geo) {
      setError("The view isn’t ready yet. Try again in a moment.");
      return;
    }
    setFrozen({ img, url, geo });
    setFindings([]);
    setPhase("scanning");
    setStatus("Getting the depth model ready (a one-time download of about 27 MB)…");
    try {
      const d = await estimateDepth(
        img,
        (l, t) => t && setStatus(`Downloading the depth model once: ${Math.round((l / 1e6) * 10) / 10} of ${Math.round((t / 1e6) * 10) / 10} MB`),
        () => setStatus("Looking for steps and edges…"),
      );
      const segs = findStepEdges(d.depth, d.width, d.height);
      const scanId = Date.now().toString(36); // unique per scan, so decisions from other spots are kept
      const list = segs.map((seg, i) => {
        const contrast = edgeContrast(img, seg);
        return { id: `${scanId}-edge-${i}`, kind: "step" as const, seg, contrast, a: judge(seg, contrast, "step", geo), fixed: false, dismissed: false };
      });
      // Lower-field hazards first (inferior field loss predicts falls), then least visible.
      const rank = { hidden: 0, hard: 1, visible: 2 };
      list.sort((x, y) => (x.a.region === "lower" ? 0 : 1) - (y.a.region === "lower" ? 0 : 1) || rank[x.a.verdict] - rank[y.a.verdict]);
      setFindings(list);
      setPhase("review");
    } catch {
      setPhase("review");
      setError("Step finding isn’t available in this browser. You can still tap anything in the picture to check it.");
    }
  }

  function tapCheck(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== "review" || !frozen) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const seg = edgeAtPoint(frozen.img, nx, ny);
    const f: Finding = { id: `spot-${Date.now()}`, kind: "spot", seg, contrast: seg.strength, a: judge(seg, seg.strength, "spot", frozen.geo), fixed: false, dismissed: false };
    setFindings((cur) => [f, ...cur]);
  }

  function toggleStrip(id: string) {
    if (!frozen) return;
    setFindings((cur) =>
      cur.map((f) => {
        if (f.id !== id) return f;
        const fixed = !f.fixed;
        const c = fixed ? Math.max(f.contrast, STRIP_CONTRAST) : f.contrast;
        return { ...f, fixed, a: judge(f.seg, c, f.kind, frozen.geo) };
      }),
    );
  }

  function decide(f: Finding, decision: AcceptedFix["decision"]) {
    const label = `${f.kind === "step" ? "Step edge" : "Edge"} in ${scene === "camera" ? "the room you scanned" : sceneInfo?.label.toLowerCase()}`;
    const fix: AcceptedFix = {
      hazardId: `${scene}-${f.id}`,
      label,
      fix: `High-contrast strip along the edge (contrast from ${pct(f.contrast)} to about ${pct(STRIP_CONTRAST)})`,
      decision,
      decidedAt: new Date().toISOString(),
    };
    update({ fixes: [...person.fixes.filter((x) => x.hazardId !== fix.hazardId), fix] });
  }

  const visible = findings.filter((f) => !f.dismissed);

  return (
    <div className="fixed inset-0 bg-camera text-white">
      <div
        ref={stageRef}
        onPointerDown={tapCheck}
        className={
          phase === "review" && frozen
            ? "absolute left-1/2 top-[calc(max(0.75rem,env(safe-area-inset-top))+5.5rem)] -translate-x-1/2 overflow-hidden rounded-2xl"
            : "absolute inset-0"
        }
        style={phase === "review" && frozen ? { height: "34dvh", aspectRatio: String(frozen.geo.aspect), maxWidth: "calc(100vw - 2rem)" } : undefined}
      >
        {phase === "aim" ? (
          <VisionView
            ref={viewRef}
            grid={grid}
            source={source}
            wipe={0}
            light={light}
            age={age}
            diffuseTd={diffuseTd}
            cameraHfov={cameraHfov}
            className="absolute inset-0 h-full w-full"
            label={`Live view as ${person.name} sees it`}
            onError={(m) => {
              setError(m);
              setScene("stairs");
            }}
            onReady={() => setSrc(viewRef.current?.videoSize() ?? [0, 0])}
          />
        ) : (
          frozen && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frozen.url} alt={`The spot you checked, as ${person.name} sees it`} className="absolute inset-0 h-full w-full object-cover" />
          )
        )}

        {phase !== "aim" && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none">
            {visible.map((f) => (
              <line
                key={f.id}
                x1={f.seg.x0 * 100}
                y1={f.seg.y0 * 100}
                x2={f.seg.x1 * 100}
                y2={f.seg.y1 * 100}
                stroke={f.a.verdict === "visible" ? "white" : f.a.verdict === "hard" ? "#ffd166" : "#ff5a4e"}
                strokeWidth={f.a.verdict === "visible" ? 0.5 : 0.9}
                strokeDasharray={f.a.verdict === "hard" ? "2 1.2" : undefined}
                vectorEffect="non-scaling-stroke"
                style={{ strokeWidth: f.a.verdict === "visible" ? 2 : 4 }}
              />
            ))}
          </svg>
        )}

        {phase !== "aim" &&
          visible.map((f, i) => (
            <span
              key={`b-${f.id}`}
              aria-hidden
              className="pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[0.8rem] font-bold text-ink shadow"
              style={{ left: `${Math.min(96, Math.max(4, f.seg.x1 * 100))}%`, top: `${Math.min(96, Math.max(4, f.seg.y1 * 100))}%` }}
            >
              {i + 1}
            </span>
          ))}

        {phase === "aim" && (
          <svg className="pointer-events-none absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2" viewBox="-10 -10 20 20" aria-hidden>
            <path d="M-7 0H7M0 -7V7" stroke="black" strokeOpacity="0.5" strokeWidth="4" strokeLinecap="round" />
            <path d="M-7 0H7M0 -7V7" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </div>

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/65 to-transparent px-4 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-center justify-between gap-3">
          <Link href={base} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/12 px-4 backdrop-blur-md">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {person.name}
          </Link>
          <HelpSheet title="Walking it together" dark>
            <p>
              Hold the phone at eye level and aim where {person.name} would look while walking, about two steps ahead: that is where people look when they walk. The cross marks that point.
            </p>
            <p>
              We look for step edges using a depth model that runs on this phone; the photo never leaves it. For each edge we measure its contrast in the picture and compare it with what {p.poss} vision
              needs at that spot, using the same model as the See screen.
            </p>
            <p>
              Edges in the lower part of {p.poss} vision come first: loss there is the part of the field linked to falls (Black et al., 2011). Step edges should have at least {STEP_GUIDELINE * 100}% contrast
              for anyone with low vision.
            </p>
            <p>It can mistake a railing or a table edge for a step. Mark those “not a hazard”. Tap anything else to check it.</p>
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
        <p className="mt-3 max-w-md text-[0.98rem] font-bold [text-shadow:0_1px_6px_rgba(0,0,0,0.7)]">
          {phase === "aim" ? `Aim where ${person.name} would look while walking` : phase === "scanning" ? status : `Tap anything else in the picture to check it`}
        </p>
      </div>

      {error && (
        <p role="status" className="absolute inset-x-4 top-32 rounded-2xl bg-black/70 px-4 py-3 text-[0.95rem] backdrop-blur-md">
          {error}
        </p>
      )}

      {/* Aim controls */}
      {phase === "aim" && (
        <div className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pb-4 pt-16">
          <div className="mx-auto max-w-xl space-y-3">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="radiogroup" aria-label="Where to walk">
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
            <LightPicker value={light} onChange={setLight} />
            <button onClick={scan} className="min-h-14 w-full rounded-full bg-white text-[1.05rem] font-bold text-ink active:scale-[0.98]">
              Check this spot
            </button>
          </div>
        </div>
      )}

      {/* Findings sheet */}
      {phase === "review" && (
        <div className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-[calc(max(0.75rem,env(safe-area-inset-top))+6.5rem+34dvh)] overflow-y-auto rounded-t-3xl bg-paper px-5 pb-5 pt-4 text-ink shadow-2xl">
          <div className="mx-auto max-w-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-title font-light">{visible.length ? `${visible.length} to check` : "Nothing found here"}</h2>
              <button onClick={() => setPhase("aim")} className="min-h-11 shrink-0 rounded-full bg-ink/[0.06] px-4">
                Another spot
              </button>
            </div>
            {!visible.length && <p className="mt-2 text-graphite">No step edges showed up. Tap anything you’re unsure about to check it.</p>}
            <ul className="mt-4 space-y-4">
              {visible.map((f, i) => (
                <li key={f.id} className="rounded-2xl border border-chart p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[0.8rem] font-bold text-paper" aria-label={`Marker ${i + 1}`}>
                      {i + 1}
                    </span>
                    <VerdictMark v={f.a.verdict} />
                    <p className="font-bold">
                      {f.kind === "step" ? "Possible step edge" : "The spot you tapped"}: {verdictText(f.a.verdict).toLowerCase()}
                    </p>
                  </div>
                  <p className="mt-2 leading-relaxed">
                    Edge contrast {pct(f.fixed ? Math.max(f.contrast, STRIP_CONTRAST) : f.contrast)}.{" "}
                    {f.a.threshold >= 1
                      ? `It falls where very little contrast gets through for ${p.obj}, so ${p.subj} will only see it by looking straight at it.`
                      : `Where it falls in ${p.poss} vision, ${p.subj} need${p.s} at least ${pct(f.a.threshold)} contrast to notice it${
                          f.a.verdict === "visible" ? "" : f.a.threshold * 3 >= 1 ? ", and even strong contrast will look faint there" : `, and about ${pct(f.a.threshold * 3)} to see it easily`
                        }.`}
                    {f.a.region === "lower" && ` It sits in the lower part of ${p.poss} vision, where loss is linked to falls.`}
                    {f.kind === "step" && !f.fixed && f.a.belowGuideline && ` It is also below the ${STEP_GUIDELINE * 100}% recommended for step edges.`}
                    {f.fixed && f.a.verdict !== "visible" && ` A strip still helps when ${p.subj} look${p.s} down at the step, but here scanning with ${p.poss} eyes and good light matter as much.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => toggleStrip(f.id)}
                      aria-pressed={f.fixed}
                      className={`min-h-11 rounded-full px-4 text-[0.95rem] ${f.fixed ? "bg-ink font-bold text-paper" : "bg-ink/[0.06]"}`}
                    >
                      {f.fixed ? "Showing it with a contrasting strip" : "Try a contrasting strip"}
                    </button>
                    <button
                      onClick={() => setFindings((cur) => cur.map((x) => (x.id === f.id ? { ...x, dismissed: true } : x)))}
                      className="min-h-11 rounded-full px-4 text-[0.95rem] text-graphite underline decoration-ink/25 underline-offset-4"
                    >
                      Not a hazard
                    </button>
                  </div>
                  {f.fixed && (
                    <div className="mt-3 rounded-xl bg-ink/[0.04] p-3">
                      <p className="text-[0.95rem]">Is this a change {person.name} wants?</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(
                          [
                            ["yes", `Yes, ${p.subj} want${p.s} it`],
                            ["later", "Maybe later"],
                            ["no", "No"],
                          ] as [AcceptedFix["decision"], string][]
                        ).map(([d, label]) => {
                          const chosen = person.fixes.find((x) => x.hazardId === `${scene}-${f.id}`)?.decision === d;
                          return (
                            <button
                              key={d}
                              onClick={() => decide(f, d)}
                              aria-pressed={chosen}
                              className={`min-h-11 rounded-full px-4 text-[0.95rem] ${chosen ? "bg-ink font-bold text-paper" : "border border-ink/20"}`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <QuoteBlock className="mt-6" quote={quoteFor("steps", 1)} />
            <p className="mt-4 text-sm text-graphite">
              {cap(p.subj)} decide{p.s} what changes. Accepted changes appear in the Guide. Removing trip hazards and marking edges is the kind of home change with the strongest evidence for
              preventing falls, especially when an occupational therapist is involved.
            </p>
          </div>
        </div>
      )}

      <TabBar base={base} dark />
    </div>
  );
}
