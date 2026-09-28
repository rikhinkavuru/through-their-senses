"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudiogramChart } from "@/components/AudiogramChart";
import { Button } from "@/components/ui";
import { FREQS } from "@/lib/audiogram";
import { DEFAULT_LIMITS, EAR_ORDER, recordResponse, startSearch } from "@/lib/hearing-test/procedure";
import { fillGaps, referenceEar, type EarResult, type Session } from "@/lib/hearing-test/reference";
import { TONE_SECONDS, ToneEngine, type Ear } from "@/lib/hearing-test/tones";
import type { Pronouns } from "@/lib/pronouns";
import type { Audiogram } from "@/lib/types";

type Stage = "intro" | "sound" | "sides" | "helper-ready" | "helper" | "handover" | "person" | "result";

interface Progress {
  ear: Ear;
  index: number;
  total: number;
}

const RESPONSE_MS = 1100; // after the tone ends
const HELPER_ORDER = EAR_ORDER.filter((f, i) => !(f === 1000 && i > 0));

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("stopped", "AbortError"));
    });
  });

interface Props {
  name: string;
  p: Pronouns;
  defaultHelper?: string;
  onDone: (a: Audiogram) => void;
  onClose: () => void;
}

export function HearingTest({ name, p, defaultHelper = "", onDone, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("intro");
  const [helper, setHelper] = useState(defaultHelper);
  const [helperAge, setHelperAge] = useState("");
  const [typical, setTypical] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState(false);
  const [sideTrial, setSideTrial] = useState<{ ear: Ear; n: number; wrong: boolean } | null>(null);
  const [helperSession, setHelperSession] = useState<Session | null>(null);
  const [personSession, setPersonSession] = useState<Session | null>(null);
  const engine = useRef<ToneEngine | null>(null);
  const presses = useRef<number[]>([]);
  const pausedRef = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const helperName = helper.trim() || "The helper";

  useEffect(
    () => () => {
      abort.current?.abort();
      engine.current?.close();
    },
    [],
  );

  const getEngine = async () => {
    engine.current ??= new ToneEngine();
    await engine.current.resume();
    return engine.current;
  };

  const press = useCallback(() => {
    presses.current.push(performance.now());
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
  }, []);

  // Space bar or Enter also count as "I hear it" during a test.
  useEffect(() => {
    if (stage !== "helper" && stage !== "person") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat && !(e.target instanceof HTMLButtonElement && e.key === "Enter")) {
        e.preventDefault();
        press();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, press]);

  /** Run the whole tone test for one listener, both ears. */
  const runListener = useCallback(async (order: readonly number[], signal: AbortSignal): Promise<Session> => {
    const eng = await getEngine();
    const session: Session = { right: { thresholds: {} }, left: { thresholds: {} }, falseAlarms: 0, catchTrials: 0 };
    let lastWindowEnd = performance.now();

    const pausePoint = async () => {
      while (pausedRef.current) await wait(200, signal);
    };

    // Quiet gap between presentations; a press here is a false alarm and restarts the gap.
    const gap = async () => {
      for (;;) {
        await pausePoint();
        const since = performance.now();
        await wait(800 + Math.random() * 1000, signal);
        const stray = presses.current.some((t) => t > Math.max(since, lastWindowEnd + 250));
        presses.current = [];
        if (!stray) return;
        session.falseAlarms++;
      }
    };

    const present = async (f: number, level: number, ear: Ear, silent: boolean): Promise<boolean> => {
      presses.current = [];
      const onset = eng.play(f, level, ear, silent);
      const end = onset + TONE_SECONDS * 1000 + RESPONSE_MS;
      while (performance.now() < end) {
        if (presses.current.some((t) => t >= onset + 100 && t <= end)) break;
        await wait(40, signal);
      }
      lastWindowEnd = performance.now();
      return presses.current.some((t) => t >= onset + 100 && t <= end);
    };

    for (const ear of ["right", "left"] as const) {
      const res: EarResult = session[ear];
      let prev: number | null = null;
      for (let i = 0; i < order.length; i++) {
        const f = order[i];
        setProgress({ ear, index: i, total: order.length });
        const start = prev === null ? DEFAULT_LIMITS.start : Math.min(DEFAULT_LIMITS.max, prev + 15);
        const lim = { ...DEFAULT_LIMITS, start };
        let s = startSearch(lim);
        let real = 0;
        while (!s.done) {
          await gap();
          // About one presentation in eight is silent, to check for guessing.
          const silent = real >= 2 && Math.random() < 1 / 8;
          const heard = await present(f, s.level, ear, silent);
          if (silent) {
            session.catchTrials++;
            if (heard) session.falseAlarms++;
            continue;
          }
          s = recordResponse(s, heard, lim);
          real++;
        }
        if (f === 1000 && f in res.thresholds) res.retest1k = [res.thresholds[1000], s.threshold];
        else res.thresholds[f] = s.threshold;
        if (s.threshold !== null) prev = s.threshold;
      }
      // Use the average of the two 1 kHz measurements when both exist.
      if (res.retest1k && res.retest1k[0] !== null && res.retest1k[1] !== null) res.thresholds[1000] = (res.retest1k[0] + res.retest1k[1]) / 2;
    }
    return session;
  }, []);

  const startListener = async (who: "helper" | "person") => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setPaused(false);
    pausedRef.current = false;
    setStage(who);
    try {
      const s = await runListener(who === "helper" ? HELPER_ORDER : EAR_ORDER, ctl.signal);
      if (who === "helper") {
        setHelperSession(s);
        setStage("handover");
      } else {
        setPersonSession(s);
        setStage("result");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
    } finally {
      setProgress(null);
    }
  };

  const playSample = async () => (await getEngine()).play(1000, -30, "both");

  const nextSide = async (n: number) => {
    const ear: Ear = Math.random() < 0.5 ? "left" : "right";
    setSideTrial({ ear, n, wrong: false });
    (await getEngine()).play(1000, -30, ear);
  };

  const answerSide = async (ans: Ear) => {
    if (!sideTrial) return;
    if (ans !== sideTrial.ear) return setSideTrial({ ...sideTrial, wrong: true });
    if (sideTrial.n >= 2) {
      setSideTrial(null);
      setStage("helper-ready");
    } else void nextSide(sideTrial.n + 1);
  };

  const age = Number(helperAge);
  const introReady = helper.trim().length > 0 && Number.isFinite(age) && age >= 10 && age <= 90 && typical;

  let result: { audiogram: Audiogram; notes: string[] } | null = null;
  if (stage === "result" && helperSession && personSession) {
    const r = referenceEar(personSession.right, helperSession.right, age);
    const l = referenceEar(personSession.left, helperSession.left, age);
    const notes: string[] = [];
    const fa = personSession.falseAlarms;
    const checks = personSession.catchTrials;
    if (checks > 0 && fa / Math.max(checks, 1) > 0.25) notes.push(`${name} pressed when there was no beep ${fa} times. The results may look better than ${p.poss} hearing is.`);
    for (const [ear, res] of [
      ["right", personSession.right],
      ["left", personSession.left],
    ] as const) {
      const rt = res.retest1k;
      if (rt && rt[0] !== null && rt[1] !== null && Math.abs(rt[0] - rt[1]) > 10)
        notes.push(`In the ${ear} ear, the two 1000 Hz tests differed by ${Math.abs(rt[0] - rt[1])} dB, so that ear is less certain.`);
      const refEar = ear === "right" ? r : l;
      const missed = FREQS.filter((_, i) => refEar.atLeast[i]);
      if (missed.length) notes.push(`No response in the ${ear} ear at ${missed.map((f) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`)).join(", ")}, even at the loudest level: hearing there is at least as poor as shown.`);
    }
    const helper1k = helperSession.right.thresholds[1000];
    if (helper1k !== null && helper1k !== undefined && helper1k > -45) notes.push("The volume seemed low. For people with more loss, turn it up and test again.");
    const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    result = {
      notes,
      audiogram: {
        right: fillGaps(r.hl),
        left: fillGaps(l.hl),
        source: `In-app tone test, ${date}, referenced to ${helperName} (age ${age}). An estimate, typically within about 10 dB of a clinic test`,
        measured: {
          method: "tone-test",
          helperAge: age,
          atLeast: { right: r.atLeast, left: l.atLeast },
          falseAlarms: fa,
          catchTrials: checks,
        },
      },
    };
  }

  const testing = stage === "helper" || stage === "person";
  const listener = stage === "helper" ? helperName : name;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper text-ink">
      <div className="mx-auto flex min-h-full max-w-xl flex-col px-5 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <p className="text-[0.95rem] text-graphite">Hearing test</p>
          <button
            onClick={() => {
              abort.current?.abort();
              onClose();
            }}
            className="min-h-11 rounded-full bg-ink/[0.06] px-4"
          >
            Close
          </button>
        </div>

        {stage === "intro" && (
          <section className="mt-8 space-y-5">
            <h1 className="text-display font-light tracking-[-0.02em]">Test {name}’s hearing together</h1>
            <p className="leading-relaxed">
              No audiogram at hand? Two of you take a beep test on the same headphones. Someone with typical hearing goes first, so the app knows how loud these headphones are; then {name} takes it.
              The difference between you is {p.poss} hearing loss.
            </p>
            <ul className="space-y-2 leading-relaxed">
              <li>• Headphones (wired is best) and a quiet room.</li>
              <li>• About 6 minutes each.</li>
              <li>• {name} takes out any hearing aids.</li>
            </ul>
            <p className="rounded-2xl bg-ink/[0.05] p-4 leading-relaxed text-ink/85">
              This is an estimate, not a diagnosis. Tests done this way usually land within about 10 dB of a clinic’s (Masalski et al., 2014 and 2018). For hearing aids or medical advice, see an
              audiologist.
            </p>
            <label className="block">
              <span className="text-[0.95rem] font-medium">Who has typical hearing and will go first?</span>
              <input value={helper} onChange={(e) => setHelper(e.target.value)} placeholder="Their first name" className="mt-2 min-h-12 w-full rounded-2xl border border-ink/20 bg-white px-4 text-[1.05rem]" />
            </label>
            <label className="block">
              <span className="text-[0.95rem] font-medium">Their age</span>
              <input
                value={helperAge}
                onChange={(e) => setHelperAge(e.target.value.replace(/\D/g, "").slice(0, 2))}
                inputMode="numeric"
                placeholder="e.g. 17"
                className="mt-2 min-h-12 w-32 rounded-2xl border border-ink/20 bg-white px-4 text-[1.05rem] tabular"
              />
              <span className="mt-1 block text-sm text-graphite">Hearing changes slowly with age; the app allows for it using the international standard (ISO 7029).</span>
            </label>
            <label className="flex min-h-11 items-start gap-3">
              <input type="checkbox" checked={typical} onChange={(e) => setTypical(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--ink)]" />
              <span className="leading-relaxed">{helper.trim() || "They"} {helper.trim() ? "has" : "have"} no known hearing problems.</span>
            </label>
            <Button onClick={() => setStage("sound")} disabled={!introReady}>
              Next
            </Button>
          </section>
        )}

        {stage === "sound" && (
          <section className="mt-8 space-y-5">
            <h1 className="text-display font-light tracking-[-0.02em]">Headphones on</h1>
            <p className="leading-relaxed">
              {helperName}, put the headphones on and set the volume to about three quarters. Play the sound: it should be clear and comfortable, not loud.
            </p>
            <p className="rounded-2xl bg-ink/[0.05] p-4 leading-relaxed">Don’t change the volume from now until both of you finish. The test depends on it.</p>
            <p className="text-sm leading-relaxed text-graphite">On an iPhone, turn off silent mode. Turn off noise cancelling only if it hisses.</p>
            <div className="flex flex-wrap gap-2">
              <Button kind="secondary" onClick={playSample}>
                Play the sound
              </Button>
              <Button
                onClick={() => {
                  setStage("sides");
                  void nextSide(1);
                }}
              >
                It’s comfortable
              </Button>
            </div>
          </section>
        )}

        {stage === "sides" && (
          <section className="mt-8 space-y-5">
            <h1 className="text-display font-light tracking-[-0.02em]">Which ear?</h1>
            <p className="leading-relaxed">A beep plays in one ear. Which one did you hear it in? ({sideTrial?.n ?? 1} of 2)</p>
            {sideTrial?.wrong && (
              <p role="alert" className="rounded-2xl bg-right-ear/10 p-4 leading-relaxed">
                That was the other ear. Check the headphones are the right way round (L on the left) and that they are stereo, then play it again.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Button kind="secondary" className="min-h-16 text-[1.1rem]" onClick={() => answerSide("left")}>
                Left
              </Button>
              <Button kind="secondary" className="min-h-16 text-[1.1rem]" onClick={() => answerSide("right")}>
                Right
              </Button>
            </div>
            <Button kind="quiet" onClick={async () => sideTrial && (await getEngine()).play(1000, -30, sideTrial.ear)}>
              Play it again
            </Button>
          </section>
        )}

        {(stage === "helper-ready" || stage === "handover") && (
          <section className="mt-8 space-y-5">
            <h1 className="text-display font-light tracking-[-0.02em]">{stage === "helper-ready" ? `${helperName} first` : `Now ${name}`}</h1>
            {stage === "handover" && <p className="leading-relaxed">Thank you, {helperName}. Pass the headphones to {name}, and leave the volume where it is.</p>}
            <p className="leading-relaxed">
              You’ll hear short beeps, some very faint. Press the big button (or the space bar) whenever you hear one, even if you’re not sure. Some moments are silent on purpose.
            </p>
            <p className="leading-relaxed text-graphite">Right ear first, then left. About 6 minutes. You can pause at any time.</p>
            <Button onClick={() => startListener(stage === "helper-ready" ? "helper" : "person")}>Start</Button>
          </section>
        )}

        {testing && (
          <section className="mt-6 flex flex-1 flex-col">
            <p className="text-[1.05rem]">
              <strong>{listener}</strong>
              {progress && (
                <span className="text-graphite">
                  {" "}
                  · {progress.ear === "right" ? "Right" : "Left"} ear · {progress.index + 1} of {progress.total}
                </span>
              )}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/10" aria-hidden>
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${progress?.ear === "left" ? "bg-left-ear" : "bg-right-ear"}`}
                style={{ width: `${progress ? ((progress.ear === "left" ? progress.total : 0) + progress.index) / (2 * progress.total) * 100 : 0}%` }}
              />
            </div>
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                press();
              }}
              aria-label="I hear it"
              className={`mt-8 grid min-h-[45dvh] flex-1 place-items-center rounded-[2rem] text-[1.6rem] font-bold transition-[transform,background-color] duration-100 ${
                flash ? "scale-[0.985] bg-ink text-paper" : "bg-ink/[0.07] text-ink"
              }`}
            >
              {paused ? "Paused" : "I hear it"}
            </button>
            <div className="mt-4 flex justify-between gap-2">
              <Button
                kind="secondary"
                onClick={() => {
                  pausedRef.current = !pausedRef.current;
                  setPaused(pausedRef.current);
                }}
              >
                {paused ? "Resume" : "Pause"}
              </Button>
              <p className="self-center text-sm text-graphite">Press for every beep, even faint ones.</p>
            </div>
          </section>
        )}

        {stage === "result" && result && (
          <section className="mt-8 space-y-5">
            <h1 className="text-display font-light tracking-[-0.02em]">{name}’s estimated audiogram</h1>
            <AudiogramChart audiogram={result.audiogram} className="w-full" title={`${name}'s estimated audiogram from the in-app test`} />
            <p className="leading-relaxed text-ink/85">
              Worked out from the difference between {name} and {helperName} on the same headphones, allowing for {helperName}’s age. Read it as about ±10 dB.
            </p>
            {result.notes.length > 0 && (
              <ul className="space-y-2 rounded-2xl bg-ink/[0.05] p-4 leading-relaxed">
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onDone(result!.audiogram)}>Use this audiogram</Button>
              <Button kind="secondary" onClick={() => setStage("handover")}>
                Test {name} again
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
