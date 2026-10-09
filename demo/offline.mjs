import { DIMENSIONS } from "../dist/dialogue.js";
import { scripts } from "./survey.mjs";
export async function offlineMapper({ question, turns, signal }) {
  if (signal.aborted) throw new Error("Cancelled");
  const last = [...turns].reverse().find(t => t.role === "user")?.text ?? "";
  const base = { model: "fictional-fixture", usage: { inputTokens: 0, outputTokens: 0 } };
  if (last.includes("説明してください")) return { ...base, disposition: "no_answer" };
  let answer;
  if (last.includes("判断材料が足りない")) answer = { kind: "skip", reason: "insufficient" };
  else if (question.id === "schedule" && last.includes("平日の夕方に変えたい")) answer = { kind: "value", value: "weekday" };
  else if (last === scripts[question.id]?.user) answer = { kind: "value", value: question.id === "schedule" ? "weekend" : question.id === "activities" ? ["paper", "drawing"] : question.id === "pace" ? 2 : last };
  else return { ...base, disposition: "uncertain" };
  return { ...base, disposition: "candidate", proposal: { answer, confidence: 0.86, probability: 0.92, model: base.model } };
}
export async function offlineAnalyst({ turns, camera, signal }) {
  if (signal.aborted) throw new Error("Cancelled");
  const last = [...turns].reverse().find(t => t.role === "user")?.text ?? "";
  const values = { understanding: last.includes("難しい") ? "needs_help" : "unknown", deliberation: last.includes("なら") ? "conditional" : "unknown", information: last.includes("判断材料") ? "needs_information" : "unknown", priority: last.includes("ペース") ? "time" : "unknown", explanation: last.includes("身近な例") ? "example" : "unknown", stated_feeling: "unknown", specificity: "concrete", visual_response: camera?.material === "present" ? "material" : "none" };
  return { model: "fictional-fixture", usage: { inputTokens: 0, outputTokens: 0 }, findings: Object.fromEntries(Object.keys(DIMENSIONS).map(key => [key, { value: values[key], confidence: key === "stated_feeling" ? 0.45 : 0.85, reliable: key !== "stated_feeling", basis: key === "visual_response" ? "camera_observation" : "respondent_words" }])), analyzedAt: Date.now(), lastUserText: last, shared: false };
}
