"use client";

import { useId, useMemo, useSyncExternalStore } from "react";
import { gridPoints, interpolateField, MAP_EXTENT, MAP_SIZE, X_DEG, Y_DEG } from "@/lib/field";
import type { Grid } from "@/lib/types";

/** Greyscale like a perimetry printout: paper where vision is typical, ink where little gets through. */
function tdToGrey(td: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, -td / 28));
  const paper = [236, 238, 233];
  const ink = [28, 34, 38];
  return paper.map((p, i) => Math.round(p + (ink[i] - p) * Math.pow(t, 0.8))) as [number, number, number];
}

const noopSubscribe = () => () => {};

function heatmapUrl(grid: Grid): string {
  const map = interpolateField(grid);
  const c = document.createElement("canvas");
  c.width = MAP_SIZE;
  c.height = MAP_SIZE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
  for (let k = 0; k < map.length; k++) {
    const v = map[k];
    const [r, g, b] = Number.isFinite(v) ? tdToGrey(v) : [0, 0, 0];
    img.data.set([r, g, b, Number.isFinite(v) ? 255 : 0], k * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

interface Props {
  grid: Grid;
  size?: number;
  showDots?: boolean;
  showLabels?: boolean;
  className?: string;
  title: string;
}

/** One binocular map of someone's field, centred on where they look. */
export function FieldMap({ grid, size = 280, showDots = true, showLabels = true, className, title }: Props) {
  const hatchId = useId().replace(/:/g, "");
  const pts = useMemo(() => gridPoints(grid), [grid]);
  // The heatmap is drawn with a canvas, so only after hydration.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const url = useMemo(() => (hydrated ? heatmapUrl(grid) : null), [grid, hydrated]);
  const E = MAP_EXTENT;
  const pad = showLabels ? 9 : 1;

  return (
    <svg
      viewBox={`${-E - pad} ${-E - pad} ${2 * (E + pad)} ${2 * (E + pad)}`}
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
    >
      <defs>
        <pattern id={`h${hatchId}`} width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="2.2" stroke="var(--chart)" strokeWidth="0.7" />
        </pattern>
        <clipPath id={`c${hatchId}`}>
          <circle r={E - 0.5} />
        </clipPath>
      </defs>
      <g clipPath={`url(#c${hatchId})`}>
        <rect x={-E} y={-E} width={2 * E} height={2 * E} fill={`url(#h${hatchId})`} />
        {url && <image href={url} x={-E} y={-E} width={2 * E} height={2 * E} preserveAspectRatio="none" style={{ imageRendering: "auto" }} />}
      </g>
      <circle r={E - 0.5} fill="none" stroke="var(--chart)" strokeWidth="0.4" />
      <circle r={10} fill="none" stroke="var(--graphite)" strokeOpacity="0.25" strokeWidth="0.3" strokeDasharray="1 1" />
      {showDots &&
        pts.map((p) => (
          <circle
            key={`${p.x},${p.y}`}
            cx={p.x}
            cy={-p.y}
            r={p.td > -4 ? 0.9 : 1.25}
            fill={p.td > -10 ? "var(--ink)" : "var(--paper)"}
            fillOpacity={p.td > -4 ? 0.35 : 0.9}
          />
        ))}
      <path d="M -1.8 0 H 1.8 M 0 -1.8 V 1.8" stroke="var(--left-ear)" strokeWidth="0.55" strokeLinecap="round" />
      {showLabels && (
        <g fontSize="3.6" fill="var(--graphite)" textAnchor="middle" fontFamily="inherit">
          <text y={-E - 3}>above</text>
          <text y={E + 5.8}>below</text>
          <text x={-E - 4.5} y={1.2} textAnchor="middle" transform={`rotate(-90 ${-E - 4.5} 0)`}>
            left
          </text>
          <text x={E + 4.5} y={1.2} textAnchor="middle" transform={`rotate(90 ${E + 4.5} 0)`}>
            right
          </text>
        </g>
      )}
    </svg>
  );
}

export const FIELD_TEST_POINTS = { X_DEG, Y_DEG };
