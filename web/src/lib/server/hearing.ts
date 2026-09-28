import "server-only";

/** Python hearing service (MSBG + proxy listener). */
export const HEARING_URL = (process.env.HEARING_URL ?? "http://localhost:8765").replace(/\/$/, "");
/** Python TTS service (Kokoro), used to speak candidate rewordings in one consistent voice. */
export const TTS_URL = (process.env.TTS_URL ?? "http://localhost:8766").replace(/\/$/, "");

type Init = RequestInit & { timeoutMs?: number };

function withAuth(init: Init, token: string | undefined): RequestInit {
  const { timeoutMs = 60_000, headers, ...rest } = init;
  const h = new Headers(headers);
  if (token) h.set("authorization", `Bearer ${token}`);
  return { ...rest, headers: h, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" };
}

export function hearingFetch(path: string, init: Init = {}): Promise<Response> {
  return fetch(`${HEARING_URL}${path}`, withAuth(init, process.env.HEARING_TOKEN));
}

export function ttsFetch(path: string, init: Init = {}): Promise<Response> {
  return fetch(`${TTS_URL}${path}`, withAuth(init, process.env.TTS_TOKEN));
}
