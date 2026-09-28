"use client";

import { useState } from "react";
import { VisionView } from "@/components/vision/VisionView";
import { useField } from "@/lib/data";

// Developer check page for the renderer. Not linked from the app.
export default function Lab() {
  const field = useField("uwhvf-817");
  const [wipe, setWipe] = useState(0.5);
  const [night, setNight] = useState(false);
  const [visit, setVisit] = useState(-1);
  const [scene, setScene] = useState("hallway");
  if (!field) return <p className="p-6">Loading field…</p>;
  const v = field.visits.at(visit)!;
  return (
    <main className="p-4 space-y-3">
      <div className="relative w-full" style={{ aspectRatio: "4 / 3" }}>
        <VisionView label="lab" grid={v.binocularFit} source={{ kind: "image", src: `/scenes/${scene}.jpg`, hfovDeg: 66 }} wipe={wipe} night={night} className="absolute inset-0 h-full w-full" />
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <input aria-label="wipe" type="range" min={0} max={1} step={0.01} value={wipe} onChange={(e) => setWipe(+e.target.value)} />
        <label><input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} /> night</label>
        <select aria-label="visit" value={visit} onChange={(e) => setVisit(+e.target.value)}>
          {field.visits.map((x, i) => <option key={i} value={i}>{x.age.toFixed(1)}</option>)}
        </select>
        <select aria-label="scene" value={scene} onChange={(e) => setScene(e.target.value)}>
          {["hallway", "stairs", "living-room", "dinner"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
    </main>
  );
}
