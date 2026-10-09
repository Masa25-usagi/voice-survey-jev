import test from "node:test";
import assert from "node:assert/strict";
import { SurveyController, InterviewSession, dialogueRequest, validateJevResult, mapDialogue } from "../dist/index.js";
import { survey, decision, wait } from "./fixtures.mjs";
test("camera removal immediately replaces any shared visual adjustment with none", async () => {
  const c = new SurveyController(survey), sent = [];
  const s = new InterviewSession(c, { mapper: async () => ({ disposition: "no_answer" }), debounceMs: 1, analysisIntervalMs: 1, analyst: async ({ turns, camera }) => { const req = dialogueRequest(turns, camera); return mapDialogue(turns, camera, validateJevResult(decision(req, { visual_response: "material" }), req)); } });
  s.attachVoice({ updateContext: text => { sent.push(text); return true; }, setRevision() {} }); s.voiceStatus("listening");
  s.setCamera({ light: "bright", clarity: "clear", material: "present", face: "none", observedAt: Date.now() });
  s.ingest({ id: "u", role: "user", text: "例を説明してください", final: true, context: c.context }); await wait();
  assert.equal(s.snapshot.analysis.findings.visual_response.value, "material"); s.setCamera(undefined);
  assert.equal(s.snapshot.camera, undefined); assert.equal(s.snapshot.analysis.findings.visual_response.value, "none"); assert.ok(sent.at(-1).includes('"visual_response":"none"')); s.stop();
});
