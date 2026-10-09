import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveConnectConfig } from "@google/genai";
import { defineSurvey } from "../survey.js";
import type { ProfileConfig, Survey } from "../types.js";
import { isRecord } from "../types.js";
import { answerRequest, mapAnswer, normalizedTurns } from "../jev.js";
import { dialogueRequest, mapDialogue, OBSERVATION_ENUMS, safeObservation } from "../dialogue.js";
import type { Fetcher } from "../http.js";
import { JevClient } from "./jev-client.js";
import { interviewInstructions, speakingPreferences, sourceTool, profileTool } from "./instructions.js";

export interface VoiceModel { provider: "gemini" | "openai"; model: string; label: string }
export interface ServerOptions {
  survey: Survey;
  allowedOrigins: string[];
  authorize: (request: Request) => boolean | Promise<boolean>;
  consumeBudget?: (request: Request) => boolean | Promise<boolean>;
  typesafeApiKey?: string;
  jevModel?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  openaiTranscriptionModel?: string;
  visionModel?: string;
  models?: Record<string, VoiceModel>;
  profile?: ProfileConfig;
  basePath?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  // Injection points for licensed SDK calls and deterministic contract testing.
  mintGemini?: (config: LiveConnectConfig, model: string, signal: AbortSignal) => Promise<string>;
  observeImage?: (jpeg: string, signal: AbortSignal) => Promise<unknown>;
}
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
class InvalidInput extends Error {}
async function readJson(request: Request, limit: number, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new InvalidInput();
  const length = Number(request.headers.get("content-length") ?? 0); if (length > limit) throw new InvalidInput();
  if (!request.body) throw new InvalidInput();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > limit) { await reader.cancel(); throw new InvalidInput(); } chunks.push(value); }
    const merged = new Uint8Array(total); let cursor = 0; for (const chunk of chunks) { merged.set(chunk, cursor); cursor += chunk.length; }
    if (signal.aborted) throw new Error("Cancelled");
    const parsed: unknown = JSON.parse(new TextDecoder().decode(merged)); if (!isRecord(parsed)) throw new InvalidInput(); return parsed;
  } catch { if (signal.aborted) throw new Error("Cancelled"); throw new InvalidInput(); } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
export function createSurveyHandler(options: ServerOptions): (request: Request) => Promise<Response> {
  const survey = defineSurvey(options.survey), model = options.jevModel ?? "jev-1.13.0";
  if (typeof options.authorize !== "function" || !options.allowedOrigins.length) throw new Error("Explicit authorization and origins are required");
  const client = new JevClient(options.typesafeApiKey ?? "", options.fetcher);
  const fetcher: Fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
  const base = options.basePath ?? "/api/voice-survey";
  const google = () => new GoogleGenAI({ apiKey: options.geminiApiKey!, httpOptions: { apiVersion: "v1beta", timeout: options.timeoutMs ?? 15000 } });
  return async request => {
    const path = new URL(request.url).pathname;
    if (![`${base}/answer`, `${base}/context`, `${base}/session`, `${base}/camera`].includes(path)) return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!options.allowedOrigins.includes(request.headers.get("origin") ?? "")) return json({ error: "forbidden" }, 403);
    try {
      if (!await options.authorize(request)) return json({ error: "forbidden" }, 403);
      if (options.consumeBudget && !await options.consumeBudget(request)) return json({ error: "request_limit" }, 429);
    } catch { return json({ error: "forbidden" }, 403); }
    const ac = new AbortController();
    const abort = () => ac.abort(); request.signal.addEventListener("abort", abort, { once: true }); if (request.signal.aborted) ac.abort();
    const timer = setTimeout(abort, options.timeoutMs ?? 15000);
    try {
      const input = await readJson(request, path.endsWith("/camera") ? 512000 : 64000, ac.signal);
      if (ac.signal.aborted) throw new Error("Cancelled");
      if (path.endsWith("/answer")) {
        const question = survey.questions.find(q => q.id === input.questionId); if (!question) throw new InvalidInput();
        let turns; try { turns = normalizedTurns(input.turns); } catch { throw new InvalidInput(); }
        if (!turns.some(t => t.role === "user")) return json({ disposition: "no_answer", model, usage: { inputTokens: 0, outputTokens: 0 } });
        const result = await client.evaluate(answerRequest(question, turns, model), ac.signal);
        return json(mapAnswer(question, turns, result));
      }
      if (path.endsWith("/context")) {
        let turns; try { turns = normalizedTurns(input.turns); } catch { throw new InvalidInput(); }
        if (!turns.some(t => t.role === "user")) throw new InvalidInput();
        const camera = safeObservation(input.camera);
        const started = Date.now();
        const result = await client.evaluate(dialogueRequest(turns, camera, model), ac.signal);
        return json({ ...mapDialogue(turns, camera, result), latencyMs: Date.now() - started });
      }
      if (path.endsWith("/session")) {
        if (typeof input.modelKey !== "string" || !Object.hasOwn(options.models ?? {}, input.modelKey)) throw new InvalidInput();
        const choice = options.models![input.modelKey]!;
        if (!isRecord(input.context) || input.context.surveyId !== survey.id || typeof input.context.questionId !== "string" || !Number.isSafeInteger(input.context.connection) || !Number.isSafeInteger(input.context.revision) || Number(input.context.connection) < 0 || Number(input.context.revision) < 0) throw new InvalidInput();
        const context = input.context;
        const question = survey.questions.find(q => q.id === context.questionId); if (!question) throw new InvalidInput();
        let preferences; try { preferences = speakingPreferences(input.preferences); } catch { throw new InvalidInput(); }
        const profile = input.profileIntro === true ? options.profile : undefined;
        const instructions = interviewInstructions(survey, question, preferences, profile);
        const tools = [sourceTool, ...(profile ? [profileTool] : [])];
        if (choice.provider === "openai") {
          if (!options.openaiApiKey || !options.openaiTranscriptionModel) return json({ error: "not_configured" }, 503);
          if (typeof input.sdp !== "string" || !input.sdp.startsWith("v=0") || input.sdp.length > 40000) throw new InvalidInput();
          const form = new FormData(); form.set("sdp", input.sdp);
          form.set("session", JSON.stringify({ type: "realtime", model: choice.model, instructions, tools: tools.map(t => ({ type: "function", ...t })), audio: { input: { transcription: { model: options.openaiTranscriptionModel }, turn_detection: { type: "server_vad" } }, output: { voice: "marin" } } }));
          const response = await fetcher("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: `Bearer ${options.openaiApiKey}` }, body: form, signal: ac.signal });
          if (!response.ok) { await response.body?.cancel(); throw new Error("Voice service unavailable"); }
          const sdp = await response.text(); if (!sdp.startsWith("v=0") || sdp.length > 50000) throw new Error("Invalid session response");
          return json({ provider: "openai", sdp });
        }
        if (!options.geminiApiKey && !options.mintGemini) return json({ error: "not_configured" }, 503);
        const config: LiveConnectConfig = { responseModalities: [Modality.AUDIO], systemInstruction: instructions, inputAudioTranscription: {}, outputAudioTranscription: {}, tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] };
        let token: string | undefined;
        if (options.mintGemini) token = await options.mintGemini(config, choice.model, ac.signal);
        else {
          const result = await google().authTokens.create({ config: { uses: 1, expireTime: new Date(Date.now() + 15 * 60000).toISOString(), newSessionExpireTime: new Date(Date.now() + 60000).toISOString(), liveConnectConstraints: { model: choice.model, config }, abortSignal: ac.signal } });
          token = result.name;
        }
        if (!token || !token.startsWith("auth_tokens/") || ac.signal.aborted) throw new Error("Invalid session response");
        return json({ provider: "gemini", token, model: choice.model });
      }
      if (!options.visionModel || (!options.geminiApiKey && !options.observeImage)) return json({ error: "not_configured" }, 503);
      if (typeof input.jpeg !== "string" || input.jpeg.length > 450000 || input.jpeg.length < 16 || !/^\/9j\/[a-zA-Z0-9+/]*={0,2}$/.test(input.jpeg)) throw new InvalidInput();
      let observation: unknown;
      if (options.observeImage) observation = await options.observeImage(input.jpeg, ac.signal);
      else {
        const response = await google().models.generateContent({ model: options.visionModel, contents: [{ role: "user", parts: [
          { text: "Describe only the visible capture conditions, whether printed material is present, and a directly observable static facial shape. Return the specified enums. Never identify a person, read private text, estimate age/gender, diagnose pain/emotion/personality or infer survey opinions. Use unknown when uncertain; a dim or blurred image requires face unknown. A still image cannot establish movement." },
          { inlineData: { mimeType: "image/jpeg", data: input.jpeg } }
        ] }], config: { abortSignal: ac.signal, responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: Object.fromEntries(Object.entries(OBSERVATION_ENUMS).map(([key, values]) => [key, { type: "string", enum: values }])), required: Object.keys(OBSERVATION_ENUMS), additionalProperties: false } } });
        if (!response.text || response.text.length > 8000) throw new Error("Invalid observation");
        observation = JSON.parse(response.text);
      }
      const safe = safeObservation({ ...(isRecord(observation) ? observation : {}), observedAt: Date.now() });
      if (!safe) throw new Error("Invalid observation"); return json(safe);
    } catch (error) {
      return json({ error: error instanceof InvalidInput ? "invalid_request" : ac.signal.aborted ? "request_timeout" : "service_unavailable" }, error instanceof InvalidInput ? 400 : ac.signal.aborted ? 504 : 502);
    } finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
  };
}
export { JevClient, interviewInstructions };
