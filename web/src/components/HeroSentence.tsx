"use client";

import { useState } from "react";
import data from "@/content/hero-audibility.json";

/**
 * The sentence as it reaches Meera (example profile): each letter's opacity is the
 * audibility of its sound for her better ear, from the same model the Hear screen uses.
 */
export function HeroSentence() {
  const [full, setFull] = useState(false);
  return (
    <figure>
      <p className="text-[2.35rem] leading-[1.18] font-light tracking-[-0.015em] sm:text-[3.1rem]">
        <span className="sr-only">Could you pass the salt, please? It is six fifteen.</span>
        {data.map((w, wi) => (
          <span key={wi} aria-hidden>
            {w.word.split("").map((ch, ci) => {
              const a = w.letters[ci] ?? 1;
              return (
                <span
                  key={ci}
                  style={{
                    opacity: full ? 1 : 0.1 + 0.9 * a,
                    transition: `opacity 700ms var(--ease-spring) ${full ? (wi * 40 + ci * 15) : 0}ms`,
                  }}
                >
                  {ch}
                </span>
              );
            })}{" "}
          </span>
        ))}
      </p>
      <figcaption className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.98rem] text-graphite">
        <span className="max-w-[46ch]">
          {full
            ? "That is the whole sentence. The sounds that were faded are the quiet, high-pitched ones: s, f, th, t."
            : "How this sentence reaches Meera. Faded letters are sounds too quiet or too high-pitched for her to catch."}
        </span>
        <button
          onClick={() => setFull((f) => !f)}
          aria-pressed={full}
          className="min-h-11 rounded-full bg-ink/[0.06] px-4 text-ink hover:bg-ink/[0.1]"
        >
          {full ? "Show it as she hears it" : "Show every sound"}
        </button>
      </figcaption>
    </figure>
  );
}
