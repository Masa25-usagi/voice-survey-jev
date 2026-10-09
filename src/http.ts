import type { Context, Question, SpeakingPreferences, ProfileConfig } from "./types.js";
import type { Mapper, Analyst } from "./interview.js";
import type { CameraObservation } from "./dialogue.js";

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export async function postJson<T>(url: string, body: unknown, signal: AbortSignal, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<T> {
  const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body), signal });
  if (!response.ok) throw new Error("Survey service unavailable");
  return response.json() as Promise<T>;
}
export function createHttpAnalysis(base = "/api/voice-survey", fetcher?: Fetcher): { mapper: Mapper; analyst: Analyst } {
  return {
    mapper: ({ question, turns, signal }) => postJson(`${base}/answer`, { questionId: question.id, turns }, signal, fetcher),
    analyst: ({ turns, camera, signal }) => postJson(`${base}/context`, { turns, camera }, signal, fetcher)
  };
}
export type SessionRequest = { context: Context; question: Question; preferences: SpeakingPreferences; profile?: ProfileConfig; modelKey: string; sdp?: string; signal: AbortSignal };
export type SessionResponse = { provider: "openai"; sdp: string } | { provider: "gemini"; token: string; model: string };
export type SessionStarter = (request: SessionRequest) => Promise<SessionResponse>;
export function createSessionStarter(base = "/api/voice-survey", fetcher?: Fetcher): SessionStarter {
  return ({ context, preferences, profile, modelKey, sdp, signal }) => postJson(`${base}/session`, { context, preferences, profileIntro: !!profile, modelKey, sdp }, signal, fetcher);
}
export function createCameraObserver(base = "/api/voice-survey", fetcher?: Fetcher): (jpeg: string, signal: AbortSignal) => Promise<CameraObservation> {
  return (jpeg, signal) => postJson(`${base}/camera`, { jpeg }, signal, fetcher);
}
