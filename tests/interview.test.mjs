import test from "node:test";
import assert from "node:assert/strict";
import { SurveyController, InterviewSession, dialogueRequest, validateJevResult, mapDialogue } from "../dist/index.js";
import { survey, proposal, turns, wait, deferred, decision } from "./fixtures.mjs";
const result = (value = "weekend") => ({ disposition: "candidate", proposal: proposal(value), model: "fixture", usage: { inputTokens: 0, outputTokens: 0 } });
const speech = (c, id, text, role = "user", final = true, context = c.context) => ({ id, text, role, final, context });
const options = mapper => ({ mapper, debounceMs: 1, analysisIntervalMs: 1 });
test("partial, duplicate and assistant-only transcript events do not request answers", async () => {
  const c = new SurveyController(survey); let calls = 0; const s = new InterviewSession(c, options(async () => { calls++; return result(); }));
  assert.equal(s.ingest(speech(c, "u", "weekend", "user", false)), false); s.ingest(speech(c, "a", "Explanation", "assistant")); await wait(); assert.equal(calls, 0);
  s.ingest(speech(c, "u", "weekend")); assert.equal(s.ingest(speech(c, "u", "weekend")), false); await wait(); assert.equal(calls, 1); s.stop();
});
test("a new respondent turn clears the previous AI candidate before reclassification", async () => {
  const c = new SurveyController(survey); const s = new InterviewSession(c, options(async () => result()));
  s.ingest(speech(c, "u1", "週末です")); await wait(); assert.ok(c.snapshot.row.draft);
  s.ingest(speech(c, "u2", "訂正したいです")); assert.equal(c.snapshot.row.draft, undefined); s.stop();
});
test("speech start clears an AI candidate before final transcription and retains dialogue", async () => {
  const c = new SurveyController(survey), s = new InterviewSession(c, options(async () => result()));
  s.ingest(speech(c, "first", "週末です")); await wait(); assert.ok(c.snapshot.row.draft);
  s.voiceStatus("user-speaking"); assert.equal(c.snapshot.row.draft, undefined); assert.equal(s.snapshot.turns.length, 1);
  s.voiceStatus("thinking"); s.ingest(speech(c, "correction", "平日に変えたい")); await wait(); assert.ok(c.snapshot.row.draft); s.stop();
});
test("speech start cancels pending mapping and analysis, including ignored aborts", async () => {
  const c = new SurveyController(survey), mapping = deferred(), analysis = deferred(); let mapSignal, analysisSignal; const shared = [];
  const s = new InterviewSession(c, { ...options(async input => { mapSignal = input.signal; return mapping.promise; }), analyst: async input => { analysisSignal = input.signal; return analysis.promise; } });
  s.attachVoice({ updateContext: text => { shared.push(text); return true; }, setRevision() {} }); s.voiceStatus("listening");
  s.ingest(speech(c, "first", "週末です")); await wait(); s.voiceStatus("user-speaking");
  assert.equal(mapSignal.aborted, true); assert.equal(analysisSignal.aborted, true);
  mapping.resolve(result()); const req = dialogueRequest(turns); analysis.resolve(mapDialogue(turns, undefined, validateJevResult(decision(req), req)));
  await wait(); s.voiceStatus("listening"); assert.equal(c.snapshot.row.draft, undefined); assert.equal(s.snapshot.analysis, undefined); assert.equal(shared.length, 0); s.stop();
});
test("speech start preserves manual and confirmed answers", () => {
  for (const confirmed of [false, true]) {
    const c = new SurveyController(survey), s = new InterviewSession(c, options(async () => result()));
    if (confirmed) { c.propose(proposal(), c.context); c.confirm(); } else c.select("weekday");
    const before = c.snapshot.row.draft; s.voiceStatus("user-speaking"); assert.deepEqual(c.snapshot.row.draft, before);
    if (confirmed) assert.deepEqual(c.confirmedAnswers().schedule, before); s.stop();
  }
});
test("a late result from a superseded utterance cannot overwrite its correction", async () => {
  const c = new SurveyController(survey), pending = deferred(); let call = 0;
  const s = new InterviewSession(c, options(async () => ++call === 1 ? pending.promise : result("weekday")));
  s.ingest(speech(c, "u1", "週末です")); await wait(); s.ingest(speech(c, "u2", "平日に訂正")); await wait(); pending.resolve(result()); await wait();
  assert.equal(c.snapshot.row.draft.value, "weekday"); s.stop();
});
test("manual change cancels pending classification even when a transport ignores abort", async () => {
  const c = new SurveyController(survey), pending = deferred(); let signal;
  const s = new InterviewSession(c, options(async input => { signal = input.signal; return pending.promise; }));
  s.ingest(speech(c, "u", "週末")); await wait(); c.select("weekday"); assert.equal(signal.aborted, true); pending.resolve(result()); await wait();
  assert.equal(c.snapshot.row.draft.value, "weekday"); assert.equal(s.snapshot.turns.length, 0); s.stop();
});
test("navigation and reconnect reject old transcript scopes and late results", async () => {
  const c = new SurveyController(survey), pending = deferred(), old = c.context; const s = new InterviewSession(c, options(async () => pending.promise));
  s.ingest(speech(c, "u", "週末")); await wait(); c.goTo("pace"); pending.resolve(result()); await wait(); assert.equal(c.snapshot.row.draft, undefined);
  assert.equal(s.ingest(speech(c, "stale", "古い発言", "user", true, old)), false); const before = c.context; c.reconnect(); assert.equal(s.ingest(speech(c, "stale2", "古い接続", "user", true, before)), false); s.stop();
});
test("long conversations continue and retain the latest correction", async () => {
  const c = new SurveyController(survey); let input;
  const s = new InterviewSession(c, options(async value => { input = value; return result("weekday"); }));
  for (let i = 0; i < 80; i++) s.ingest(speech(c, String(i), "古い文脈".repeat(300)));
  s.ingest(speech(c, "last", "x".repeat(9000) + "平日の夕方へ訂正します")); await wait();
  assert.ok(input.turns.length <= 48); assert.ok(input.turns.reduce((sum, t) => sum + t.text.length, 0) <= 12000); assert.ok(input.turns.at(-1).text.endsWith("平日の夕方へ訂正します")); assert.equal(c.snapshot.row.draft.value, "weekday"); s.stop();
});
test("late interviewer final transcription triggers a new context-aware classification", async () => {
  const c = new SurveyController(survey); const requests = [];
  const s = new InterviewSession(c, options(async input => { requests.push(input.turns); return result(); }));
  s.ingest(speech(c, "u", "週末です")); await wait(); s.ingest(speech(c, "a", "週末の日中ですね", "assistant")); await wait();
  assert.equal(requests.length, 2); assert.equal(requests.at(-1).at(-1).role, "assistant"); s.stop();
});
test("camera updates never cancel or enter answer classification", async () => {
  const c = new SurveyController(survey), pending = deferred(); let input;
  const s = new InterviewSession(c, options(async request => { input = request; return pending.promise; }));
  s.ingest(speech(c, "u", "週末です")); await wait(); s.setCamera({ light: "bright", clarity: "clear", material: "present", face: "none", observedAt: Date.now() });
  assert.equal(input.signal.aborted, false); assert.equal("camera" in input, false); pending.resolve(result()); await wait(); assert.equal(c.snapshot.row.draft.value, "weekend"); s.stop();
});
test("analysis waits for an idle conversation boundary and shares without generating speech", async () => {
  const c = new SurveyController(survey); const shared = [];
  const s = new InterviewSession(c, { ...options(async () => result()), analyst: async ({ turns: t, camera }) => { const req = dialogueRequest(t, camera); return mapDialogue(t, camera, validateJevResult(decision(req, { explanation: "example" }), req)); } });
  s.attachVoice({ updateContext: text => { shared.push(text); return true; }, setRevision() {} }); s.voiceStatus("speaking"); s.ingest(speech(c, "u", "身近な例で説明してください")); await wait(); assert.equal(shared.length, 0);
  s.voiceStatus("listening"); assert.equal(shared.length, 1); assert.equal(s.snapshot.analysis.shared, true); s.voiceStatus("listening"); assert.equal(shared.length, 1); s.stop();
});
test("stopping releases transcript/analysis memory and late callbacks become inert", async () => {
  const c = new SurveyController(survey), pending = deferred(), s = new InterviewSession(c, options(async () => pending.promise)); s.ingest(speech(c, "u", "週末")); await wait(); s.stop(); pending.resolve(result()); await wait(); assert.equal(c.snapshot.row.draft, undefined); assert.deepEqual(s.snapshot.turns, []); assert.equal(s.ingest(speech(c, "u2", "週末")), false);
});
test("mapping failure leaves manual completion available", async () => { const c = new SurveyController(survey), s = new InterviewSession(c, options(async () => { throw new Error("upstream failure"); })); s.ingest(speech(c, "u", "週末")); await wait(); assert.equal(s.snapshot.error, "mapping_unavailable"); c.select("weekday"); c.confirm(); assert.equal(c.confirmedAnswers().schedule.value, "weekday"); s.stop(); });
