"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AudiogramChart } from "@/components/AudiogramChart";
import { HearingTest } from "@/components/hearing-test/HearingTest";
import { FieldMap } from "@/components/FieldMap";
import { Button, Segmented } from "@/components/ui";
import { toAudiogram, useAudiogramLibrary, useFieldIndex } from "@/lib/data";
import { emptyGrid, gridPoints, mergeBinocular, summarize } from "@/lib/field";
import { newId, savePerson, usePeople } from "@/lib/people";
import { cap, pronouns, type PronounSet } from "@/lib/pronouns";
import type { Audiogram, FieldProfile, Grid, Person, SetupMode } from "@/lib/types";
import { PrintoutEntry } from "./PrintoutEntry";
import { PrintoutPhoto } from "./PrintoutPhoto";

const STEPS = ["Who", "Vision", "Hearing", "What helps", "Check"] as const;

const COMMON_STRATEGIES = [
  "Turns their head to scan before stepping down",
  "Keeps lights on in hallways and on stairs",
  "Uses the handrail on every staircase",
  "Asks people to face them when they talk",
  "Sits with their back to the window",
  "Puts things down against a contrasting background",
];

function severity(md: number) {
  if (md > -6) return "mild";
  if (md > -12) return "moderate";
  return "advanced";
}

export function SetupFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get("edit");
  const people = usePeople();
  const existing = editId ? people.find((x) => x.id === editId) : undefined;

  const [step, setStep] = useState(0);
  const [name, setName] = useState(existing?.name ?? "");
  const [pro, setPro] = useState<PronounSet>(existing?.pronouns ?? "she");
  const [mode, setMode] = useState<SetupMode>(existing?.setup ?? "together");
  const [setupBy, setSetupBy] = useState(existing?.setupBy ?? "");
  const [consent, setConsent] = useState(!!existing);

  const [fieldSource, setFieldSource] = useState<"library" | "printout">(existing?.customField ? "printout" : "library");
  const [fieldId, setFieldId] = useState(existing?.fieldId ?? "");
  const [right, setRight] = useState<Grid>(existing?.customField?.visits[0].right ?? emptyGrid());
  const [left, setLeft] = useState<Grid>(existing?.customField?.visits[0].left ?? emptyGrid());
  const [testAge, setTestAge] = useState(existing?.customField ? String(Math.round(existing.customField.visits[0].age)) : "");

  const audLib = useAudiogramLibrary();
  const fieldIdx = useFieldIndex();
  const [audiogram, setAudiogram] = useState<Audiogram | null>(existing?.audiogram ?? null);
  const [testing, setTesting] = useState(false);
  // Bumped when a photo fills a grid, so the typed inputs remount with the new values.
  const [gridVersion, setGridVersion] = useState(0);
  const [strategies, setStrategies] = useState<string[]>(existing?.strategies ?? []);
  const [extra, setExtra] = useState("");

  const p = pronouns(pro);
  const who = name.trim() || "them";
  const binocular = useMemo(() => mergeBinocular(right, left), [right, left]);
  const printoutCount = gridPoints(binocular).length;

  const fieldReady = fieldSource === "library" ? !!fieldId : printoutCount >= 30;
  const canNext = [
    name.trim().length > 0 && (mode !== "for" || (consent && setupBy.trim().length > 0)),
    fieldReady,
    !!audiogram,
    true,
    true,
  ][step];

  function save() {
    const id = existing?.id ?? newId();
    let customField: FieldProfile | undefined;
    if (fieldSource === "printout") {
      const s = summarize(binocular);
      customField = {
        id: `custom-${id}`,
        source: "UWHVF",
        sourcePatient: "entered by hand",
        gender: null,
        md: s.md,
        supMd: s.upper ?? 0,
        infMd: s.lower ?? 0,
        mdSlopePerYear: 0,
        demoCandidate: false,
        grid: { xDeg: [-27, -21, -15, -9, -3, 3, 9, 15, 21, 27], yDeg: [21, 15, 9, 3, -3, -9, -15, -21], spacingDeg: 6 },
        citation: "Entered by hand from a Humphrey 24-2 printout.",
        visits: [{ age: Number(testAge) || 70, binocular, binocularFit: binocular, right, left, rightFit: right, leftFit: left }],
      };
    }
    const person: Person = {
      id,
      name: name.trim(),
      pronouns: pro,
      setup: mode,
      setupBy: mode === "for" ? setupBy.trim() : undefined,
      fieldId: fieldSource === "library" ? fieldId : existing?.fieldId ?? "",
      customField,
      audiogram: audiogram!,
      strategies: [...strategies, ...extra.split("\n").map((x) => x.trim()).filter(Boolean)],
      fixes: existing?.fixes ?? [],
      notes: existing?.notes ?? "",
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    savePerson(person);
    router.push(`/p/${id}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-5 pb-28 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Link href={existing ? `/p/${existing.id}` : "/"} className="min-h-11 content-center text-graphite hover:text-ink">
          Cancel
        </Link>
        <p className="text-graphite tabular" aria-live="polite">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
      </header>
      <div className="mt-3 grid grid-cols-5 gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s} className={`h-1 rounded-full ${i <= step ? "bg-ink" : "bg-ink/15"}`} />
        ))}
      </div>

      {step === 0 && (
        <section className="mt-10 space-y-8">
          <h1 className="text-display font-light tracking-[-0.02em]">Who is this for?</h1>
          <label className="block">
            <span className="font-bold">Their first name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="mt-2 block h-12 w-full rounded-xl border border-ink/20 bg-white px-4 text-[1.1rem] focus:border-ink"
            />
          </label>
          <div>
            <p className="font-bold">How should we refer to them?</p>
            <div className="mt-2">
              <Segmented
                label="Pronouns"
                value={pro}
                onChange={setPro}
                options={[
                  { value: "she", label: "she / her" },
                  { value: "he", label: "he / him" },
                  { value: "they", label: "they / them" },
                ]}
              />
            </div>
          </div>
          <div>
            <p className="font-bold">Who is setting this up?</p>
            <div className="mt-3 space-y-2" role="radiogroup" aria-label="Who is setting this up">
              {(
                [
                  ["together", name.trim() ? `We’re doing this together with ${name.trim()}` : "We’re doing this together"],
                  ["self", name.trim() ? `${name.trim()} is setting it up` : "The person it’s about is setting it up"],
                  ["for", name.trim() ? `I’m setting it up for ${name.trim()}` : "I’m setting it up for someone else"],
                ] as [SetupMode, string][]
              ).map(([v, label]) => (
                <label key={v} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 ${mode === v ? "border-ink bg-ink/[0.04]" : "border-ink/15"}`}>
                  <input type="radio" name="mode" checked={mode === v} onChange={() => setMode(v)} className="h-5 w-5 accent-ink" />
                  {label}
                </label>
              ))}
            </div>
            {mode === "for" && (
              <div className="mt-4 space-y-3 rounded-2xl bg-ink/[0.04] p-4">
                <label className="block">
                  <span className="font-bold">Your name</span>
                  <input value={setupBy} onChange={(e) => setSetupBy(e.target.value)} className="mt-2 block h-12 w-full rounded-xl border border-ink/20 bg-white px-4" />
                </label>
                <label className="flex items-start gap-3">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-ink" />
                  <span>
                    {name.trim() ? `${name.trim()} knows` : "They know"} about this and agreed to share {p.poss} test results. The plan we make is {p.poss} to change.
                  </span>
                </label>
              </div>
            )}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="mt-10 space-y-6">
          <h1 className="text-display font-light tracking-[-0.02em]">{cap(p.poss)} visual field</h1>
          <Segmented
            label="Where the field comes from"
            value={fieldSource}
            onChange={setFieldSource}
            options={[
              { value: "printout", label: "From the printout" },
              { value: "library", label: "Pick a similar one" },
            ]}
          />
          {fieldSource === "printout" ? (
            <div className="space-y-6">
              <p className="leading-relaxed text-ink/80">
                On a Humphrey 24-2 report, find the grid labelled <strong>Total Deviation</strong> (numbers, usually below the grey picture). Photograph each eye’s printout and the numbers fill in,
                or type each number where it sits. Leave blanks for anything you can’t read. The dots are the blind spot.
              </p>
              <label className="block max-w-40">
                <span className="font-bold">Age at the test</span>
                <input inputMode="numeric" value={testAge} onChange={(e) => setTestAge(e.target.value)} className="mt-2 block h-12 w-full rounded-xl border border-ink/20 bg-white px-4" />
              </label>
              <div className="flex flex-col gap-8 overflow-x-auto">
                {(["left", "right"] as const).map((eye) => (
                  <div key={eye} className="space-y-3">
                    <PrintoutPhoto
                      eye={eye}
                      onRead={(g, age) => {
                        (eye === "left" ? setLeft : setRight)(g);
                        if (age && !testAge) setTestAge(String(Math.round(age)));
                        setGridVersion((v) => v + 1);
                      }}
                    />
                    <PrintoutEntry key={`${eye}-${gridVersion}`} eye={eye} grid={eye === "left" ? left : right} onChange={eye === "left" ? setLeft : setRight} />
                  </div>
                ))}
                <p className="text-sm leading-relaxed text-graphite">A photo is sent to Claude (Anthropic) only to read the numbers; we don’t keep it.</p>
              </div>
              <div className="flex items-center gap-5">
                <FieldMap grid={binocular} size={170} showLabels={false} title="Both eyes together, from the numbers entered" />
                <p className="text-graphite">
                  Both eyes together, from {printoutCount} points. {printoutCount < 30 ? "Enter at least 30 points to continue." : "Looks complete enough."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="leading-relaxed text-ink/80">
                These are real, anonymized tests from the University of Washington. If you don’t have the printout, choose the one that sounds closest to what {p.poss} eye doctor described. You can
                change it later.
              </p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {fieldIdx?.profiles.map((f) => {
                  const worse = f.infMd < f.supMd - 2 ? "lower field worse" : f.supMd < f.infMd - 2 ? "upper field worse" : "even";
                  return (
                    <li key={f.id}>
                      <button
                        onClick={() => setFieldId(f.id)}
                        aria-pressed={fieldId === f.id}
                        className={`flex w-full flex-col items-center rounded-2xl border p-3 text-center ${fieldId === f.id ? "border-ink bg-ink/[0.05]" : "border-ink/15 hover:border-ink/40"}`}
                      >
                        <FieldMap grid={f.preview} size={120} showLabels={false} showDots={false} title={`${severity(f.md)} loss, ${worse}`} />
                        <span className="mt-2 font-bold">{cap(severity(f.md))}</span>
                        <span className="text-sm text-graphite">{worse}</span>
                      </button>
                    </li>
                  );
                }) ?? <li className="text-graphite">Loading…</li>}
              </ul>
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="mt-10 space-y-6">
          <h1 className="text-display font-light tracking-[-0.02em]">{cap(p.poss)} hearing</h1>
          <p className="leading-relaxed text-ink/80">
            If {p.subj} {p.has} an audiogram, start from the closest profile below, then drag the red circles (right ear) and blue crosses (left ear) to match {p.poss} results. Each step is 5 dB.
          </p>
          <div className="rounded-2xl border border-ink/15 p-4">
            <p className="leading-relaxed">No audiogram? Test {p.poss} hearing here together: a beep test on headphones, about 12 minutes for the two of you.</p>
            <Button kind="secondary" className="mt-3" onClick={() => setTesting(true)}>
              Test {p.poss} hearing
            </Button>
          </div>
          {testing && (
            <HearingTest
              name={who}
              p={p}
              defaultHelper={setupBy}
              onClose={() => setTesting(false)}
              onDone={(a) => {
                setAudiogram(a);
                setTesting(false);
              }}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {audLib?.typical.map((t) => (
              <button key={t.id} onClick={() => setAudiogram(toAudiogram(t))} className="min-h-11 rounded-full bg-ink/[0.06] px-4 text-[0.95rem] hover:bg-ink/[0.1]">
                {t.label}
              </button>
            ))}
          </div>
          {audiogram ? (
            <AudiogramChart audiogram={audiogram} onChange={setAudiogram} className="w-full max-w-md" title={`${who}'s hearing test, editable`} />
          ) : (
            <p className="rounded-2xl bg-ink/[0.04] p-4 text-graphite">Choose a starting profile above.</p>
          )}
          {audiogram && <p className="text-sm text-graphite">Source: {audiogram.source}.</p>}
        </section>
      )}

      {step === 3 && (
        <section className="mt-10 space-y-6">
          <h1 className="text-display font-light tracking-[-0.02em]">What already helps {who}?</h1>
          <p className="leading-relaxed text-ink/80">People with glaucoma and hearing loss build their own ways of coping. Start from those: they go at the top of the plan.</p>
          <ul className="space-y-2">
            {COMMON_STRATEGIES.map((s) => {
              const on = strategies.includes(s);
              return (
                <li key={s}>
                  <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 ${on ? "border-ink bg-ink/[0.04]" : "border-ink/15"}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setStrategies(on ? strategies.filter((x) => x !== s) : [...strategies, s])}
                      className="h-5 w-5 accent-ink"
                    />
                    {s}
                  </label>
                </li>
              );
            })}
          </ul>
          <label className="block">
            <span className="font-bold">Anything else, one per line</span>
            <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={3} className="mt-2 block w-full rounded-xl border border-ink/20 bg-white p-4" />
          </label>
        </section>
      )}

      {step === 4 && (
        <section className="mt-10 space-y-6">
          <h1 className="text-display font-light tracking-[-0.02em]">Ready</h1>
          <ul className="space-y-3 leading-relaxed">
            <li>
              <strong>{name}</strong> ({pro === "they" ? "they / them" : pro === "she" ? "she / her" : "he / him"}),{" "}
              {mode === "together" ? "set up together" : mode === "self" ? `set up by ${name}` : `set up by ${setupBy} with ${p.poss} permission`}.
            </li>
            <li>Vision: {fieldSource === "printout" ? `${printoutCount} points typed from the printout` : "a similar real test from the UWHVF library"}.</li>
            <li>Hearing: {audiogram?.source}.</li>
            <li>{strategies.length + extra.split("\n").filter((x) => x.trim()).length} things that already help.</li>
          </ul>
          <p className="text-graphite">Everything stays in this browser. Nothing about {p.obj} is uploaded, except a sentence you record on the Hear screen, which is processed and discarded.</p>
        </section>
      )}

      <div className="mt-12 flex gap-3">
        {step > 0 && (
          <Button kind="secondary" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
            Continue
          </Button>
        ) : (
          <Button onClick={save}>{existing ? "Save changes" : `Open ${name.trim() || "profile"}`}</Button>
        )}
      </div>
    </main>
  );
}
