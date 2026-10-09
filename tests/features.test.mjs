import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { freezeManifest, manifestKey, featureRequest, parseFeatures, JevFeatureClient, inputDigest, dimensionDesignPrompt, proposeDimensions, trainWeights, predictWeighted, evaluateTest, freezeModel, freezeBundle, splitGroups, createFeaturePipeline } from "../dist/features/index.js";
import { createFeatureSurveyHandler } from "../dist/server/features.js";
import { createSurveyHandler } from "../dist/server/index.js";
import { SurveyController } from "../dist/controller.js";
import { InterviewSession } from "../dist/interview.js";
import { fictionalDatasets, trainFictionalBundle, scriptedExtractor, manifests, contextManifest } from "../demo/features.mjs";
import { survey, scripts } from "../demo/survey.mjs";

const dimension = id => ({ id, label: id, instructions: `Measure the observable expression ${id}.`, criteria: ["Absent", "Partial", "Explicit"], basis: "respondent_words" });
const manifest = freezeManifest({ version: 1, id: "test_features", task: "Observe numeric features", jevModel: "jev-1.13.0", designer: { kind: "llm", model: "test-llm", scope: "training-only" }, dimensions: [dimension("signal"), dimension("noise")] });
const targets = [{ id: "class", labels: ["left", "right"], basis: "respondent_words" }];
const vector = values => ({ schemaKey: manifestKey(manifest), model: manifest.jevModel, source: "scripted", values, uncertainty: values.map(() => 0.1), confidence: values.map(() => 0.9), usage: { inputTokens: 0, outputTokens: 0 } });
const rows = [];
for (const split of ["train", "validation", "test"]) for (let i = 0; i < 16; i++) {
  const id = `${split}_${i}`; rows.push({ id, group: `${split}_${Math.floor(i / 2)}`, inputDigest: createHash("sha256").update(id).digest("hex"), split, features: vector([i % 2 ? 0.9 : 0.1, (Math.floor(i / 2) % 2) ? 0.8 : 0.2]), labels: { class: i % 2 ? "right" : "left" } });
}
const model = trainWeights(manifest, targets, rows, { l2: 0.025 });
function rawScores(m, request, p = [0.1, 0.2, 0.7]) {
  return { model: m.jevModel, usage: { input_tokens: 12, output_tokens: 3 }, answers: Object.fromEntries(Object.entries(request.questions).map(([key, spec]) => [key, { type: "score", score: 1.6, confidence: 0.9, probabilities: Object.fromEntries(p.map((value, i) => [i, value])), legend: Object.fromEntries(spec.criteria.map((value, i) => [i, value])) }])) };
}
const input = { turns: [{ id: "a", role: "assistant", text: "Context only." }, { id: "u", role: "user", text: "Respondent expression." }] };
test("Jev receives ordinal feature questions without target labels, profile or teacher metadata", () => {
  const request = featureRequest(manifest, { ...input, labels: { class: "TOP_SECRET_LABEL" }, profile: { name: "PRIVATE_PROFILE" }, camera: { light: "bright", clarity: "clear", material: "present", face: "smile_shape", observedAt: Date.now() } });
  assert.ok(Object.values(request.questions).every(q => q.type === "score" && Array.isArray(q.criteria)));
  assert.deepEqual(Object.keys(request.state), ["dialogue"]);
  assert.ok(!JSON.stringify(request).includes("TOP_SECRET_LABEL")); assert.ok(!JSON.stringify(request).includes("PRIVATE_PROFILE"));
});
test("rubric expectation and distribution width are normalized independently of confidence", () => {
  const request = featureRequest(manifest, input), features = parseFeatures(rawScores(manifest, request), manifest);
  assert.equal(features.values[0], 0.8); assert.equal(features.confidence[0], 0.9); assert.ok(Math.abs(features.uncertainty[0] - Math.sqrt(0.44) / 2) < 1e-10);
  assert.equal(features.source, "jev"); assert.deepEqual(features.usage, { inputTokens: 12, outputTokens: 3 });
});
for (const [name, mutate] of [
  ["model drift", raw => { raw.model = "jev-1.14.0"; }],
  ["inconsistent expectation", raw => { raw.answers.signal.score = 0; }],
  ["malformed legend", raw => { raw.answers.signal.legend[0] = "Different rubric"; }],
  ["missing probability", raw => { delete raw.answers.signal.probabilities[1]; }],
  ["extra probability", raw => { raw.answers.signal.probabilities.extra = 0; }],
  ["distribution mass", raw => { raw.answers.signal.probabilities[0] = 0.5; }],
  ["nonfinite score", raw => { raw.answers.signal.score = NaN; }],
  ["extra response dimension", raw => { raw.answers.extra = raw.answers.signal; }]
]) test(`strict score response rejects ${name}`, () => { const raw = rawScores(manifest, featureRequest(manifest, input)); mutate(raw); assert.throws(() => parseFeatures(raw, manifest)); });
test("manifest immutability, rubric order, instructions and pinned version bind the cache", () => {
  assert.throws(() => { manifest.dimensions.reverse(); });
  for (const change of [m => m.dimensions.reverse(), m => m.dimensions[0].criteria.reverse(), m => { m.dimensions[0].instructions += " revised"; }, m => { m.jevModel = "jev-1.14.0"; }]) {
    const m = structuredClone(manifest); change(m); assert.notEqual(manifestKey(freezeManifest(m)), manifestKey(manifest));
  }
  assert.throws(() => freezeManifest({ ...manifest, jevModel: "jev-1.13" }));
  assert.throws(() => freezeManifest({ ...manifest, dimensions: [dimension("same"), dimension("same")] }));
});
test("LLM designer only sees training examples and returns a frozen variable-size proposal", async () => {
  const task = { id: "proposal", description: "Classify from observable traits", jevModel: manifest.jevModel, targets };
  const examples = ["train", "validation", "test"].map(split => ({ split, input: { turns: [{ id: "u", role: "user", text: `${split}_PRIVATE_TEXT` }] }, labels: { class: `${split}_LABEL` } }));
  const prompt = dimensionDesignPrompt(task, examples);
  assert.ok(prompt.includes("train_PRIVATE_TEXT")); assert.ok(!prompt.includes("test_PRIVATE_TEXT")); assert.ok(!prompt.includes("validation_LABEL"));
  const proposal = await proposeDimensions(task, examples, async () => ({ dimensions: [dimension("one")] }), "test-designer", new AbortController().signal);
  assert.equal(proposal.dimensions.length, 1); assert.equal(proposal.designer.scope, "training-only"); assert.ok(Object.isFrozen(proposal.dimensions));
});
test("input digest ignores event IDs and labels, and ignores camera for answer mapping", async () => {
  const question = survey.questions[0], a = { ...input, question, labels: { x: "a" } }, b = { ...a, turns: input.turns.map(t => ({ ...t, id: "new-event" })), labels: { x: "b" }, camera: { light: "bright", clarity: "clear", material: "present", face: "brow_tension", observedAt: Date.now() } };
  assert.equal(await inputDigest(a), await inputDigest(b));
});
test("numeric fitting learns a relevant signed weight and leaves balanced nuisance near zero", () => {
  const prediction = predictWeighted(model, vector([0.9, 0.2]), "class");
  assert.equal(prediction.label, "right"); assert.equal(prediction.accepted, true); assert.ok(prediction.contributions[0].weight > 0.5); assert.ok(Math.abs(prediction.contributions[1].weight) < 1e-8);
  assert.ok(Math.abs(prediction.logit - prediction.bias - prediction.contributions.reduce((s, c) => s + c.contribution, 0)) < 1e-10);
  assert.equal(evaluateTest(model, rows).class.accuracy, 1);
});
test("test values and test labels cannot affect fitted scaling, weights or validation selection", () => {
  const changed = structuredClone(rows); changed.filter(r => r.split === "test").forEach(r => { r.features.values = [0.5, 1]; r.labels.class = r.labels.class === "left" ? "right" : "left"; });
  assert.deepEqual(trainWeights(manifest, targets, rows), trainWeights(manifest, targets, changed));
});
test("a low-margin weighted prediction abstains", () => { const p = predictWeighted(model, vector([0.5, 0.5]), "class"); assert.equal(p.accepted, false); });
test("stronger regularization reduces weight magnitude", () => {
  const weak = trainWeights(manifest, targets, rows, { l2: 0.005 }), strong = trainWeights(manifest, targets, rows, { l2: 0.1 });
  assert.ok(Math.abs(strong.heads[0].weights[1][0]) < Math.abs(weak.heads[0].weights[1][0]));
});
for (const [name, mutate] of [
  ["group leakage", r => { r.find(x => x.split === "test").group = r[0].group; }],
  ["duplicate input", r => { r[1].inputDigest = r[0].inputDigest; }],
  ["missing class support", r => { r.filter(x => x.split === "train").forEach(x => { x.labels.class = "left"; }); }],
  ["invalid feature", r => { r[0].features.values[0] = Infinity; }],
  ["unknown label", r => { r[0].labels.class = "unexpected"; }],
  ["source mixing", r => { r[0].features.source = "jev"; }],
  ["schema reuse", r => { r[0].features.schemaKey = "old schema"; }]
]) test(`training rejects ${name}`, () => { const changed = structuredClone(rows); mutate(changed); assert.throws(() => trainWeights(manifest, targets, changed)); });
test("deterministic group partition keeps groups together", () => {
  const samples = Array.from({ length: 200 }, (_, i) => ({ group: `g${i % 100}` })), a = splitGroups(samples, "seed"); assert.deepEqual(a, splitGroups(samples, "seed"));
  for (const group of new Set(samples.map(r => r.group))) assert.equal(new Set(a.filter(r => r.group === group).map(r => r.split)).size, 1);
});
test("frozen models reject NaN and enforce evidence masks", () => {
  const bad = structuredClone(model); bad.heads[0].weights[0][0] = NaN; assert.throws(() => freezeModel(bad));
  const camera = structuredClone(model); camera.manifest.dimensions[1].basis = "camera_observation"; camera.heads[0].weights[0][1] = 1; assert.throws(() => freezeModel(camera), /evidence/);
});
test("model loading strips unrelated fields and rejects forged validation reports", () => {
  assert.ok(!Object.hasOwn(freezeModel({ ...model, rawTranscript: "private extra" }), "rawTranscript"));
  const wrong = structuredClone(model); wrong.validation.class.support.left = 999; assert.throws(() => freezeModel(wrong));
});

const fictional = await fictionalDatasets(), bundle = trainFictionalBundle(fictional, { l2: 0.025 });
const pipeline = createFeaturePipeline(survey, bundle, scriptedExtractor);
for (const question of survey.questions) test(`feature pipeline preserves ${question.type} answer proposals`, async () => {
  const mapped = await pipeline.mapper({ question, turns: [{ id: "u", role: "user", text: scripts[question.id].user }], signal: new AbortController().signal });
  assert.equal(mapped.disposition, "candidate");
  const expected = question.id === "schedule" ? "weekend" : question.id === "activities" ? ["paper", "drawing"] : question.id === "pace" ? 2 : scripts.idea.user;
  assert.deepEqual(mapped.proposal.answer, { kind: "value", value: expected }); assert.equal(mapped.featureTrace.source, "scripted");
});
test("clarification does not become an answer; lack of information remains a skip", async () => {
  const map = text => pipeline.mapper({ question: survey.questions[0], turns: [{ id: "u", role: "user", text }], signal: new AbortController().signal });
  assert.equal((await map("少し難しいので、短い身近な例で説明してください。")).disposition, "no_answer");
  assert.deepEqual((await map("判断材料が足りないので、今回は決められません。")).proposal.answer, { kind: "skip", reason: "insufficient" });
  assert.equal((await map("こんにちは。")).disposition, "uncertain");
});
test("late correction replaces earlier utterances and interviewer text cannot supply an answer", async () => {
  const question = survey.questions[0], signal = new AbortController().signal;
  const corrected = await pipeline.mapper({ question, turns: [{ id: "1", role: "user", text: scripts.schedule.user }, { id: "2", role: "user", text: "さっきの希望を訂正して、平日の夕方に変えたいです。" }], signal });
  assert.equal(corrected.proposal.answer.value, "weekday");
  const onlyInterviewer = await pipeline.mapper({ question, turns: [{ id: "a", role: "assistant", text: scripts.schedule.user }], signal }); assert.equal(onlyInterviewer.disposition, "no_answer");
});
test("text and visual heads cannot learn from the other's feature source", async () => {
  const model = bundle.context;
  for (const head of model.heads) for (const weights of head.weights) for (const [j, d] of model.manifest.dimensions.entries()) if (d.basis !== head.target.basis) assert.equal(weights[j], 0);
  const turns = [{ id: "u", role: "user", text: "よろしくお願いします。" }], signal = new AbortController().signal;
  const without = await pipeline.analyst({ turns, signal }), withFace = await pipeline.analyst({ turns, camera: { light: "bright", clarity: "clear", material: "absent", face: "brow_tension", observedAt: Date.now() }, signal });
  assert.deepEqual(without.findings.stated_feeling, withFace.findings.stated_feeling); assert.equal(withFace.findings.stated_feeling.value, "unknown");
  assert.equal(withFace.findings.visual_response.value, "patient_wait");
});
test("separate Jev requests keep word features away from camera and camera away from transcripts", async () => {
  const requests = [], client = new JevFeatureClient("example-only", async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request); const m = { ...contextManifest, dimensions: contextManifest.dimensions.filter(d => Object.hasOwn(request.questions, d.id)) };
    return Response.json(rawScores(m, request));
  });
  const result = await client.extract(contextManifest, { ...input, camera: { light: "bright", clarity: "clear", material: "present", face: "none", observedAt: Date.now() }, labels: { information: "enough" } }, new AbortController().signal);
  assert.equal(requests.length, 2); assert.equal(result.values.length, contextManifest.dimensions.length);
  const words = requests.find(r => r.state.dialogue), camera = requests.find(r => Object.hasOwn(r.state, "camera"));
  assert.ok(!Object.hasOwn(words.state, "camera")); assert.deepEqual(Object.keys(camera.state), ["camera"]); assert.ok(requests.every(r => Object.values(r.questions).every(q => q.type === "score")));
  assert.equal(result.usage.inputTokens, 24);
});
test("changed survey schema and scripted/live mixing are rejected before inference", () => {
  const changed = structuredClone(survey); changed.questions[0].options[0].label += " changed"; assert.throws(() => freezeBundle(bundle, changed));
  assert.throws(() => createFeatureSurveyHandler({ survey, bundle, allowedOrigins: ["http://example.test"], authorize: () => true }), /Jev features/);
  assert.throws(() => predictWeighted(bundle.questions.schedule.model, { ...fictional.questions.schedule[0].features, source: "jev" }, "answer"), /source mismatch/);
});
test("feature server keeps host-owned question, validates authorization, and never uses legacy Jev route", async () => {
  const calls = [], options = { survey, allowedOrigins: ["http://example.test"], authorize: () => true, analysis: { mapper: async i => { calls.push(i); return pipeline.mapper(i); }, analyst: pipeline.analyst }, fetcher: async () => { throw new Error("Legacy upstream must not be called"); } };
  const handler = createSurveyHandler(options), make = (origin, extra = {}) => new Request("http://example.test/api/voice-survey/answer", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ questionId: "schedule", turns: [{ id: "u", role: "user", text: scripts.schedule.user }], question: { id: "hostile" }, weights: [99], labels: { answer: "weekday" }, ...extra }) });
  assert.equal((await handler(make("http://forbidden.test"))).status, 403); assert.equal(calls.length, 0);
  const response = await handler(make("http://example.test")); assert.equal(response.status, 200); assert.equal((await response.json()).proposal.answer.value, "weekend"); assert.equal(calls[0].question.id, "schedule"); assert.ok(!Object.hasOwn(calls[0], "labels"));
});
test("live feature handler contracts consume score-only mock responses and return weighted candidates", async () => {
  // A deterministic mock transport, not an actual Jev performance experiment.
  const mockedBundle = structuredClone(bundle); mockedBundle.context.source = "jev"; Object.values(mockedBundle.questions).forEach(item => { item.model.source = "jev"; });
  const wire = [], handler = createFeatureSurveyHandler({ survey, bundle: mockedBundle, allowedOrigins: ["http://example.test"], authorize: () => true, typesafeApiKey: "example-only", fetcher: async (_url, init) => {
    const request = JSON.parse(init.body); wire.push(request);
    const m = request.state.question ? manifests[request.state.question.id] : contextManifest;
    const turns = (request.state.dialogue ?? []).map((t, i) => ({ ...t, id: String(i) }));
    const features = await scriptedExtractor(m, { turns, question: request.state.question ? survey.questions.find(q => q.id === request.state.question.id) : undefined, camera: request.state.camera ? { ...request.state.camera, observedAt: Date.now() } : undefined }, init.signal);
    return Response.json({ model: m.jevModel, usage: { input_tokens: 10, output_tokens: 4 }, answers: Object.fromEntries(Object.entries(request.questions).map(([key, spec]) => {
      const value = features.values[m.dimensions.findIndex(d => d.id === key)];
      return [key, { type: "score", score: 2 * value, confidence: 0.95, probabilities: { 0: 1 - value, 1: 0, 2: value }, legend: Object.fromEntries(spec.criteria.map((c, i) => [i, c])) }];
    })) });
  } });
  const request = (path, body) => new Request(`http://example.test/api/voice-survey/${path}`, { method: "POST", headers: { origin: "http://example.test", "content-type": "application/json" }, body: JSON.stringify(body) });
  const answer = await handler(request("answer", { questionId: "schedule", turns: [{ id: "u", role: "user", text: scripts.schedule.user }], weights: [999], labels: { answer: "weekday" } }));
  assert.equal(answer.status, 200); const result = await answer.json(); assert.equal(result.proposal.answer.value, "weekend"); assert.equal(result.featureTrace.source, "jev");
  const analysis = await handler(request("context", { turns: [{ id: "u", role: "user", text: "少し難しいので、身近な例で説明してください。" }], camera: { light: "bright", clarity: "clear", material: "present", face: "none", observedAt: Date.now() } }));
  assert.equal(analysis.status, 200); const context = await analysis.json(); assert.equal(context.findings.explanation.value, "example"); assert.equal(context.findings.visual_response.value, "material");
  assert.equal(wire.length, 3); assert.ok(wire.every(r => Object.values(r.questions).every(q => q.type === "score"))); assert.ok(wire.every(r => !Object.hasOwn(r.state, "labels")));
});
test("cancellation suppresses feature traces and a late weighted proposal cannot overwrite manual input", async () => {
  let resolve, traces = 0;
  const slow = createFeaturePipeline(survey, bundle, (m, input, signal) => new Promise(r => { resolve = async () => r(await scriptedExtractor(m, input, new AbortController().signal)); }), () => { traces++; });
  const controller = new SurveyController(survey), interview = new InterviewSession(controller, { mapper: slow.mapper, debounceMs: 0 });
  interview.ingest({ id: "u", role: "user", text: scripts.schedule.user, final: true, context: controller.context });
  await new Promise(r => setTimeout(r, 5)); controller.select("weekday"); await resolve(); await new Promise(r => setTimeout(r, 5));
  assert.equal(controller.snapshot.row.draft.value, "weekday"); assert.equal(traces, 0); interview.stop();
});
