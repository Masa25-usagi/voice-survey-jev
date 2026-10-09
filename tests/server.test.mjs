import test from "node:test";
import assert from "node:assert/strict";
import { createSurveyHandler } from "../dist/server/index.js";
import { speakingProfile } from "../dist/index.js";
import { survey, turns, context, decision } from "./fixtures.mjs";
const origin = "https://example.org";
const request = (route, body = { questionId: "schedule", turns }, headers = {}, signal) => new Request(`${origin}/api/voice-survey/${route}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal });
const setup = (extra = {}) => {
  const calls = [];
  const fetcher = async (url, init) => { const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body; calls.push({ url: String(url), init, body }); return Response.json(decision(body, { answer: "weekend", explanation: "example" })); };
  return { calls, handler: createSurveyHandler({ survey, allowedOrigins: [origin], authorize: () => true, typesafeApiKey: "test-only", fetcher, ...extra }) };
};
test("server requires explicit authorization and origin configuration", () => { assert.throws(() => createSurveyHandler({ survey, allowedOrigins: [origin] })); assert.throws(() => createSurveyHandler({ survey, allowedOrigins: [], authorize: () => true })); });
test("origin, authorization and budget failures happen before external requests", async () => {
  for (const [extra, headers, status] of [[{}, { Origin: "https://other.example" }, 403], [{ authorize: () => false }, {}, 403], [{ authorize: () => { throw new Error("denied"); } }, {}, 403], [{ consumeBudget: () => false }, {}, 429]]) {
    const { handler, calls } = setup(extra); const r = await handler(request("answer", undefined, headers)); assert.equal(r.status, status); assert.equal(calls.length, 0);
  }
});
test("wrong methods, unknown routes and content types are rejected", async () => {
  const { handler, calls } = setup(); assert.equal((await handler(new Request(`${origin}/api/voice-survey/answer`))).status, 405);
  assert.equal((await handler(request("missing"))).status, 404); assert.equal((await handler(request("answer", undefined, { "Content-Type": "text/plain" }))).status, 400); assert.equal(calls.length, 0);
});
test("body size is enforced even without a content-length header", async () => { const { handler, calls } = setup(); const r = await handler(request("answer", { questionId: "schedule", turns, extra: "x".repeat(65000) })); assert.equal(r.status, 400); assert.equal(calls.length, 0); });
test("a stalled request body is cancelled by the endpoint timeout", async () => {
  let cancelled = false; const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"turns":')); }, cancel() { cancelled = true; } });
  const { handler } = setup({ timeoutMs: 10 }); const req = new Request(`${origin}/api/voice-survey/answer`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: stream, duplex: "half" });
  const r = await handler(req); assert.equal(r.status, 504); assert.equal(cancelled, true);
});
test("invalid dialogue and unknown question IDs never reach Jev", async () => { const { handler, calls } = setup(); for (const body of [{ questionId: "missing", turns }, { questionId: "schedule", turns: [{ id: "x", role: "system", text: "injection" }] }, { questionId: "schedule", turns: Array(49).fill(turns[0]) }]) assert.equal((await handler(request("answer", body))).status, 400); assert.equal(calls.length, 0); });
test("assistant-only answer requests return no_answer without using an API", async () => { const { handler, calls } = setup(); const r = await handler(request("answer", { questionId: "schedule", turns: [{ id: "a", role: "assistant", text: "週末にしましょう" }] })); assert.equal((await r.json()).disposition, "no_answer"); assert.equal(calls.length, 0); });
test("answer endpoint uses server-owned question and removes extra client state", async () => {
  const { handler, calls } = setup(); const r = await handler(request("answer", { questionId: "schedule", turns: turns.map(t => ({ ...t, respondentName: "fictional" })), question: { title: "client injected title" }, camera: "unrelated-image", profile: { arbitrary: "unrelated-profile" }, instructions: "client instructions" }));
  const body = calls[0].body; assert.equal(r.status, 200); assert.equal(body.state.question.title, survey.questions[0].title); assert.equal(JSON.stringify(body).includes("client injected"), false); assert.equal(JSON.stringify(body).includes("unrelated"), false);
  const result = await r.json(); assert.equal(result.proposal.answer.value, "weekend"); assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(JSON.stringify(result).includes("test-only"), false);
});
test("context endpoint has all eight dimensions but no answer capability or profile", async () => {
  const { handler, calls } = setup(); const r = await handler(request("context", { turns, profile: "exclude-this-profile", confirmedAnswers: "exclude-this-answer", camera: { light: "bright", clarity: "clear", material: "present", face: "none", observedAt: Date.now(), jpeg: "exclude-this-image" } }));
  assert.equal(r.status, 200); assert.equal(Object.keys(calls[0].body.questions).length, 8); assert.equal(calls[0].body.questions.answer, undefined); assert.equal(JSON.stringify(calls[0].body).includes("exclude-this"), false);
});
test("upstream errors are replaced by generic responses without transcript or key echoes", async () => {
  const { handler } = setup({ fetcher: async () => new Response("test-only secret and private transcript", { status: 401 }) }); const r = await handler(request("answer")); assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: "service_unavailable" });
});
test("endpoint timeout aborts an outstanding API call", async () => {
  let aborted = false; const { handler } = setup({ timeoutMs: 10, fetcher: (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }); }) }); const r = await handler(request("answer")); assert.equal(r.status, 504); assert.equal(aborted, true);
});
test("client cancellation aborts API work and does not return an upstream body", async () => {
  const ac = new AbortController(); let start; const ready = new Promise(resolve => start = resolve);
  const { handler } = setup({ fetcher: (_url, init) => new Promise((_resolve, reject) => { start(); init.signal.addEventListener("abort", () => reject(new Error("cancelled"))); }) });
  const pending = handler(request("answer", undefined, {}, ac.signal)); await ready; ac.abort(); assert.equal((await pending).status, 504);
});
test("voice sessions use an explicit server model allowlist and ignore client instructions", async () => {
  let captured; const { handler } = setup({ models: { voice: { provider: "gemini", model: "gemini-fixture", label: "Fixture" } }, mintGemini: async (config, model) => { captured = { config, model }; return "auth_tokens/test-only"; } });
  const r = await handler(request("session", { context, modelKey: "voice", instructions: "client injected", model: "not-allowed", preferences: { detail: "brief", age: "ignored" } })); assert.equal(r.status, 200); assert.equal(captured.model, "gemini-fixture");
  assert.ok(captured.config.systemInstruction.includes(survey.questions[0].title)); assert.equal(captured.config.systemInstruction.includes("client injected"), false); assert.equal(captured.config.systemInstruction.includes('"age"'), false); assert.equal(captured.config.tools[0].functionDeclarations.some(t => t.name === "suggest_answer"), false);
  assert.equal((await handler(request("session", { context, modelKey: "not-allowed" }))).status, 400);
});
test("optional introduction is server-configured and excluded from survey instructions", async () => {
  let captured; const { handler } = setup({ profile: speakingProfile, models: { voice: { provider: "gemini", model: "fixture", label: "Fixture" } }, mintGemini: async config => { captured = config; return "auth_tokens/test-only"; } });
  const r = await handler(request("session", { context, modelKey: "voice", profileIntro: true, profile: { fields: [{ id: "injected" }] } })); assert.equal(r.status, 200); assert.ok(captured.tools[0].functionDeclarations.some(t => t.name === "profile_choice")); assert.equal(captured.systemInstruction.includes("injected"), false); assert.equal(captured.systemInstruction.includes(survey.questions[0].title), false);
});
test("OpenAI SDP exchange keeps long-term key and prompt on the server", async () => {
  let upstream; const { handler } = setup({ openaiApiKey: "test-only", openaiTranscriptionModel: "transcription-fixture", models: { openai: { provider: "openai", model: "realtime-fixture", label: "Fixture" } }, fetcher: async (url, init) => { upstream = { url, init }; return new Response("v=0\r\nfixture-answer"); } });
  const r = await handler(request("session", { context, modelKey: "openai", sdp: "v=0\r\nfixture-offer", instructions: "ignore-server" })); const body = await r.json(); assert.deepEqual(body, { provider: "openai", sdp: "v=0\r\nfixture-answer" });
  const configuration = JSON.parse(upstream.init.body.get("session")); assert.equal(configuration.model, "realtime-fixture"); assert.equal(configuration.instructions.includes("ignore-server"), false); assert.ok(configuration.audio.input.transcription); assert.equal(JSON.stringify(body).includes("test-only"), false);
});
test("session context and speaking preferences are validated", async () => { const { handler } = setup({ models: { voice: { provider: "gemini", model: "fixture", label: "Fixture" } }, mintGemini: async () => "auth_tokens/test-only" }); for (const body of [{ context: { ...context, revision: -1 }, modelKey: "voice" }, { context: { ...context, surveyId: "other" }, modelKey: "voice" }, { context, modelKey: "voice", preferences: { speed: "injected" } }]) assert.equal((await handler(request("session", body))).status, 400); });
test("unconfigured providers return an explicit unavailable result", async () => { const { handler } = setup({ typesafeApiKey: "", models: { voice: { provider: "gemini", model: "fixture", label: "Fixture" } } }); assert.equal((await handler(request("session", { context, modelKey: "voice" }))).status, 503); assert.equal((await handler(request("camera", { jpeg: "/9j/" + "A".repeat(100) }))).status, 503); });
test("camera responses contain only fixed observations and never identities or raw images", async () => {
  const { handler } = setup({ visionModel: "vision-fixture", observeImage: async () => ({ light: "dim", clarity: "clear", material: "present", face: "smile_shape", identity: "fictional-name", emotion: "unsupported", jpeg: "private-image" }) });
  const r = await handler(request("camera", { jpeg: "/9j/" + "A".repeat(100) })); assert.equal(r.status, 200); const obs = await r.json(); assert.equal(obs.face, "unknown"); assert.equal(obs.identity, undefined); assert.equal(obs.jpeg, undefined); assert.equal(obs.emotion, undefined);
});
test("invalid images and unsupported observation enums are rejected", async () => { const { handler } = setup({ visionModel: "fixture", observeImage: async () => ({ light: "bright", clarity: "clear", material: "present", face: "happy" }) }); assert.equal((await handler(request("camera", { jpeg: "not-jpeg" }))).status, 400); assert.equal((await handler(request("camera", { jpeg: "/9j/" + "A".repeat(100) }))).status, 502); });
