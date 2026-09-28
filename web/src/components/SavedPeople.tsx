"use client";

import Link from "next/link";
import { usePeople } from "@/lib/people";

export function SavedPeople() {
  const people = usePeople().filter((p) => !p.isExample);
  if (!people.length) return null;
  return (
    <div className="mt-10">
      <h2 className="text-[1.05rem] font-bold">On this device</h2>
      <ul className="mt-3 divide-y divide-chart border-y border-chart">
        {people.map((p) => (
          <li key={p.id}>
            <Link href={`/p/${p.id}`} className="flex min-h-14 items-center justify-between py-3 hover:bg-ink/[0.03]">
              <span className="text-[1.1rem]">{p.name}</span>
              <span className="text-sm text-graphite">Open</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
