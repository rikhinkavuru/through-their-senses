import { generateText, Output } from "ai";
import { z } from "zod";
import { hearingFetch, ttsFetch } from "@/lib/server/hearing";

export const maxDuration = 60;

const Body = z.object({
  sentence: z.string().min(1).max(300),
  missed: z.array(z.string()).max(40),
  hardSounds: z.array(z.string()).max(20),
  left: z.array(z.number()).length(7),
  right: z.array(z.number()).length(7),
  snr: z.number().nullable(),
  aided: z.boolean(),
});

const Candidates = z.object({
  rewordings: z
    .array(z.object({ text: z.string().describe("The reworded sentence, plain spoken English"), why: z.string().describe("One short reason, under 12 words") }))
    .min(2)
    .max(5),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400 });
  const b = parsed.data;

  let candidates: { text: string; why: string }[];
  try {
    const { output } = await generateText({
      model: "anthropic/claude-sonnet-5",
      output: Output.object({ schema: Candidates }),
      temperature: 0.7,
      system:
        "You help family members speak so an older relative with age-related hearing loss can understand them. " +
        "High-pitched, quiet consonants (s, f, th, t, k, sh, p) are hardest; vowels and low sounds (m, n, l, oo, ah) carry best. " +
        "Rewrite the sentence so it keeps exactly the same meaning and stays natural and warm, the way a person would actually say it. " +
        "Useful moves: add context that makes the key word predictable, replace hard-to-hear key words with clearer ones, say numbers and times in a way that can't be confused (fifteen vs fifty), and put the key information at the end. " +
        "Never add new facts, never sound clinical or condescending, and keep each version under 20 words.",
      prompt:
        `Sentence: "${b.sentence}"\n` +
        `Words the hearing model predicts they missed or misheard: ${b.missed.length ? b.missed.join(", ") : "none clearly, but some sounds were faint"}\n` +
        `Speech sounds that are hardest for them: ${b.hardSounds.join(", ") || "high-pitched consonants"}\n` +
        `Setting: ${b.snr === null ? "a quiet room" : "a noisy dinner table"}${b.aided ? ", wearing hearing aids" : ""}\n` +
        "Give 4 different rewordings.",
    });
    candidates = output.rewordings.filter((c) => c.text.trim() && c.text.trim().toLowerCase() !== b.sentence.trim().toLowerCase()).slice(0, 4);
  } catch {
    return Response.json({ error: "Suggestions need the AI model, which isn't reachable right now." }, { status: 503 });
  }

  try {
    // Speak the original and every candidate in the same synthetic voice, then run all of
    // them through this person's hearing model, so the comparison is fair.
    const sentences = [b.sentence, ...candidates.map((c) => c.text)];
    const tts = await ttsFetch("/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentences, voice: "af_heart" }),
      timeoutMs: 40_000,
    });
    if (!tts.ok) throw new Error(`tts ${tts.status}`);
    const { results: spoken } = (await tts.json()) as { results: { text: string; wav: string }[] };
    const res = await hearingFetch("/score_audio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: spoken, left: b.left, right: b.right, snr: b.snr, aided: b.aided }),
      timeoutMs: 55_000,
    });
    if (!res.ok) throw new Error(`score ${res.status}`);
    const { results } = (await res.json()) as { results: { text: string; score: number; correct: number; total: number; herText: string }[] };
    const [original, ...scored] = results;
    const ranked = scored
      .map((r, i) => ({ ...r, why: candidates[i]?.why ?? "" }))
      .filter((r) => r.score > original.score)
      .sort((a, z) => z.score - a.score);
    return Response.json({ original, suggestions: ranked, checked: scored.length });
  } catch {
    return Response.json({ error: "The hearing model couldn't check the suggestions right now." }, { status: 503 });
  }
}
