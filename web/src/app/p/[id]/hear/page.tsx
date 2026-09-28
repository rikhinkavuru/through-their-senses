"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TabBar, usePersonCtx } from "@/components/PersonShell";
import { Button, HelpSheet, QuoteBlock, Segmented, Toggle } from "@/components/ui";
import { quoteFor } from "@/content/quotes";
import { betterEar, describeHearing } from "@/lib/audiogram";
import { playBase64Wav, startRecording, toWav16k, type Recorder } from "@/lib/audio";
import { friendly, hardSounds, missedWords, type HearResult, type HeardWord, type RewordResult } from "@/lib/hear";
import { cap } from "@/lib/pronouns";

const SAMPLES = [
  { id: "pickup", text: "I'll pick you up at fifteen past six on Thursday." },
  { id: "pills", text: "Your pills are on the shelf next to the sink." },
  { id: "soup", text: "Do you want soup or salad with your fish?" },
  { id: "doctor", text: "The doctor's office moved your appointment to Friday." },
];

/** Busy-table babble: speech about 7 dB louder than the talk around it. */
const DINNER_SNR = 7;
const MAX_SECONDS = 12;

type Phase = { kind: "idle" } | { kind: "recording"; started: number } | { kind: "listening"; label: string } | { kind: "done"; result: HearResult } | { kind: "error"; message: string };

function FadedWord({ w, selected, onSelect }: { w: HeardWord; selected: boolean; onSelect: () => void }) {
  const letters = w.said.split("");
  const miss = w.status !== undefined && w.status !== "heard";
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${w.said}${miss ? ", likely missed" : ""}. Show its sounds.`}
      className={`rounded-md px-0.5 underline-offset-[0.28em] ${miss ? "underline decoration-dotted decoration-2 decoration-ink/40" : ""} ${selected ? "bg-ink/[0.08]" : ""}`}
    >
      {letters.map((ch, i) => (
        <span key={i} style={{ opacity: 0.12 + 0.88 * (w.audibility.letters[i] ?? 1), transition: "opacity 900ms var(--ease-spring)" }}>
          {ch}
        </span>
      ))}
    </button>
  );
}

export default function Hear() {
  const { person, p, base, update } = usePersonCtx();
  const [scene, setScene] = useState<"quiet" | "dinner">("quiet");
  const [aided, setAided] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [lastInput, setLastInput] = useState<{ blob: Blob; label: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState<"you" | "her" | null>(null);
  const [reword, setReword] = useState<{ state: "idle" | "loading" | "done" | "error"; data?: RewordResult; message?: string }>({ state: "idle" });
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<Recorder | null>(null);
  const stopPlay = useRef<(() => void) | null>(null);

  const snr = scene === "dinner" ? DINNER_SNR : null;

  async function analyse(blob: Blob, label: string) {
    setLastInput({ blob, label });
    setPhase({ kind: "listening", label });
    setSelected(null);
    setReword({ state: "idle" });
    try {
      const fd = new FormData();
      fd.append("audio", blob, "speech.wav");
      fd.append("left", JSON.stringify(person.audiogram.left));
      fd.append("right", JSON.stringify(person.audiogram.right));
      fd.append("snr", snr === null ? "" : String(snr));
      fd.append("aided", String(aided));
      const res = await fetch("/api/hear", { method: "POST", body: fd });
      if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("ndjson")) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong.");
      }
      // Stages arrive one per line: said, her, typical (in noise), done.
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const acc: { r: HearResult | null } = { r: null };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "said") {
            acc.r = { said: ev.said, words: ev.words, betterEar: ev.betterEar, audio: { you: ev.audio.you }, pending: { her: true, typical: snr !== null } };
          } else if (ev.type === "her" && acc.r) {
            acc.r = { ...acc.r, words: ev.words, herText: ev.herText, heardTokens: ev.heardTokens, herCorrect: ev.herCorrect, total: ev.total, audio: { ...acc.r.audio, her: ev.audio.her }, pending: { ...acc.r.pending, her: false } };
          } else if (ev.type === "typical" && acc.r) {
            acc.r = { ...acc.r, typicalCorrect: ev.typicalCorrect, pending: { ...acc.r.pending, typical: false } };
          } else if (ev.type === "done" && acc.r) {
            acc.r = { ...acc.r, pending: { her: false, typical: false } };
          }
          if (acc.r) setPhase({ kind: "done", result: acc.r });
        }
      }
      if (!acc.r) throw new Error("The hearing model didn’t return a result. Try again.");
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  // Re-run the same sentence when the setting changes, so the comparison is direct.
  const settingKey = `${scene}-${aided}`;
  const prevSetting = useRef(settingKey);
  useEffect(() => {
    if (prevSetting.current !== settingKey && lastInput && phase.kind === "done") analyse(lastInput.blob, lastInput.label);
    prevSetting.current = settingKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingKey]);

  // Level meter and auto-stop while recording.
  useEffect(() => {
    if (phase.kind !== "recording") return;
    let raf = 0;
    const tick = () => {
      setLevel(recRef.current?.level() ?? 0);
      const s = (performance.now() - phase.started) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) stopRecording();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    // Wake the hearing model now so the first recording doesn't wait for a cold start.
    fetch("/api/warm", { method: "POST" }).catch(() => {});
    return () => {
      recRef.current?.cancel();
      stopPlay.current?.();
    };
  }, []);

  async function beginRecording() {
    stopPlay.current?.();
    try {
      recRef.current = await startRecording();
      setPhase({ kind: "recording", started: performance.now() });
    } catch {
      setPhase({ kind: "error", message: "The microphone is blocked or missing. Allow it in your browser settings, or try one of the sample sentences." });
    }
  }

  async function stopRecording() {
    const r = recRef.current;
    recRef.current = null;
    if (!r) return;
    const raw = await r.stop();
    if ((performance.now() - (phase.kind === "recording" ? phase.started : 0)) / 1000 < 0.7) {
      setPhase({ kind: "error", message: "That was very short. Hold the button and say one full sentence." });
      return;
    }
    try {
      analyse(await toWav16k(raw), "your voice");
    } catch {
      setPhase({ kind: "error", message: "This browser couldn’t read the recording. Try one of the sample sentences." });
    }
  }

  async function trySample(id: string) {
    const blob = await fetch(`/voices/${id}.wav`).then((r) => r.blob());
    analyse(blob, "a sample voice (synthetic)");
  }

  function play(which: "you" | "her", b64: string) {
    stopPlay.current?.();
    if (playing === which) {
      setPlaying(null);
      return;
    }
    setPlaying(which);
    stopPlay.current = playBase64Wav(b64, () => setPlaying((cur) => (cur === which ? null : cur)));
  }

  async function askReword(r: HearResult) {
    setReword({ state: "loading" });
    try {
      const res = await fetch("/api/reword", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sentence: r.said, missed: missedWords(r), hardSounds: hardSounds(r), left: person.audiogram.left, right: person.audiogram.right, snr, aided }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setReword({ state: "done", data: body });
    } catch (e) {
      setReword({ state: "error", message: e instanceof Error ? e.message : "Couldn’t get suggestions." });
    }
  }

  const result = phase.kind === "done" ? phase.result : null;
  const sel = result && selected !== null ? result.words[selected] : null;

  return (
    <>
      <main className="mx-auto max-w-2xl px-5 pb-36 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <Link href={base} className="min-h-11 content-center text-[0.98rem] text-graphite hover:text-ink">
            {person.name}
          </Link>
          <HelpSheet title="How this works">
            <p>
              Say a sentence the way you normally would. We play it through a model of {person.name}’s hearing, built from {p.poss} audiogram: the Cambridge hearing loss simulator (MSBG), which models
              quieter high pitches, loudness growing unevenly, and blurred pitch detail.
            </p>
            <p>
              Then a speech recogniser listens to that simulated sound with a normal listener’s threshold, and we show what it made out. It stands in for {p.obj}; we tested how well this matches real
              listeners with hearing loss on a public dataset (see How it works).
            </p>
            <p>Faded letters are the sounds that fall below {p.poss} hearing. Tap any word to see its sounds.</p>
            <p>The recording is processed and then discarded. It is not stored.</p>
          </HelpSheet>
        </header>

        <h1 className="mt-8 text-display font-light tracking-[-0.02em]">Hear it as {person.name} does</h1>
        <p className="mt-3 max-w-[56ch] leading-relaxed text-ink/80">{describeHearing(person.audiogram, p)}</p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Segmented
            label="Where you are talking"
            value={scene}
            onChange={setScene}
            options={[
              { value: "quiet", label: "Quiet room" },
              { value: "dinner", label: "Dinner table" },
            ]}
          />
          <Toggle on={aided} onChange={setAided}>
            Hearing aids
          </Toggle>
        </div>

        {/* Record */}
        <section className="mt-10 flex flex-col items-center text-center" aria-live="polite">
          <button
            onClick={phase.kind === "recording" ? stopRecording : beginRecording}
            disabled={phase.kind === "listening"}
            aria-label={phase.kind === "recording" ? "Stop recording" : "Start recording"}
            className="relative grid h-28 w-28 place-items-center rounded-full bg-ink text-paper transition-transform active:scale-95 disabled:opacity-40"
          >
            {phase.kind === "recording" && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-full border-4 border-right-ear transition-transform duration-75"
                style={{ transform: `scale(${1 + level * 0.35})`, opacity: 0.35 + level * 0.65 }}
              />
            )}
            {phase.kind === "recording" ? (
              <span aria-hidden className="h-8 w-8 rounded-md bg-right-ear" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-10 w-10" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <p className="mt-4 min-h-6 text-graphite tabular">
            {phase.kind === "recording"
              ? `Listening… ${elapsed.toFixed(0)}s. Tap to stop.`
              : phase.kind === "listening"
                ? `Playing ${phase.label} through ${person.name}’s hearing…`
                : "Tap and say one sentence, as you normally would."}
          </p>
          <div className="mt-5 w-full">
            <p className="text-sm text-graphite">No microphone? Try a sample voice:</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => trySample(s.id)}
                  disabled={phase.kind === "recording" || phase.kind === "listening"}
                  className="min-h-11 rounded-full bg-ink/[0.06] px-4 text-left text-[0.95rem] hover:bg-ink/[0.1] disabled:opacity-40"
                >
                  “{s.text}”
                </button>
              ))}
            </div>
          </div>
        </section>

        {phase.kind === "error" && (
          <p role="alert" className="mt-8 rounded-2xl bg-right-ear/10 px-5 py-4 leading-relaxed">
            {phase.message}
          </p>
        )}

        {phase.kind === "listening" && (
          <div className="mt-12 space-y-3" aria-hidden>
            <div className="h-9 w-4/5 animate-pulse rounded-lg bg-ink/[0.06]" />
            <div className="h-9 w-3/5 animate-pulse rounded-lg bg-ink/[0.06]" />
          </div>
        )}

        {result && (
          <section className="mt-12" aria-label="Result">
            <p className="text-sm text-graphite">What was said</p>
            <p className="mt-1 text-[2rem] font-light leading-[1.25] tracking-[-0.01em]">
              {result.words.map((w, i) => (
                <span key={i}>
                  <FadedWord w={w} selected={selected === i} onSelect={() => setSelected(selected === i ? null : i)} />{" "}
                </span>
              ))}
            </p>
            {sel && (
              <div className="mt-3 rounded-2xl bg-ink/[0.05] px-4 py-3">
                <p className="font-bold">{sel.said}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {sel.audibility.phonemes.map((ph, k) => (
                    <li key={k} className="rounded-full border border-ink/15 px-3 py-1 text-[0.95rem]" style={{ opacity: 0.35 + 0.65 * ph.a }}>
                      <span className="font-bold">{friendly(ph.p)}</span>{" "}
                      <span className="text-graphite">{ph.a >= 0.66 ? "clear" : ph.a >= 0.33 ? "faint" : "lost"}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-graphite">Sounds are placed by their usual pitch and loudness in conversation; a simplified explanation of the full model.</p>
              </div>
            )}

            <p className="mt-8 text-sm text-graphite">What {person.name} likely hears</p>
            {result.pending.her ? (
              <p className="mt-2 animate-pulse text-[1.1rem] text-graphite">Listening through {person.name}’s hearing…</p>
            ) : (
            <p className="mt-1 text-[2rem] font-light leading-[1.25] tracking-[-0.01em]">
              {(result.heardTokens ?? []).map((t, i) => (
                <span key={i}>
                  {t.s === "ok" ? (
                    <span>{t.w}</span>
                  ) : t.s === "wrong" ? (
                    <span className="italic text-right-ear" title={t.said ? `said: ${t.said}` : "added"}>
                      {t.w}
                    </span>
                  ) : (
                    <span className="text-graphite" aria-label="unclear">
                      …
                    </span>
                  )}{" "}
                </span>
              ))}
            </p>

            )}

            {!result.pending.her && (
              <p className="mt-6 text-[1.1rem] leading-relaxed">
                {cap(p.subj)} caught <strong className="tabular">{result.herCorrect}</strong> of <span className="tabular">{result.total}</span> words
                {typeof result.typicalCorrect === "number" ? (
                  <>
                    . Someone with typical hearing at the same table: <strong className="tabular">{result.typicalCorrect}</strong> of {result.total}.
                  </>
                ) : result.pending.typical ? (
                  <span className="text-graphite">. Checking typical hearing at the same table…</span>
                ) : (
                  "."
                )}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Button kind="secondary" onClick={() => play("you", result.audio.you)} aria-pressed={playing === "you"}>
                {playing === "you" ? "Stop" : "Play as you hear it"}
              </Button>
              <Button kind="secondary" onClick={() => result.audio.her && play("her", result.audio.her)} disabled={!result.audio.her} aria-pressed={playing === "her"}>
                {playing === "her" ? "Stop" : `Play as ${p.subj} hear${p.s} it`}
              </Button>
            </div>
            <p className="mt-2 text-sm text-graphite">Use headphones: the left and right ears are simulated separately. Both play at the same volume, so the quietness is real.</p>

            <div className="mt-10 border-t border-chart pt-8">
              {reword.state === "idle" && (
                <Button onClick={() => askReword(result)} disabled={result.pending.her}>
                  Help me say it more clearly
                </Button>
              )}
              {reword.state === "loading" && <p className="text-graphite">Writing a few versions and checking each one against {person.name}’s hearing…</p>}
              {reword.state === "error" && <p className="text-graphite">{reword.message}</p>}
              {reword.state === "done" && reword.data && (
                <div>
                  <h2 className="text-title font-light">Say it this way</h2>
                  {reword.data.suggestions.length === 0 ? (
                    <p className="mt-3 leading-relaxed">
                      Your sentence already comes through as well as any rewording we checked ({reword.data.checked} tried). In a noisy room, facing {p.obj} matters more than wording.
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-4">
                      {reword.data.suggestions.map((s) => (
                        <li key={s.text} className="rounded-2xl border border-chart p-4">
                          <p className="text-[1.25rem] leading-snug">“{s.text}”</p>
                          <p className="mt-2 text-graphite">{s.why}</p>
                          <button
                            onClick={() => {
                              const cur = person.phrases ?? [];
                              update({ phrases: cur.includes(s.text) ? cur.filter((x) => x !== s.text) : [...cur, s.text] });
                            }}
                            aria-pressed={(person.phrases ?? []).includes(s.text)}
                            className="float-right ml-3 min-h-11 rounded-full border border-ink/20 px-3 text-[0.9rem] aria-pressed:bg-ink aria-pressed:text-paper"
                          >
                            {(person.phrases ?? []).includes(s.text) ? "In the guide" : "Save to guide"}
                          </button>
                          <p className="mt-2 text-[0.95rem]">
                            <span className="font-bold text-works">
                              {s.correct} of {s.total} words
                            </span>{" "}
                            <span className="text-graphite">
                              caught, against {reword.data!.original.correct} of {reword.data!.original.total} for the original
                            </span>
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-sm text-graphite">Each version, and the original, is spoken by the same synthetic voice and run through {person.name}’s hearing model, so the comparison is fair.</p>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="mt-14 border-t border-chart pt-8" aria-labelledby="tips">
          <h2 id="tips" className="text-title font-light">
            What helps most
          </h2>
          <ul className="mt-4 space-y-3 leading-relaxed">
            <li>Get {p.poss} attention first, then face {p.obj} with light on your face, within about 3 metres. Lipreading drops off quickly past that and when you turn away.</li>
            <li>Slow down a little and speak clearly. Shouting makes speech louder but more distorted.</li>
            <li>If a word doesn’t land twice, say it a different way instead of repeating it.</li>
            <li>At the table, sit on {p.poss} {betterEar(person.audiogram)} side, the better-hearing ear, and turn down music or the TV.</li>
          </ul>
          <QuoteBlock className="mt-6" quote={quoteFor("hearing")} />
        </section>
      </main>
      <TabBar base={base} />
    </>
  );
}
