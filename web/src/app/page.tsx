import Link from "next/link";
import { HeroSentence } from "@/components/HeroSentence";
import { SavedPeople } from "@/components/SavedPeople";
import { ButtonLink } from "@/components/ui";

const SECTIONS = [
  { title: "See", body: "Point your phone at a room and see it through their visual field test, the way people with glaucoma describe it: soft and missing, never a black tunnel." },
  { title: "Hear", body: "Say a sentence. A hearing model built on their audiogram shows which sounds get lost, what they probably heard, and a better way to say it." },
  { title: "Walk and sit", body: "Walk through the house together to find the edges that are hard to see, and find the seat at the table where they can hear you and see your face." },
  { title: "Guide", body: "Everything you agree on becomes one page for the family, which they can edit before anyone else sees it." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <p className="text-[1.05rem] font-bold tracking-tight">Through Their Senses</p>
        <Link href="/method" className="min-h-11 content-center text-[0.98rem] underline decoration-ink/25 underline-offset-4 hover:decoration-ink">
          How it works
        </Link>
      </header>

      <section className="pt-14 sm:pt-20" aria-labelledby="intro">
        <HeroSentence />
        <h1 id="intro" className="mt-14 max-w-[22ch] text-display font-light tracking-[-0.02em]">
          Understand how someone you love sees and hears.
        </h1>
        <p className="mt-5 max-w-[56ch] text-[1.15rem] leading-relaxed text-ink/80">
          Load their visual field test and hearing test. See your room and hear your own voice the way they do, then decide together what to change at home and how to talk with each other.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/p/example">Try the example</ButtonLink>
          <ButtonLink href="/start" kind="secondary">
            Set up with real results
          </ButtonLink>
        </div>
        <SavedPeople />
      </section>

      <section className="mt-20 border-t border-chart pt-10" aria-label="What you can do">
        <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <dt className="text-[1.2rem] font-bold">{s.title}</dt>
              <dd className="mt-1.5 leading-relaxed text-ink/80">{s.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mt-20 space-y-3 border-t border-chart pt-8 text-sm leading-relaxed text-graphite">
        <p>
          Built on public, anonymized data: visual fields from the University of Washington UWHVF dataset and hearing tests from the CDC’s NHANES survey. Profiles you make stay in this browser.
        </p>
        <p>For understanding and planning together. It does not diagnose anything and is not a substitute for an eye or hearing specialist.</p>
      </footer>
    </main>
  );
}
