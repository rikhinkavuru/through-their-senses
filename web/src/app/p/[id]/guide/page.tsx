"use client";

import Link from "next/link";
import { TabBar, usePersonCtx } from "@/components/PersonShell";
import { Button } from "@/components/ui";
import { QUOTE_SOURCE } from "@/content/quotes";
import { betterEar, describeHearing, soundsHeard } from "@/lib/audiogram";
import { summarize, whatStillWorks } from "@/lib/field";
import { cap } from "@/lib/pronouns";

function Remove({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} className="no-print ml-2 min-h-8 rounded-full px-2 text-sm text-graphite underline decoration-ink/20 underline-offset-2 hover:text-ink">
      remove
    </button>
  );
}

/**
 * One page for the family, built like communication-partner training: concrete
 * things to do, starting from what already works. The person it's about can edit
 * or remove anything before it is printed or shared.
 */
export default function Guide() {
  const { person, grid, field, p, base, update } = usePersonCtx();
  const works = whatStillWorks(grid, p);
  const s = summarize(grid);
  const ear = betterEar(person.audiogram);
  const sounds = soundsHeard(person.audiogram);
  const accepted = person.fixes.filter((f) => f.decision === "yes");
  const later = person.fixes.filter((f) => f.decision === "later");
  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  const visionTips: string[] = [];
  if (s.worstRegion === "lower") visionTips.push(`Say “step down” or “kerb” before ${p.subj} reach${p.s === "s" ? "es" : ""} it. The lower part of ${p.poss} vision is the hardest.`);
  if (s.worstRegion === "upper") visionTips.push(`Keep cupboard doors closed and mention low branches: the upper part of ${p.poss} vision is the hardest.`);
  if (s.worstRegion === "left" || s.worstRegion === "right") visionTips.push(`Approach from ${p.poss} ${s.worstRegion === "left" ? "right" : "left"} side so ${p.subj} see${p.s} you coming.`);
  visionTips.push(`Leave lights on in hallways and on stairs. ${cap(p.poss)} vision drops further in dim light and takes longer to adjust coming in from outside.`);
  visionTips.push(`Put things back where they live, and against a contrasting background.`);

  return (
    <>
      <main className="mx-auto max-w-2xl px-5 pb-32 pt-[max(1.25rem,env(safe-area-inset-top))] print:max-w-none print:px-0 print:pt-0">
        <header className="no-print flex items-center justify-between gap-3">
          <Link href={base} className="min-h-11 content-center text-[0.98rem] text-graphite hover:text-ink">
            {person.name}
          </Link>
          <Button onClick={() => window.print()}>Print or save as PDF</Button>
        </header>

        <article className="mt-8 print:mt-0">
          <p className="text-graphite">{today}</p>
          <h1 className="mt-1 text-display font-light tracking-[-0.02em] print:text-[2.2rem]">Living well with {person.name}</h1>
          <p className="mt-3 max-w-[60ch] leading-relaxed text-ink/80">
            How {person.name} sees and hears, and what we agreed to do. {cap(p.subj)} can change anything on this page.
          </p>

          <section className="mt-10 break-inside-avoid">
            <h2 className="text-title font-light">What already works</h2>
            <ul className="mt-3 space-y-2 leading-relaxed">
              {works.map((w) => (
                <li key={w}>{w}</li>
              ))}
              {person.strategies.map((st) => (
                <li key={st}>
                  {st}
                  <Remove label={`Remove “${st}”`} onClick={() => update({ strategies: person.strategies.filter((x) => x !== st) })} />
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10 break-inside-avoid">
            <h2 className="text-title font-light">Talking with {p.obj}</h2>
            <p className="mt-2 text-graphite">{describeHearing(person.audiogram, p)}</p>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              <li>Get {p.poss} attention before you start, then face {p.obj} with light on your face.</li>
              <li>Stay within about 3 metres, and sit on {p.poss} {ear} side.</li>
              <li>Speak a little slower and more clearly, not louder. Shouting distorts speech.</li>
              <li>If a word doesn’t land twice, say it another way instead of repeating it.</li>
              <li>At meals, turn off music and the TV. Noise costs {p.obj} far more than it costs you.</li>
              {sounds.missed.length > 0 && (
                <li>
                  {cap(p.subj)} won’t hear the {sounds.missed.slice(0, 3).join(", ")}. Mention the doorbell or phone if it rings.
                </li>
              )}
            </ul>
            {person.seating && (
              <p className="mt-4 leading-relaxed">
                <strong>Where to sit:</strong> {person.seating.note}
                <Remove label="Remove seating note" onClick={() => update({ seating: undefined })} />
              </p>
            )}
            {!!person.phrases?.length && (
              <div className="mt-4">
                <p className="font-bold">Ways of saying things that come through better</p>
                <ul className="mt-2 space-y-1.5">
                  {person.phrases.map((ph) => (
                    <li key={ph}>
                      “{ph}”
                      <Remove label={`Remove “${ph}”`} onClick={() => update({ phrases: person.phrases!.filter((x) => x !== ph) })} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="mt-10 break-inside-avoid">
            <h2 className="text-title font-light">Getting around</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              {visionTips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>

          <section className="mt-10 break-inside-avoid">
            <h2 className="text-title font-light">Changes at home</h2>
            {accepted.length === 0 && later.length === 0 ? (
              <p className="mt-2 text-graphite">
                None chosen yet. <Link href={`${base}/walk`} className="no-print underline underline-offset-4">Walk through the house together</Link> to find edges worth marking.
              </p>
            ) : (
              <>
                {accepted.length > 0 && (
                  <ul className="mt-3 space-y-2 leading-relaxed">
                    {accepted.map((f) => (
                      <li key={f.hazardId} className="flex items-baseline gap-3">
                        <span aria-hidden className="mt-1 h-3.5 w-3.5 shrink-0 rounded-[3px] border-2 border-ink" />
                        <span>
                          {f.label}: {f.fix}.
                          <Remove label={`Remove ${f.label}`} onClick={() => update({ fixes: person.fixes.filter((x) => x.hazardId !== f.hazardId) })} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {later.length > 0 && (
                  <p className="mt-3 text-graphite">
                    Maybe later: {later.map((f) => f.label.toLowerCase()).join("; ")}.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="mt-10 break-inside-avoid">
            <h2 className="text-title font-light">{cap(p.poss)} notes</h2>
            <textarea
              value={person.notes}
              onChange={(e) => update({ notes: e.target.value })}
              rows={4}
              placeholder={`Anything ${person.name} wants people to know`}
              className="no-print mt-3 block w-full rounded-xl border border-ink/20 bg-white p-4 leading-relaxed"
            />
            <p className="hidden whitespace-pre-wrap leading-relaxed print:block">{person.notes || " "}</p>
          </section>

          <footer className="mt-12 border-t border-chart pt-4 text-sm leading-relaxed text-graphite">
            Made with Through Their Senses from {person.customField ? "a visual field test entered by hand" : `a visual field test from the University of Washington UWHVF dataset (patient ${field.sourcePatient})`} and a hearing test ({person.audiogram.source}). Quotes
            and coping ideas draw on {QUOTE_SOURCE.cite}. For understanding and planning together; not a medical assessment.
          </footer>
        </article>
      </main>
      <div className="no-print">
        <TabBar base={base} />
      </div>
    </>
  );
}
