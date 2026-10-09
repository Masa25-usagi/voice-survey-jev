import test from "node:test";
import assert from "node:assert/strict";
import { answerRequest, mapAnswer, validateJevResult, normalizedTurns, dialogueRequest, mapDialogue, safeObservation, feedbackText, DIMENSIONS, ProfileDraft, speakingProfile, formEntries, prefillUrl } from "../dist/index.js";
import { survey, turns, decision } from "./fixtures.mjs";
const map = (q, pick, words = turns, confidence = .9, probability = .95) => { const request = answerRequest(q, words); return mapAnswer(q, words, validateJevResult(decision(request, pick, confidence, probability), request)); };
test("single-choice Jev output maps arbitrary host option IDs", () => assert.equal(map(survey.questions[0], { answer: "weekend" }).proposal.answer.value, "weekend"));
test("scale decisions map to host numeric values", () => assert.equal(map(survey.questions[2], { answer: "level_1" }).proposal.answer.value, 2));
test("multiple-choice decisions use independently supported selections", () => assert.deepEqual(map(survey.questions[1], { readiness: "ready", pick_0: .9, pick_1: .01, pick_2: .9 }).proposal.answer.value, ["paper", "drawing"]));
test("uncertain or too many multi-selections do not create a candidate", () => { assert.equal(map(survey.questions[1], { readiness: "ready", pick_0: .5 }).disposition, "uncertain"); assert.equal(map(survey.questions[1], { readiness: "ready", pick_0: .9, pick_1: .9, pick_2: .9 }).disposition, "uncertain"); });
test("free-text candidate preserves exact respondent words and excludes interviewer speech", () => {
  const words = [{ id: "u", role: "user", text: "架空の街の地図を作りたいです。" }, { id: "a", role: "assistant", text: "工作がおすすめです。" }];
  assert.equal(map(survey.questions[3], { readiness: "ready" }, words).proposal.answer.value, words[0].text);
});
test("assistant-only dialogue cannot produce a respondent answer", () => assert.equal(map(survey.questions[0], { answer: "weekend" }, [{ id: "a", role: "assistant", text: "週末にしましょう。" }]).disposition, "no_answer"));
test("explanation requests and insufficient knowledge remain separate", () => {
  assert.equal(map(survey.questions[0], { answer: "reserved_no_answer" }).proposal, undefined);
  assert.deepEqual(map(survey.questions[0], { answer: "reserved_insufficient" }).proposal.answer, { kind: "skip", reason: "insufficient" });
});
test("confidence and selected probability must both pass the threshold", () => { assert.equal(map(survey.questions[0], { answer: "weekend" }, turns, .4).disposition, "uncertain"); assert.equal(map(survey.questions[0], { answer: "weekend" }, turns, .9, .4).disposition, "uncertain"); });
test("answer request excludes camera/profile/client metadata even on extended JS inputs", () => {
  const request = answerRequest({ ...survey.questions[0], camera: "private-image", profile: { age: 100 } }, [{ ...turns[0], camera: "private-image", respondentName: "fictional" }]);
  const body = JSON.stringify(request); assert.equal(body.includes("private-image"), false); assert.equal(body.includes("respondentName"), false); assert.equal(body.includes("age"), false);
});
test("rolling transcript normalization retains late corrections within bounded memory", () => {
  const words = Array.from({ length: 48 }, (_, i) => ({ id: String(i), role: "user", text: "古い文脈".repeat(1000) })); words.at(-1).text = "x".repeat(9000) + "訂正して週末です。";
  const normalized = normalizedTurns(words); assert.ok(normalized.reduce((n, t) => n + t.text.length, 0) <= 12000); assert.ok(normalized.at(-1).text.endsWith("訂正して週末です。"));
});
for (const [name, corrupt] of [
  ["unknown selected option", r => r.answers.answer.choice = "invented"], ["missing confidence", r => delete r.answers.answer.confidence], ["NaN confidence", r => r.answers.answer.confidence = NaN],
  ["missing probability", r => delete r.answers.answer.probabilities.weekend], ["extra probability", r => r.answers.answer.probabilities.extra = .2], ["non-normalized distribution", r => r.answers.answer.probabilities.weekend = .2], ["negative token usage", r => r.usage.input_tokens = -1]
]) test(`decision validation rejects ${name}`, () => { const req = answerRequest(survey.questions[0], turns), raw = decision(req, { answer: "weekend" }); corrupt(raw); assert.throws(() => validateJevResult(raw, req)); });
const camera = () => ({ light: "bright", clarity: "clear", material: "present", face: "brow_tension", observedAt: Date.now() });
function analysis(obs, picks = {}, confidence = .9) { const req = dialogueRequest(turns, obs); return mapDialogue(turns, obs, validateJevResult(decision(req, picks, confidence), req)); }
test("dialogue analysis contains exactly eight independent dimensions", () => { assert.equal(Object.keys(DIMENSIONS).length, 8); assert.deepEqual(Object.keys(analysis().findings), Object.keys(DIMENSIONS)); });
test("camera is accepted only by context analysis and stripped to fixed fields", () => { const obs = safeObservation({ ...camera(), identity: "not-a-real-person" }); assert.equal(obs.identity, undefined); assert.equal(dialogueRequest(turns, obs).state.camera.material, "present"); });
test("dim/blurred observations cannot drive a facial adjustment", () => { const obs = { ...camera(), light: "dim" }; assert.equal(safeObservation(obs).face, "unknown"); assert.equal(analysis(obs, { visual_response: "patient_wait" }).findings.visual_response.value, "unreliable"); });
test("expired camera observations are removed and visual response becomes none", () => { const obs = { ...camera(), observedAt: Date.now() - 31000 }; assert.equal(safeObservation(obs), undefined); assert.equal(analysis(obs, { visual_response: "patient_wait" }).findings.visual_response.value, "none"); });
test("no camera or no visible face never becomes a facial response", () => { assert.equal(analysis(undefined, { visual_response: "patient_wait" }).findings.visual_response.value, "none"); assert.equal(analysis({ ...camera(), face: "none" }, { visual_response: "patient_wait" }).findings.visual_response.value, "none"); });
test("unreliable findings and raw respondent text do not enter feedback", () => { const a = analysis(undefined, { explanation: "example" }, .4); const text = feedbackText(a); assert.equal(text.includes(turns[0].text), false); assert.equal(text.includes('"explanation":"example"'), false); assert.ok(text.includes('"explanation":"unknown"')); });
test("profile values require explicit respondent grounding and protect manual changes", () => { const p = new ProfileDraft(speakingProfile); assert.equal(p.suggest("speed", "slow", "ゆっくり", ["週末がいいです"]), false); assert.equal(p.suggest("speed", "slow", "ゆっくり", ["ゆっくり話してください"]), true); p.set("speed", "normal"); assert.equal(p.suggest("speed", "slow", "ゆっくり", ["ゆっくり"]), false); p.reset(); assert.deepEqual(p.values, {}); });
test("demographic profile fields never enter speaking preferences", () => { const p = new ProfileDraft({ fields: [{ id: "region", label: "任意の地域", options: [{ id: "north", label: "架空の北部" }, { id: "south", label: "架空の南部" }] }] }); p.set("region", "north"); assert.deepEqual(p.speakingPreferences(), {}); });
test("form mappings contain only confirmed inputs and support checkbox values and skips", () => { assert.deepEqual(formEntries({ a: { kind: "value", value: ["x", "y"] }, b: { kind: "skip", reason: "manual" } }, { a: { name: "choices", values: { x: "A", y: "B" } }, b: { name: "other" } }), [["choices", "A"], ["choices", "B"]]); });
test("prefill links encode free text without making network requests", () => { const url = prefillUrl("https://example.org/form?answer=old", { a: { kind: "value", value: "例 & 訂正" } }, { a: { name: "answer" } }); assert.equal(new URL(url).searchParams.get("answer"), "例 & 訂正"); assert.throws(() => prefillUrl("javascript:alert(1)", {}, {})); });
