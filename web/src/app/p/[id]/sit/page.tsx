"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TabBar, usePersonCtx } from "@/components/PersonShell";
import { Button, HelpSheet, Segmented } from "@/components/ui";
import { betterEar, pta4 } from "@/lib/audiogram";
import { interpolateField, sampleMap } from "@/lib/field";
import { cap } from "@/lib/pronouns";

type Table = "round" | "long";
type Window = "none" | "top" | "bottom" | "left" | "right";

interface Seat {
  id: number;
  x: number; // metres, table centre at 0,0
  y: number;
}

function seatsFor(t: Table): Seat[] {
  if (t === "round") {
    return Array.from({ length: 6 }, (_, i) => {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / 6;
      return { id: i, x: Math.cos(a) * 0.95, y: Math.sin(a) * 0.95 };
    });
  }
  const xs = [-0.9, 0, 0.9];
  return [...xs.map((x, i) => ({ id: i, x, y: 0.75 })), ...xs.map((x, i) => ({ id: 3 + i, x, y: -0.75 })), { id: 6, x: -1.75, y: 0 }, { id: 7, x: 1.75, y: 0 }];
}

/** Direction a seated person faces: the table centre for a round table, straight across for a long one. */
function facing(t: Table, s: Seat): [number, number] {
  if (t === "round" || Math.abs(s.y) < 0.1) {
    const len = Math.hypot(s.x, s.y) || 1;
    return [-s.x / len, -s.y / len];
  }
  return [0, s.y > 0 ? -1 : 1];
}

interface SeatScore {
  seat: Seat;
  angle: number; // degrees, positive = to her right
  dist: number;
  ear: number;
  vision: number;
  light: number;
  total: number;
  reasons: string[];
  cautions: string[];
}

export default function Sit() {
  const { person, grid, p, base, update } = usePersonCtx();
  const [table, setTable] = useState<Table>("round");
  const [win, setWin] = useState<Window>("top");
  const seats = useMemo(() => seatsFor(table), [table]);
  const [herSeat, setHerSeat] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const map = useMemo(() => interpolateField(grid), [grid]);
  const ear = betterEar(person.audiogram);
  const earGap = Math.abs(pta4(person.audiogram.left) - pta4(person.audiogram.right));

  const her = seats[Math.min(herSeat, seats.length - 1)];
  const [fx, fy] = facing(table, her);

  const scores: SeatScore[] = seats
    .filter((s) => s.id !== her.id)
    .map((s) => {
      const vx = s.x - her.x;
      const vy = s.y - her.y;
      const dist = Math.hypot(vx, vy);
      // Signed angle from her facing direction to the seat; screen y grows downward, so right = positive cross.
      const cross = fx * vy - fy * vx;
      const dot = fx * vx + fy * vy;
      const angle = (Math.atan2(cross, dot) * 180) / Math.PI;
      const onRight = angle > 5;
      const onLeft = angle < -5;
      const reasons: string[] = [];
      const cautions: string[] = [];

      // Hearing: the head shadows high pitches from the far side, so the better-ear side helps.
      let earScore = 0.5;
      if ((ear === "right" && onRight) || (ear === "left" && onLeft)) {
        earScore = 1;
        reasons.push(`on ${p.poss} better-hearing (${ear}) side`);
      } else if ((ear === "right" && onLeft) || (ear === "left" && onRight)) {
        earScore = earGap >= 10 ? 0 : 0.3;
        cautions.push(`on ${p.poss} weaker ear’s side`);
      }

      // Vision: can she see your face without turning her head? Faces sit near eye level.
      const td = sampleMap(map, angle, 0);
      let vision: number;
      if (Math.abs(angle) > 30) {
        vision = 0.2;
        cautions.push(`outside what ${p.poss} field test covers, so ${p.subj}’ll need to turn to see you`);
      } else if (!Number.isFinite(td)) {
        vision = 0.5;
        cautions.push(`your face is at the edge of what ${p.poss} field test measured`);
      } else if (td > -6) {
        vision = 1;
        reasons.push(`your face is in a clear part of ${p.poss} vision`);
      } else if (td > -15) {
        vision = 0.5;
        cautions.push(`your face falls where ${p.poss} vision is softer`);
      } else {
        vision = 0;
        cautions.push(`your face falls where ${p.subj} see${p.s} very little`);
      }

      // Speechreading drops with distance and angle (Erber 1974); within ~3 m is best.
      if (dist > 3) cautions.push("more than 3 metres away, too far to lipread well");

      // Light on the speaker's face, not behind it.
      let light = 0.5;
      if (win !== "none") {
        const wv: Record<Exclude<Window, "none">, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
        const [wx, wy] = wv[win];
        // Window behind the speaker (from her view) means a backlit, shadowed face.
        const toSeat = [vx / dist, vy / dist];
        const behind = toSeat[0] * wx + toSeat[1] * wy;
        if (behind > 0.5 && s.x * wx + s.y * wy > 0) {
          light = 0;
          cautions.push("the window is behind you, so your face is in shadow");
        } else if (behind < -0.3) {
          light = 1;
          reasons.push("daylight falls on your face");
        }
      }
      const total = 0.4 * earScore + 0.4 * vision + 0.2 * light - (dist > 3 ? 0.3 : 0);
      return { seat: s, angle, dist, ear: earScore, vision, light, total, reasons, cautions };
    })
    .sort((a, b) => b.total - a.total);

  const best = scores[0];
  const shown = scores.find((s) => s.seat.id === picked) ?? best;

  // Layout: 1 m = 70 px.
  const K = 70;
  const W = 330;
  const H = table === "round" ? 300 : 280;
  const cx = W / 2;
  const cy = H / 2;
  const P = (x: number, y: number) => [cx + x * K, cy + y * K] as const;

  function saveNote() {
    const why = shown.reasons.length ? `: ${shown.reasons.join(", ")}` : "";
    update({ seating: { note: `At the table, sit ${shown.angle > 0 ? `to ${p.poss} right` : shown.angle < 0 ? `to ${p.poss} left` : `across from ${p.obj}`}${why}.` } });
  }

  return (
    <>
      <main className="mx-auto max-w-2xl px-5 pb-32 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <Link href={base} className="min-h-11 content-center text-[0.98rem] text-graphite hover:text-ink">
            {person.name}
          </Link>
          <HelpSheet title="How the seat is chosen">
            <p>
              We combine {p.poss} hearing and vision. Sitting on the side of {p.poss} better ear helps, because the head blocks high-pitched sound coming from the other side.
            </p>
            <p>
              Seeing your face helps {p.obj} lipread, which matters most in noise. We check where your face falls in {p.poss} visual field when {p.subj} face{p.s} the table, and whether a window puts your face
              in shadow.
            </p>
            <p>Lipreading works best within about 3 metres and when you face each other (Erber, 1974).</p>
          </HelpSheet>
        </header>
        <h1 className="mt-8 text-display font-light tracking-[-0.02em]">Where to sit</h1>
        <p className="mt-3 max-w-[56ch] leading-relaxed text-ink/80">Tap a seat to put {person.name} there. We suggest where you should sit so {p.subj} can hear you and see your face.</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Segmented
            label="Table"
            value={table}
            onChange={(t) => {
              setTable(t);
              setHerSeat(0);
              setPicked(null);
            }}
            options={[
              { value: "round", label: "Round table" },
              { value: "long", label: "Long table" },
            ]}
          />
          <div className="flex items-center gap-2">
            <span className="text-graphite">Window</span>
            <Segmented
              label="Where the window is"
              value={win}
              onChange={setWin}
              options={[
                { value: "none", label: "None" },
                { value: "top", label: "Top" },
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ]}
            />
          </div>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="mt-6 w-full max-w-md" role="img" aria-label={`Table plan. ${person.name} is in the highlighted seat; the suggested seat for you is marked.`}>
          {win !== "none" && (
            <rect
              x={win === "left" ? 2 : win === "right" ? W - 8 : 40}
              y={win === "top" ? 2 : win === "bottom" ? H - 8 : 40}
              width={win === "left" || win === "right" ? 6 : W - 80}
              height={win === "left" || win === "right" ? H - 80 : 6}
              rx="2"
              fill="var(--left-ear)"
              opacity="0.35"
            />
          )}
          {table === "round" ? (
            <circle cx={cx} cy={cy} r={0.62 * K} fill="var(--paper-deep)" stroke="var(--chart)" strokeWidth="2" />
          ) : (
            <rect x={cx - 1.4 * K} y={cy - 0.45 * K} width={2.8 * K} height={0.9 * K} rx="10" fill="var(--paper-deep)" stroke="var(--chart)" strokeWidth="2" />
          )}
          {/* her sight line and clear-field wedge */}
          {(() => {
            const [hx, hy] = P(her.x, her.y);
            const a0 = Math.atan2(fy, fx);
            const wedge = (deg: number) => {
              const a1 = a0 - (deg * Math.PI) / 180;
              const a2 = a0 + (deg * Math.PI) / 180;
              const R = 3 * K;
              return `M${hx},${hy} L${hx + Math.cos(a1) * R},${hy + Math.sin(a1) * R} A${R},${R} 0 0 1 ${hx + Math.cos(a2) * R},${hy + Math.sin(a2) * R} Z`;
            };
            return <path d={wedge(30)} fill="var(--ink)" opacity="0.05" />;
          })()}
          {seats.map((s) => {
            const [x, y] = P(s.x, s.y);
            const isHer = s.id === her.id;
            const isBest = s.id === best.seat.id;
            const isShown = s.id === shown.seat.id;
            return (
              <g key={s.id}>
                <circle
                  cx={x}
                  cy={y}
                  r="20"
                  fill={isHer ? "var(--ink)" : isBest ? "var(--works)" : "var(--paper)"}
                  stroke={isShown && !isHer ? "var(--ink)" : "var(--chart)"}
                  strokeWidth={isShown && !isHer ? 3 : 2}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    if (isHer) return;
                    setPicked(s.id);
                  }}
                  onDoubleClick={() => {
                    setHerSeat(s.id);
                    setPicked(null);
                  }}
                />
                <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={isHer || isBest ? "white" : "var(--ink)"} pointerEvents="none">
                  {isHer ? person.name.slice(0, 5) : isBest ? "You" : ""}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="mt-2 flex flex-wrap gap-2">
          {seats
            .filter((s) => s.id !== her.id)
            .map((s, i) => (
              <button
                key={s.id}
                onClick={() => setPicked(s.id)}
                aria-pressed={shown.seat.id === s.id}
                className={`min-h-11 rounded-full px-3 text-[0.9rem] ${shown.seat.id === s.id ? "bg-ink font-bold text-paper" : "bg-ink/[0.06]"}`}
              >
                Seat {i + 1}
                {s.id === best.seat.id ? " (best)" : ""}
              </button>
            ))}
          <button onClick={() => setHerSeat((herSeat + 1) % seats.length)} className="min-h-11 rounded-full border border-ink/20 px-3 text-[0.9rem]">
            Move {person.name}
          </button>
        </div>

        <section className="mt-8 rounded-2xl border border-chart p-5" aria-live="polite">
          <h2 className="text-title font-light">{shown.seat.id === best.seat.id ? "Best seat for you" : "This seat"}</h2>
          {shown.reasons.length > 0 && (
            <ul className="mt-3 space-y-2">
              {shown.reasons.map((r) => (
                <li key={r} className="flex gap-3">
                  <span aria-hidden className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-works" />
                  {cap(r)}
                </li>
              ))}
            </ul>
          )}
          {shown.cautions.length > 0 && (
            <ul className="mt-3 space-y-2">
              {shown.cautions.map((r) => (
                <li key={r} className="flex gap-3 text-ink/80">
                  <span aria-hidden className="mt-2 h-2.5 w-2.5 shrink-0 rotate-45 border-2 border-right-ear" />
                  {cap(r)}
                </li>
              ))}
            </ul>
          )}
          <Button className="mt-5" kind="secondary" onClick={saveNote}>
            {person.seating ? "Update the guide" : "Add to the guide"}
          </Button>
          {person.seating && <p className="mt-2 text-sm text-graphite">In the guide: “{person.seating.note}”</p>}
        </section>
      </main>
      <TabBar base={base} />
    </>
  );
}
