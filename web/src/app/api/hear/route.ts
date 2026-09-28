import { hearingFetch } from "@/lib/server/hearing";

export const maxDuration = 60;

/** Forward one recorded sentence (16 kHz WAV) and the audiogram to the hearing service. */
export async function POST(request: Request) {
  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "No recording was attached." }, { status: 400 });
  }
  if (audio.size > 4_000_000) {
    return Response.json({ error: "That recording is too long. Keep it to one sentence." }, { status: 413 });
  }
  try {
    const res = await hearingFetch("/hear", { method: "POST", body: form, timeoutMs: 120_000 });
    if (res.ok && res.body) {
      // Stages stream as newline-delimited JSON; pass them straight through.
      return new Response(res.body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
    }
    const body = await res.json();
    if (!res.ok) {
      const detail = typeof body?.detail === "string" ? body.detail : "The hearing model could not process that recording.";
      const friendly =
        detail === "recording is silent" || detail === "no speech detected"
          ? "No speech came through. Hold the phone closer and say one full sentence."
          : detail;
      return Response.json({ error: friendly }, { status: res.status });
    }
    return Response.json(body);
  } catch {
    return Response.json({ error: "The hearing model is not reachable right now. Try again in a moment." }, { status: 503 });
  }
}
