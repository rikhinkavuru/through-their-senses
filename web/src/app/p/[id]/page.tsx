"use client";

import Link from "next/link";
import { ViewTransition } from "react";
import { AudiogramChart } from "@/components/AudiogramChart";
import { FieldMap } from "@/components/FieldMap";
import { TabBar, usePersonCtx } from "@/components/PersonShell";
import { ButtonLink, HelpSheet, QuoteBlock, SourceNote } from "@/components/ui";
import { quoteFor } from "@/content/quotes";
import { describeHearing } from "@/lib/audiogram";
import { summarize, whatStillWorks } from "@/lib/field";
import { cap } from "@/lib/pronouns";

export default function About() {
  const { person, field, visit, grid, p, base } = usePersonCtx();
  const works = whatStillWorks(grid, p);
  const s = summarize(grid);
  const first = field.visits[0];
  const last = field.visits[visit];
  const setupLine =
    person.setup === "self"
      ? `Set up by ${person.name}.`
      : person.setup === "together"
        ? `Set up together with ${person.name}.`
        : `Set up by ${person.setupBy || "family"}, with ${person.name}’s permission.`;

  const hardest =
    s.worstRegion === "lower"
      ? `The lower part of ${p.poss} field is the hardest, so steps, kerbs and things on the floor need extra care.`
      : s.worstRegion === "upper"
        ? `The upper part of ${p.poss} field is the hardest, so low branches and open cupboard doors are easy to miss.`
        : s.worstRegion
          ? `${cap(p.poss)} ${s.worstRegion} side is the hardest, so things coming from that side are easy to miss.`
          : `${cap(p.poss)} field loss is mild overall.`;

  return (
    <>
      <main className="mx-auto max-w-2xl px-5 pb-32 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between">
          <Link href="/" className="min-h-11 content-center text-[0.98rem] text-graphite hover:text-ink">
            Through Their Senses
          </Link>
          {!person.isExample && (
            <Link href={`/start?edit=${person.id}`} className="min-h-11 content-center text-[0.98rem] underline decoration-ink/25 underline-offset-4">
              Edit
            </Link>
          )}
        </header>

        <h1 className="mt-10 text-display font-light tracking-[-0.02em]">{person.name}</h1>
        <p className="mt-2 text-graphite">
          {setupLine}
          {person.isExample && " An example made from two real, anonymized tests; the name is made up."}
        </p>

        <section className="mt-12" aria-labelledby="works">
          <h2 id="works" className="text-title font-light">
            What still works
          </h2>
          <ul className="mt-4 space-y-3">
            {works.map((w) => (
              <li key={w} className="flex gap-3 leading-relaxed">
                <span aria-hidden className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-works" />
                {w}
              </li>
            ))}
            {person.strategies.map((st) => (
              <li key={st} className="flex gap-3 leading-relaxed">
                <span aria-hidden className="mt-2.5 h-2 w-2 shrink-0 rounded-full border-2 border-works" />
                {st}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14" aria-labelledby="vision">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="vision" className="text-title font-light">
              Vision
            </h2>
            <HelpSheet title="Reading the field map">
              <p>
                This is one map of both eyes together, centred on where {p.subj} look{p.s}. The blue cross is the centre of {p.poss} gaze; the dotted ring is 10 degrees out, about the width of two
                hands held at arm’s length.
              </p>
              <p>Pale areas are typical for {p.poss} age. The darker an area, the less gets through there. Each dot is a point from {p.poss} visual field test.</p>
              <p>The striped edge was never tested, so we don’t guess about it.</p>
            </HelpSheet>
          </div>
          <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <ViewTransition name="field-map">
              <FieldMap grid={grid} size={260} title={`${person.name}'s visual field, both eyes together`} />
            </ViewTransition>
            <div className="space-y-3 leading-relaxed">
              <p>{hardest}</p>
              <p className="text-graphite">
                From {field.visits.length} visual field tests between age {Math.round(first.age)} and {Math.round(last.age)}. We show the trend across tests, since any single test is noisy.
              </p>
            </div>
          </div>
          <ButtonLink href={`${base}/see`} className="mt-6">
            See the room as {p.subj} do{p.s === "s" ? "es" : ""}
          </ButtonLink>
        </section>

        <section className="mt-14" aria-labelledby="hearing">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="hearing" className="text-title font-light">
              Hearing
            </h2>
            <HelpSheet title="Reading the hearing chart">
              <p>Pitch runs from low on the left to high on the right. Quiet sounds are at the top, loud ones at the bottom.</p>
              <p>Red circles are the right ear and blue crosses the left, as on a clinic audiogram. Anything in the shaded area above the better ear’s line is too quiet for {p.obj} to hear.</p>
              <p>Everyday sounds and speech sounds sit where they usually fall. Faded ones are the ones {p.subj} miss{p.s === "s" ? "es" : ""}.</p>
            </HelpSheet>
          </div>
          <AudiogramChart audiogram={person.audiogram} className="mt-5 w-full max-w-md" title={`${person.name}'s hearing test`} />
          <p className="mt-4 leading-relaxed">{describeHearing(person.audiogram, p)}</p>
          <ButtonLink href={`${base}/hear`} className="mt-6">
            Hear your voice as {p.subj} do{p.s === "s" ? "es" : ""}
          </ButtonLink>
        </section>

        <section className="mt-14">
          <QuoteBlock quote={quoteFor("family")} />
        </section>

        <section className="mt-14 space-y-2">
          <SourceNote>
            Vision: {field.citation} Patient {field.sourcePatient}, fitted trend of {field.visits.length} tests.
          </SourceNote>
          <SourceNote>Hearing: {person.audiogram.source}.</SourceNote>
        </section>
      </main>
      <TabBar base={base} />
    </>
  );
}
