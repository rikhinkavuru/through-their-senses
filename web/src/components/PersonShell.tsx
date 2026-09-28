"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useField } from "@/lib/data";
import { gridPoints } from "@/lib/field";
import { diffuseLoss } from "@/lib/vision/light";
import { updatePerson, usePerson } from "@/lib/people";
import { pronouns, type Pronouns } from "@/lib/pronouns";
import type { FieldProfile, Grid, Person } from "@/lib/types";
import { ButtonLink } from "./ui";

interface PersonCtx {
  person: Person;
  field: FieldProfile;
  visit: number;
  setVisit: (i: number) => void;
  grid: Grid;
  /** Age at the chosen visit. */
  age: number;
  /** Diffuse component of the field loss at that visit (dB, <= 0), used for dim light. */
  diffuseTd: number;
  p: Pronouns;
  update: (patch: Partial<Person>) => void;
  base: string;
}

const Ctx = createContext<PersonCtx | null>(null);

export function usePersonCtx(): PersonCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePersonCtx outside PersonShell");
  return v;
}

const TABS = [
  { href: "", label: "About", icon: "about" },
  { href: "/see", label: "See", icon: "see" },
  { href: "/hear", label: "Hear", icon: "hear" },
  { href: "/walk", label: "Walk", icon: "walk" },
  { href: "/sit", label: "Sit", icon: "sit" },
  { href: "/guide", label: "Guide", icon: "guide" },
] as const;

function TabIcon({ name }: { name: (typeof TABS)[number]["icon"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "about":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          <circle cx="12" cy="8" r="3.5" {...common} />
          <path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4" {...common} />
        </svg>
      );
    case "see":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          {[6, 10, 14, 18].flatMap((x) => [8, 12, 16].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={x === 14 && y === 16 ? 1.6 : 1} fill="currentColor" opacity={x === 14 && y === 16 ? 0.35 : 1} />))}
        </svg>
      );
    case "hear":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          <path d="M4 17 L8 9 L12 12 L16 7 L20 8" {...common} />
          <circle cx="8" cy="9" r="1.6" {...common} />
          <path d="M14.6 5.6l2.8 2.8M17.4 5.6l-2.8 2.8" {...common} />
        </svg>
      );
    case "walk":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          <path d="M4 19h4v-4h4v-4h4V7h4" {...common} />
        </svg>
      );
    case "sit":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          <circle cx="12" cy="12" r="5" {...common} />
          <circle cx="12" cy="4" r="1.5" fill="currentColor" />
          <circle cx="19.5" cy="15" r="1.5" fill="currentColor" />
          <circle cx="4.5" cy="15" r="1.5" {...common} />
        </svg>
      );
    case "guide":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          <path d="M7 3.5h7l4 4V20.5H7z" {...common} />
          <path d="M10 11h5M10 14.5h5M10 18h3" {...common} />
        </svg>
      );
  }
}

export function TabBar({ base, dark = false }: { base: string; dark?: boolean }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Sections"
      className={`no-print fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] ${
        dark ? "border-white/10 bg-camera/80 text-white backdrop-blur-xl" : "border-chart bg-paper/92 text-ink backdrop-blur-xl"
      }`}
    >
      <ul className="mx-auto grid max-w-xl grid-cols-6">
        {TABS.map((t) => {
          const href = `${base}${t.href}`;
          const active = t.href === "" ? path === base : path.startsWith(href);
          return (
            <li key={t.label}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.78rem] transition-colors ${
                  active ? "font-bold" : dark ? "text-white/80 hover:text-white" : "text-graphite hover:text-ink"
                }`}
              >
                <TabIcon name={t.icon} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PersonShell({ id, children }: { id: string; children: ReactNode }) {
  const person = usePerson(id);
  const libraryField = useField(person && !person.customField ? person.fieldId : undefined);
  const field = person?.customField ?? libraryField;
  const [visit, setVisit] = useState<number | null>(null);

  const value = useMemo<PersonCtx | null>(() => {
    if (!person || !field) return null;
    const v = visit ?? field.visits.length - 1;
    return {
      person,
      field,
      visit: v,
      setVisit,
      grid: field.visits[v].binocularFit,
      age: field.visits[v].age,
      diffuseTd: diffuseLoss(gridPoints(field.visits[v].binocularFit).map((q) => q.td)),
      p: pronouns(person.pronouns),
      update: (patch) => updatePerson(person.id, patch),
      base: `/p/${person.id}`,
    };
  }, [person, field, visit]);

  if (person === null) {
    return (
      <main className="mx-auto max-w-xl px-5 py-16">
        <h1 className="text-title font-light">This profile isn’t on this device</h1>
        <p className="mt-3 text-graphite">Profiles are stored only in the browser where they were made. Open it on that device, or set up a new one.</p>
        <div className="mt-6 flex gap-3">
          <ButtonLink href="/start">Set up a profile</ButtonLink>
          <ButtonLink href="/" kind="secondary">
            Home
          </ButtonLink>
        </div>
      </main>
    );
  }
  if (!value) {
    return (
      <main className="grid min-h-dvh place-items-center" aria-busy="true">
        <p className="text-graphite">Loading…</p>
      </main>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
