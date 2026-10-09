import { copy } from "./types.js";
import type { Answer, Option, Question, Survey, Value } from "./types.js";

const idPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
function nonempty(text: unknown, max = 8000): text is string { return typeof text === "string" && text.trim().length > 0 && text.length <= max; }
export function optionsFor(question: Question): Option[] {
  if (question.type === "single" || question.type === "multiple") return question.options;
  if (question.type !== "scale") return [];
  const out: Option[] = [];
  const step = question.step ?? 1;
  for (let i = 0; i <= Math.round((question.max - question.min) / step); i++) {
    const value = Number((question.min + i * step).toFixed(8));
    out.push({ id: `level_${i}`, label: question.labels?.[String(value)] ?? String(value), meaning: String(value) });
  }
  return out;
}
export function validValue(question: Question, value: unknown): value is Value {
  if (question.type === "text") return nonempty(value, question.maxLength ?? 2000);
  if (question.type === "scale") return typeof value === "number" && Number.isFinite(value) && optionsFor(question).some(o => Number(o.meaning) === value);
  if (question.type === "single") return typeof value === "string" && question.options.some(o => o.id === value);
  return Array.isArray(value) && value.every(v => typeof v === "string" && question.options.some(o => o.id === v))
    && new Set(value).size === value.length && value.length > 0 && value.length <= (question.maxSelections ?? question.options.length);
}
export function validAnswer(question: Question, answer: unknown): answer is Answer {
  if (!answer || typeof answer !== "object") return false;
  const a = answer as Answer;
  return a.kind === "skip" ? ["manual", "declined", "insufficient"].includes(a.reason) : a.kind === "value" && validValue(question, a.value);
}
export function defineSurvey(survey: Survey): Survey {
  if (!idPattern.test(survey.id) || !nonempty(survey.title, 500) || !Array.isArray(survey.questions) || survey.questions.length < 1 || survey.questions.length > 500) throw new Error("Invalid survey");
  const seen = new Map<string, Question>();
  for (const q of survey.questions) {
    if (!idPattern.test(q.id) || seen.has(q.id) || !nonempty(q.title) || !["single", "multiple", "scale", "text"].includes(q.type)) throw new Error("Invalid question");
    if (q.explanation !== undefined && !nonempty(q.explanation)) throw new Error("Invalid explanation");
    if (q.type === "single" || q.type === "multiple") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 240 || new Set(q.options.map(o => o.id)).size !== q.options.length) throw new Error("Invalid options");
      for (const o of q.options) if (!idPattern.test(o.id) || !nonempty(o.label, 500) || o.id.startsWith("reserved_") || (o.meaning !== undefined && !nonempty(o.meaning, 2000))) throw new Error("Invalid option");
      if (q.type === "multiple" && q.maxSelections !== undefined && (!Number.isInteger(q.maxSelections) || q.maxSelections < 1 || q.maxSelections > q.options.length)) throw new Error("Invalid selection limit");
    } else if (q.type === "scale") {
      const steps = (q.max - q.min) / (q.step ?? 1);
      if (![q.min, q.max, q.step ?? 1].every(Number.isFinite) || (q.step ?? 1) <= 0 || steps < 1 || steps > 100 || Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error("Invalid scale");
    } else if (q.maxLength !== undefined && (!Number.isInteger(q.maxLength) || q.maxLength < 1 || q.maxLength > 8000)) throw new Error("Invalid text limit");
    if (q.when) {
      const previous = seen.get(q.when.questionId);
      if (!previous || !validValue(previous, q.when.equals)) throw new Error("Conditions must reference an earlier question and valid value");
    }
    for (const s of q.sources ?? []) {
      if (!nonempty(s.title, 500) || !nonempty(s.publisher, 500) || !nonempty(s.text)) throw new Error("Invalid source");
      if (s.url && !/^https?:$/.test(new URL(s.url).protocol)) throw new Error("Invalid source URL");
    }
    seen.set(q.id, q);
  }
  return copy(survey);
}
export function equalValue(a: Value, b: Value): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]) : a === b;
}
