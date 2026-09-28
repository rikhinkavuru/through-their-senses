"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { QUOTE_SOURCE, type Quote } from "@/content/quotes";

type ButtonKind = "primary" | "secondary" | "quiet";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[1rem] font-medium transition-[background-color,color,transform] duration-150 ease-[var(--ease-spring)] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";
const kinds: Record<ButtonKind, string> = {
  primary: "bg-ink text-paper hover:bg-[#2c353a]",
  secondary: "border border-ink/25 text-ink hover:bg-ink/[0.05]",
  quiet: "text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink px-1",
};

export function Button({ kind = "primary", className = "", ...rest }: ComponentProps<"button"> & { kind?: ButtonKind }) {
  return <button {...rest} className={`${base} ${kinds[kind]} ${className}`} />;
}

export function ButtonLink({ kind = "primary", className = "", ...rest }: ComponentProps<typeof Link> & { kind?: ButtonKind }) {
  return <Link {...rest} className={`${base} ${kinds[kind]} ${className}`} />;
}

/** A row of mutually exclusive options. Large targets, clear selected state (fill + weight, not colour alone). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  dark = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  dark?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-full p-1 ${dark ? "bg-white/12 backdrop-blur-md" : "bg-ink/[0.06]"}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`min-h-11 rounded-full px-4 text-[0.95rem] transition-colors duration-150 ${
              on
                ? dark
                  ? "bg-white font-bold text-ink"
                  : "bg-ink font-bold text-paper"
                : dark
                  ? "text-white/85 hover:text-white"
                  : "text-ink/75 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, children, dark = false }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; dark?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`inline-flex min-h-11 items-center gap-2.5 rounded-full px-4 text-[0.95rem] transition-colors ${
        dark ? (on ? "bg-white text-ink font-bold" : "bg-white/12 text-white backdrop-blur-md") : on ? "bg-ink text-paper font-bold" : "bg-ink/[0.06] text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`relative h-4 w-7 rounded-full transition-colors ${on ? (dark ? "bg-ink" : "bg-paper") : dark ? "bg-white/40" : "bg-ink/25"}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full transition-transform duration-200 ease-[var(--ease-spring)] ${on ? "translate-x-3" : "translate-x-0"} ${
            on ? (dark ? "bg-white" : "bg-ink") : "bg-white"
          }`}
        />
      </span>
      {children}
    </button>
  );
}

export function QuoteBlock({ quote, className = "" }: { quote: Quote; className?: string }) {
  return (
    <figure className={`border-l-2 border-ink/20 pl-4 ${className}`}>
      <blockquote className="text-[1.05rem] leading-relaxed text-ink">“{quote.text}”</blockquote>
      <figcaption className="mt-2 text-sm text-graphite">
        Participant {quote.who},{" "}
        <a href={QUOTE_SOURCE.url} target="_blank" rel="noreferrer" className="underline decoration-ink/25 underline-offset-2 hover:decoration-ink">
          {QUOTE_SOURCE.cite}
        </a>
      </figcaption>
    </figure>
  );
}

/** "What am I looking at?" – a consistent help sheet on every screen (WCAG 3.2.6). */
export function HelpSheet({ title, children, dark = false }: { title: string; children: ReactNode; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[0.95rem] ${dark ? "bg-white/12 text-white backdrop-blur-md" : "bg-ink/[0.06] text-ink"}`}
      >
        <span aria-hidden className={`grid h-5 w-5 place-items-center rounded-full text-[0.8rem] font-bold ${dark ? "bg-white text-ink" : "bg-ink text-paper"}`}>
          ?
        </span>
        What am I looking at?
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        className="m-auto mb-0 w-full max-w-lg rounded-t-3xl bg-paper p-0 text-ink backdrop:bg-ink/40 sm:mb-auto sm:rounded-3xl"
      >
        <div className="max-h-[80dvh] overflow-y-auto px-6 pt-6 pb-8">
          <h2 className="text-title font-light">{title}</h2>
          <div className="mt-4 space-y-3 text-[1.02rem] leading-relaxed">{children}</div>
          <Button className="mt-6 w-full" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </dialog>
    </>
  );
}

export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-graphite">{children}</p>;
}
