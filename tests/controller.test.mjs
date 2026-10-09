import test from "node:test";
import assert from "node:assert/strict";
import { defineSurvey, SurveyController } from "../dist/index.js";
import { survey, proposal } from "./fixtures.mjs";

test("an AI candidate is visible but never exportable before explicit confirmation", () => {
  const c = new SurveyController(survey); assert.equal(c.propose(proposal(), c.context), true);
  assert.equal(c.snapshot.row.source, "ai"); assert.deepEqual(Object.keys(c.confirmedAnswers()), []);
  c.confirm(); assert.equal(c.confirmedAnswers().schedule.value, "weekend");
});
test("manual selection rejects both old and fresh automated proposals", () => {
  const c = new SurveyController(survey), stale = c.context; c.select("weekday");
  assert.equal(c.propose(proposal(), stale), false); assert.equal(c.propose(proposal(), c.context), false);
  c.confirm(); assert.equal(c.confirmedAnswers().schedule.value, "weekday");
});
test("editing a confirmed answer removes it from export until reconfirmed", () => {
  const c = new SurveyController(survey); c.select("weekend"); c.confirm(); c.select("weekday");
  assert.deepEqual(Object.keys(c.confirmedAnswers()), []); c.confirm(); assert.equal(c.confirmedAnswers().schedule.value, "weekday");
});
test("question navigation never confirms an answer implicitly", () => {
  const c = new SurveyController(survey); c.propose(proposal(), c.context); assert.throws(() => c.next());
  c.goTo("pace"); assert.deepEqual(Object.keys(c.confirmedAnswers()), []);
});
test("knowledge shortage and a midpoint rating produce different confirmed values", () => {
  const c = new SurveyController(survey); c.goTo("pace"); c.select(3); c.confirm(); assert.equal(c.confirmedAnswers().pace.value, 3);
  c.skip("insufficient"); c.confirm(); assert.deepEqual(c.confirmedAnswers().pace, { kind: "skip", reason: "insufficient" });
});
test("unknown IDs, invalid scales and oversized free text are rejected", () => {
  const c = new SurveyController(survey); assert.throws(() => c.select("missing")); assert.equal(c.propose(proposal("missing"), c.context), false);
  c.goTo("pace"); assert.throws(() => c.select(2.5)); c.goTo("idea"); assert.throws(() => c.select("x".repeat(501)));
});
test("explicitly unlocking suggestions clears the old manual answer", () => {
  const c = new SurveyController(survey); c.select("weekday"); c.confirm(); c.allowSuggestions();
  assert.deepEqual(Object.keys(c.confirmedAnswers()), []); assert.equal(c.propose(proposal(), c.context), true);
});
test("reconnection preserves confirmed and manual answers while invalidating old scopes", () => {
  const c = new SurveyController(survey); c.select("weekday"); c.confirm(); const old = c.context; c.reconnect();
  assert.equal(c.matches(old), false); assert.equal(c.confirmedAnswers().schedule.value, "weekday");
});
test("all four scope fields protect against cross-survey or stale events", () => {
  const c = new SurveyController(survey);
  for (const change of [{ surveyId: "other" }, { questionId: "pace" }, { connection: 999 }, { revision: 999 }]) assert.equal(c.propose(proposal(), { ...c.context, ...change }), false);
});
test("conditionally hidden answers are removed after their parent changes", () => {
  const s = structuredClone(survey); s.questions[1].when = { questionId: "schedule", equals: "weekend" };
  const c = new SurveyController(s); assert.throws(() => c.goTo("activities")); c.select("weekend"); c.confirm(); c.goTo("activities"); c.select(["paper"]); c.confirm();
  c.goTo("schedule"); c.select("weekday"); c.confirm(); assert.equal(c.visibleIds.includes("activities"), false); assert.equal(c.confirmedAnswers().activities, undefined);
});
test("returned objects and caller-owned survey inputs cannot mutate controller state", () => {
  const s = structuredClone(survey), c = new SurveyController(s); s.questions[0].options[0].id = "changed"; c.survey.questions[0].title = "changed";
  c.propose(proposal(), c.context); const snap = c.snapshot; snap.row.draft.value = "changed"; assert.equal(c.snapshot.row.draft.value, "weekend"); assert.notEqual(c.question.title, "changed");
});
test("reset clears all confirmed answers and invalidates pending work", () => { const c = new SurveyController(survey); c.select("weekday"); c.confirm(); const old = c.context; c.reset(); assert.equal(c.matches(old), false); assert.deepEqual(Object.keys(c.confirmedAnswers()), []); });
test("multiple choice keeps order-independent conditions and enforces its limit", () => {
  const c = new SurveyController(survey); c.goTo("activities"); c.select(["drawing", "paper"]); c.confirm(); assert.deepEqual(c.confirmedAnswers().activities.value, ["drawing", "paper"]);
  assert.throws(() => c.select(["paper", "paper"])); assert.throws(() => c.select(["paper", "drawing", "stories"])); c.clearSelection(); assert.equal(c.snapshot.row.draft, undefined);
});
for (const [name, mutate] of [
  ["duplicate question IDs", s => s.questions[1].id = s.questions[0].id],
  ["reserved option IDs", s => s.questions[0].options[0].id = "reserved_no_answer"],
  ["future branch references", s => s.questions[0].when = { questionId: "pace", equals: 2 }],
  ["script source URLs", s => s.questions[0].sources[0].url = "javascript:alert(1)"],
  ["invalid scale steps", s => s.questions[2].step = 0],
  ["fractional scale endpoints", s => s.questions[2].max = 5.2],
  ["unbounded text", s => s.questions[3].maxLength = 100000]
]) test(`survey validation rejects ${name}`, () => { const s = structuredClone(survey); mutate(s); assert.throws(() => defineSurvey(s)); });
