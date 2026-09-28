import "server-only";

/** Base URL of the Python hearing service (MSBG + proxy listener). */
export const HEARING_URL = (process.env.HEARING_URL ?? "http://localhost:8765").replace(/\/$/, "");

export async function hearingFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 60_000, ...rest } = init;
  return fetch(`${HEARING_URL}${path}`, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
}
