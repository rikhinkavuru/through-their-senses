import { hearingFetch, ttsFetch } from "@/lib/server/hearing";

export const maxDuration = 60;

/** Wake the hearing and speech services before the first recording. Fire and forget from the client. */
export async function POST() {
  const results = await Promise.allSettled([hearingFetch("/warm", { timeoutMs: 55_000 }), ttsFetch("/warm", { timeoutMs: 50_000 })]);
  return Response.json({ hearing: results[0].status === "fulfilled" && results[0].value.ok, tts: results[1].status === "fulfilled" && results[1].value.ok });
}
