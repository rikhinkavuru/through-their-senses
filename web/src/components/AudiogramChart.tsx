"use client";

import { useRef } from "react";
import { betterEar, FAMILIAR_SOUNDS, FREQS, SPEECH_SOUNDS, thresholdAt } from "@/lib/audiogram";
import type { Audiogram } from "@/lib/types";

const W = 340;
const H = 290;
const M = { l: 40, r: 12, t: 30, b: 14 };
const F_MIN = 250;
const F_MAX = 10000;
const DB_MIN = -10;
const DB_MAX = 110;

const x = (f: number) => M.l + (Math.log2(f / F_MIN) / Math.log2(F_MAX / F_MIN)) * (W - M.l - M.r);
const y = (db: number) => M.t + ((db - DB_MIN) / (DB_MAX - DB_MIN)) * (H - M.t - M.b);
const dbFromY = (py: number) => DB_MIN + ((py - M.t) / (H - M.t - M.b)) * (DB_MAX - DB_MIN);

interface Props {
  audiogram: Audiogram;
  /** Allow dragging points to enter an audiogram. */
  onChange?: (a: Audiogram) => void;
  showSounds?: boolean;
  className?: string;
  title: string;
}

/**
 * Clinical audiogram conventions: pitch left to right, quiet at the top, right ear
 * in red circles, left ear in blue crosses. Everyday and speech sounds sit at their
 * approximate pitch and loudness; the ones above the better ear's line are too quiet
 * to hear and are drawn faded.
 */
export function AudiogramChart({ audiogram, onChange, showSounds = true, className, title }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const ear = betterEar(audiogram);
  const better = audiogram[ear];
  const editable = !!onChange;

  const pathFor = (t: number[]) => t.map((v, i) => `${i ? "L" : "M"}${x(FREQS[i]).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const shade =
    `M${x(FREQS[0])},${y(DB_MIN)} ` +
    better.map((v, i) => `L${x(FREQS[i]).toFixed(1)},${y(v).toFixed(1)}`).join(" ") +
    ` L${x(FREQS[FREQS.length - 1])},${y(DB_MIN)} Z`;

  const setPoint = (side: "left" | "right", i: number, db: number) => {
    if (!onChange) return;
    const v = Math.max(-10, Math.min(100, Math.round(db / 5) * 5));
    const next = [...audiogram[side]];
    if (next[i] === v) return;
    next[i] = v;
    onChange({ ...audiogram, [side]: next, source: "Entered by hand" });
  };

  const startDrag = (side: "left" | "right", i: number) => (e: React.PointerEvent) => {
    if (!editable || !svgRef.current) return;
    const svg = svgRef.current;
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      setPoint(side, i, dbFromY(((ev.clientY - r.top) / r.height) * H));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const heard = (f: number, db: number) => db >= thresholdAt(better, f);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className={className} style={{ touchAction: editable ? "none" : "auto" }}>
      {/* grid */}
      {[250, 500, 1000, 2000, 4000, 8000].map((f) => (
        <g key={f}>
          <line x1={x(f)} x2={x(f)} y1={M.t} y2={H - M.b} stroke="var(--chart)" strokeWidth="1" />
          <text x={x(f)} y={M.t - 9} fontSize="10" textAnchor="middle" fill="var(--graphite)">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      <text x={W - M.r} y={12} fontSize="10" textAnchor="end" fill="var(--graphite)">
        higher pitch (Hz)
      </text>
      {[0, 20, 40, 60, 80, 100].map((d) => (
        <g key={d}>
          <line x1={M.l} x2={W - M.r} y1={y(d)} y2={y(d)} stroke="var(--chart)" strokeWidth="1" />
          <text x={M.l - 6} y={y(d) + 3.5} fontSize="10" textAnchor="end" fill="var(--graphite)" className="tabular">
            {d}
          </text>
        </g>
      ))}
      <text x={4} y={M.t + 4} fontSize="10" fill="var(--graphite)">
        quiet
      </text>
      <text x={4} y={H - M.b} fontSize="10" fill="var(--graphite)">
        loud
      </text>

      {/* too quiet for the better ear */}
      <path d={shade} fill="var(--graphite)" fillOpacity="0.09" />

      {showSounds && (
        <g fontSize="10">
          {FAMILIAR_SOUNDS.map((s) => (
            <text key={s.label} x={x(s.f)} y={y(s.db) + 3} textAnchor="middle" fill="var(--ink)" fillOpacity={heard(s.f, s.db) ? 0.85 : 0.32}>
              {s.label}
            </text>
          ))}
          {SPEECH_SOUNDS.map((s) => {
            const ok = heard(s.f, s.db);
            return (
              <g key={s.label} opacity={ok ? 1 : 0.4}>
                <circle cx={x(s.f)} cy={y(s.db)} r="8.5" fill="var(--paper)" stroke="var(--ink)" strokeOpacity="0.35" strokeDasharray={ok ? undefined : "2 2"} />
                <text x={x(s.f)} y={y(s.db) + 3.5} textAnchor="middle" fontWeight="700" fontSize="10" fill="var(--ink)">
                  {s.label}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* ears: right = red circles, left = blue crosses */}
      <path d={pathFor(audiogram.left)} fill="none" stroke="var(--left-ear)" strokeWidth="1.8" strokeDasharray="5 3" />
      <path d={pathFor(audiogram.right)} fill="none" stroke="var(--right-ear)" strokeWidth="1.8" />
      {audiogram.left.map((v, i) => (
        <g
          key={`l${i}`}
          transform={`translate(${x(FREQS[i])},${y(v)})`}
          onPointerDown={startDrag("left", i)}
          role={editable ? "slider" : undefined}
          tabIndex={editable ? 0 : undefined}
          aria-label={editable ? `Left ear at ${FREQS[i]} hertz` : undefined}
          aria-valuenow={editable ? v : undefined}
          aria-valuemin={editable ? -10 : undefined}
          aria-valuemax={editable ? 100 : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setPoint("left", i, v + 5);
            if (e.key === "ArrowUp") setPoint("left", i, v - 5);
          }}
          style={{ cursor: editable ? "ns-resize" : undefined }}
        >
          {editable && <circle r="14" fill="transparent" />}
          <path d="M-4.5,-4.5 L4.5,4.5 M4.5,-4.5 L-4.5,4.5" stroke="var(--left-ear)" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      ))}
      {audiogram.right.map((v, i) => (
        <g
          key={`r${i}`}
          transform={`translate(${x(FREQS[i])},${y(v)})`}
          onPointerDown={startDrag("right", i)}
          role={editable ? "slider" : undefined}
          tabIndex={editable ? 0 : undefined}
          aria-label={editable ? `Right ear at ${FREQS[i]} hertz` : undefined}
          aria-valuenow={editable ? v : undefined}
          aria-valuemin={editable ? -10 : undefined}
          aria-valuemax={editable ? 100 : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setPoint("right", i, v + 5);
            if (e.key === "ArrowUp") setPoint("right", i, v - 5);
          }}
          style={{ cursor: editable ? "ns-resize" : undefined }}
        >
          {editable && <circle r="14" fill="transparent" />}
          <circle r="5" fill="var(--paper)" stroke="var(--right-ear)" strokeWidth="2.2" />
        </g>
      ))}
      <text x={W - M.r} y={H - M.b - 6} fontSize="10" textAnchor="end" fill="var(--graphite)">
        shaded: too quiet for {ear === "left" ? "the left" : "the right"} (better) ear
      </text>
    </svg>
  );
}
