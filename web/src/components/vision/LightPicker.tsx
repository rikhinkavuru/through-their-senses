"use client";

import { Segmented } from "@/components/ui";
import type { Light } from "@/lib/vision/light";

const OPTIONS: { value: Light; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
];

/** Light level for the vision views: daylight, a lamp-lit evening room, or a room lit only by a TV. */
export function LightPicker({ value, onChange }: { value: Light; onChange: (l: Light) => void }) {
  return <Segmented value={value} options={OPTIONS} onChange={onChange} label="Light level" dark />;
}

/** ?light=evening|night (or the older ?night=1) from the address, for filming. */
export function lightFromUrl(): Light {
  if (typeof window === "undefined") return "day";
  const q = new URLSearchParams(window.location.search);
  const l = q.get("light");
  if (l === "evening" || l === "night") return l;
  return q.get("night") === "1" ? "night" : "day";
}
