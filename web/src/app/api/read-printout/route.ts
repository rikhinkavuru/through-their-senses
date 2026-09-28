import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import { placeRows } from "@/lib/printout";

export const maxDuration = 60;

/** Same model selection as the rewording route: Claude directly when a key is set, else AI Gateway. */
const model = () => {
  if (!process.env.ANTHROPIC_API_KEY) return "anthropic/claude-sonnet-5";
  const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return createAnthropic({ headers: ws ? { "anthropic-workspace-id": ws } : undefined })("claude-sonnet-5");
};

const Body = z.object({
  /** JPEG data URL, already resized in the browser. */
  image: z.string().startsWith("data:image/").max(4_000_000),
});

const Reading = z.object({
  isHumphrey242: z.boolean().describe("True only if this is a Humphrey 24-2 (or 24-2C/SITA 24-2) single field analysis printout"),
  eye: z.enum(["right", "left", "unknown"]).describe("OD = right, OS = left, from the printout's header"),
  age: z.number().nullable().describe("Patient age in years if printed (or computed from date of birth and test date), else null"),
  totalDeviation: z
    .array(z.array(z.number().nullable()))
    .describe("The TOTAL DEVIATION plot as 8 rows (top first) of exactly 10 column slots each, aligned to the plot's columns; null where a slot is empty or unreadable"),
  unreadable: z.number().describe("How many Total Deviation values could not be read with confidence"),
  md: z.number().nullable().describe("Mean Deviation (MD) in dB as printed, else null"),
});

const PROMPT = `This is a photo of a visual field test printout. Read it carefully.

Find the TOTAL DEVIATION numeric plot (numbers in dB, mostly negative, in a cross-shaped grid). Do not confuse it with the PATTERN DEVIATION plot (usually beside or below it), the threshold (sensitivity) plot, or the probability symbol plots.

Copy it as 8 rows, top to bottom. The plot is 10 columns wide; give every row exactly 10 slots that line up with those columns, so each value goes in the slot for the column it sits in. The vertical axis line runs between slot 5 and slot 6. The layout is fixed: the top and bottom rows use slots 4 to 7, the second and seventh rows use slots 3 to 8, the third and sixth rows use slots 2 to 9. The two middle rows have 9 positions: for a right eye (OD) they use slots 1 to 9 with the blind spot blank at slot 8; for a left eye (OS) they use slots 2 to 10 with the blind spot blank at slot 3. Put null in every slot with no number, including the blind spot and anything you cannot read. Never guess a value. Negative signs matter: "-12" is -12.

Also report which eye (OD = right, OS = left), the patient's age, and the printed MD (mean deviation) if shown. If the image is not a Humphrey 24-2 single field analysis, set isHumphrey242 to false.`;

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send one photo of the printout." }, { status: 400 });
  try {
    const attempt = (ms: number) =>
      generateText({
        model: model(),
        output: Output.object({ schema: Reading }),
        // Copying numbers needs little reasoning; the default spends ~25 s thinking.
        providerOptions: { anthropic: { effort: "low" } },
        abortSignal: AbortSignal.timeout(ms),
        messages: [{ role: "user", content: [{ type: "file", data: parsed.data.image, mediaType: parsed.data.image.slice(5, parsed.data.image.indexOf(";")) || "image/jpeg" }, { type: "text", text: PROMPT }] }],
      });
    // Most reads take about 4 s but a few stall for 30 s or more; a fresh try is usually quick.
    const { output } = await attempt(25_000).catch(() => attempt(30_000));
    // Fit the rows to the known layout for that eye (see placeRows).
    const { rows, stray } = placeRows(output.eye === "left" ? "left" : "right", output.totalDeviation);
    // Cross-check: the average of the values read should be near the printed MD (MD is a
    // weighted average, so allow a few dB). A big gap usually means the wrong plot was read.
    const read = rows.flatMap((r) => r ?? []).filter((v): v is number => v !== null);
    const mean = read.length ? read.reduce((a, b) => a + b, 0) / read.length : null;
    const mdMismatch = output.md !== null && mean !== null && Math.abs(mean - output.md) > 3;
    return Response.json({
      isHumphrey242: output.isHumphrey242,
      md: output.md,
      mdMismatch,
      // Extra numbers in rows that couldn't be placed: probably part of another plot.
      stray,
      eye: output.eye,
      age: output.age,
      rows,
      badRows: rows.filter((r) => r === null).length,
      unreadable: output.unreadable,
    });
  } catch (e) {
    console.error("read-printout failed", e);
    return Response.json({ error: "The printout could not be read. Try a sharper photo in good light, or type the numbers." }, { status: 502 });
  }
}
