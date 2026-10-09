import { copy, isRecord } from "../types.js";
import type { Answer, Question, Survey } from "../types.js";
import type { Mapper, Analyst } from "../interview.js";
import type { MappingResult, Turn } from "../jev.js";
import { normalizedTurns } from "../jev.js";
import { defineSurvey, optionsFor } from "../survey.js";
import { DIMENSIONS, safeObservation } from "../dialogue.js";
import type { DialogueAnalysis, Dimension } from "../dialogue.js";
import { postJson } from "../http.js";
import type { Fetcher } from "../http.js";
import { canonical, featureState } from "./schema.js";
import type { FeatureExtractor, FeatureVector } from "./schema.js";
import { freezeModel, predictWeighted } from "./linear.js";
import type { Prediction, Target, WeightedModel } from "./linear.js";

export interface FeatureBundle { version: 1; questions: Record<string, { questionKey: string; model: WeightedModel }>; context: WeightedModel }
export interface FeatureTrace { kind: "answer" | "context"; questionId?: string; manifestId: string; source: FeatureVector["source"]; jevModel: string; extractedAt: number; features: FeatureVector; predictions: Prediction[] }
export function questionKey(question: Question): string { return canonical(featureState({ question, turns: [] }, false).question); }
const reserved = ["reserved_no_answer", "reserved_insufficient", "reserved_declined", "reserved_uncertain"];
export function answerTargets(question: Question): Target[] {
  if (question.type === "single" || question.type === "scale") return [{ id: "answer", labels: [...optionsFor(question).map(o => o.id), ...reserved], basis: "respondent_words" }];
  return [{ id: "readiness", labels: ["ready", ...reserved], basis: "respondent_words" }, ...(question.type === "multiple" ? question.options.map((_, i) => ({ id: `pick_${i}`, labels: ["yes", "no"], basis: "respondent_words" as const })) : [])];
}
export function contextTargets(): Target[] { return Object.entries(DIMENSIONS).map(([id, d]) => ({ id, labels: Object.keys(d.choices), basis: id === "visual_response" ? "camera_observation" : "respondent_words" })); }
function checkTargets(model: WeightedModel, targets: Target[]): void {
  if (canonical(model.heads.map(h => h.target)) !== canonical(targets)) throw new Error("Target labels do not match the survey policy");
}
export function freezeBundle(raw: unknown, surveyInput: Survey): FeatureBundle {
  const survey = defineSurvey(surveyInput);
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.questions) || Object.keys(raw.questions).length !== survey.questions.length) throw new Error("Incomplete feature bundle");
  const questions: FeatureBundle["questions"] = Object.create(null);
  for (const q of survey.questions) {
    const item = raw.questions[q.id]; if (!isRecord(item) || item.questionKey !== questionKey(q)) throw new Error("Survey schema changed: retrain the corresponding feature model");
    const model = freezeModel(item.model); checkTargets(model, answerTargets(q)); questions[q.id] = Object.freeze({ questionKey: item.questionKey, model });
    if (model.manifest.dimensions.some(d => d.basis !== "respondent_words")) throw new Error("Answer models can use only respondent words");
  }
  const context = freezeModel(raw.context); checkTargets(context, contextTargets());
  return Object.freeze({ version: 1, questions: Object.freeze(questions), context });
}
export function createFeaturePipeline(survey: Survey, bundleInput: FeatureBundle, extractor: FeatureExtractor, onTrace?: (trace: FeatureTrace) => void): { mapper: Mapper; analyst: Analyst } {
  const bundle = freezeBundle(bundleInput, survey);
  const extract = async (model: WeightedModel, input: Parameters<FeatureExtractor>[1], signal: AbortSignal) => {
    if (signal.aborted) throw new Error("Cancelled"); const vector = await extractor(model.manifest, input, signal); if (signal.aborted) throw new Error("Cancelled"); return vector;
  };
  const trace = (kind: FeatureTrace["kind"], model: WeightedModel, features: FeatureVector, predictions: Prediction[], questionId?: string): FeatureTrace => {
    const result = { kind, questionId, manifestId: model.manifest.id, source: features.source, jevModel: features.model, extractedAt: Date.now(), features, predictions }; onTrace?.(copy(result)); return result;
  };
  return {
    mapper: async ({ question, turns: rawTurns, signal }) => {
      const item = bundle.questions[question.id]; if (!item || item.questionKey !== questionKey(question)) throw new Error("Untrained question");
      const turns = normalizedTurns(rawTurns), model = item.model, displayModel = `${model.manifest.jevModel} + learned weights (${model.source})`;
      if (!turns.some(t => t.role === "user")) return { disposition: "no_answer", model: displayModel, usage: { inputTokens: 0, outputTokens: 0 } };
      // Answer extraction receives no camera/profile, even when context analysis uses observations.
      const features = await extract(model, { question, turns }, signal);
      const predictions = model.heads.map(h => predictWeighted(model, features, h.target.id));
      const featureTrace = trace("answer", model, features, predictions, question.id);
      const base = { model: displayModel, usage: features.usage, featureTrace }, decision = predictions[0]!;
      if (!decision.accepted || decision.label === "reserved_uncertain") return { ...base, disposition: "uncertain" };
      if (decision.label === "reserved_no_answer") return { ...base, disposition: "no_answer" };
      let answer: Answer, score = decision.score;
      if (decision.label === "reserved_insufficient" || decision.label === "reserved_declined") answer = { kind: "skip", reason: decision.label === "reserved_declined" ? "declined" : "insufficient" };
      else if (question.type === "multiple") {
        const picks = predictions.slice(1); if (picks.some(p => !p.accepted)) return { ...base, disposition: "uncertain" };
        const selected = question.options.filter((_, i) => picks[i]!.label === "yes").map(o => o.id);
        if (!selected.length || selected.length > (question.maxSelections ?? question.options.length)) return { ...base, disposition: "uncertain" };
        score = Math.min(score, ...picks.map(p => p.score)); answer = { kind: "value", value: selected };
      } else if (question.type === "text") {
        const last = [...turns].reverse().find(t => t.role === "user")!.text.trim(); if (last.length > (question.maxLength ?? 2000)) return { ...base, disposition: "uncertain" };
        answer = { kind: "value", value: last };
      } else if (question.type === "scale") answer = { kind: "value", value: Number(optionsFor(question).find(o => o.id === decision.label)!.meaning) };
      else answer = { kind: "value", value: decision.label };
      return { ...base, disposition: "candidate", proposal: { answer, confidence: score, probability: score, model: displayModel } };
    },
    analyst: async ({ turns: rawTurns, camera: rawCamera, signal }) => {
      const started = Date.now(), turns = normalizedTurns(rawTurns), camera = safeObservation(rawCamera), model = bundle.context;
      if (!turns.some(t => t.role === "user")) throw new Error("No respondent words");
      const features = await extract(model, { turns, camera }, signal), predictions = model.heads.map(h => predictWeighted(model, features, h.target.id));
      const findings = Object.create(null) as DialogueAnalysis["findings"];
      for (const p of predictions) {
        const key = p.target as Dimension; let value = p.accepted ? p.label : "unknown", confidence = p.score, reliable = p.accepted;
        if (key === "visual_response") {
          if (!camera) { value = "none"; confidence = 1; reliable = true; }
          else if (camera.light !== "bright" || camera.clarity !== "clear") { value = "unreliable"; confidence = 1; reliable = true; }
          else if (value === "material" && camera.material !== "present" || value === "patient_wait" && ["neutral", "none", "unknown"].includes(camera.face)) { value = "none"; confidence = 1; reliable = true; }
        }
        findings[key] = { value, confidence, reliable, basis: key === "visual_response" ? "camera_observation" : "respondent_words" };
      }
      return { findings, usage: features.usage, model: `${model.manifest.jevModel} + learned weights (${model.source})`, analyzedAt: Date.now(), latencyMs: Date.now() - started, lastUserText: [...turns].reverse().find(t => t.role === "user")!.text.slice(-800), shared: false, featureTrace: trace("context", model, features, predictions) };
    }
  };
}
export function createHttpFeatureAnalysis(base = "/api/voice-survey", onTrace?: (trace: FeatureTrace) => void, fetcher?: Fetcher): { mapper: Mapper; analyst: Analyst } {
  const request = async <T extends MappingResult | DialogueAnalysis>(path: string, body: unknown, signal: AbortSignal): Promise<T> => {
    const result = await postJson<T & { featureTrace?: FeatureTrace }>(`${base}/${path}`, body, signal, fetcher);
    if (signal.aborted) throw new Error("Cancelled"); if (result.featureTrace) onTrace?.(copy(result.featureTrace)); return result;
  };
  return { mapper: ({ question, turns, signal }) => request("answer", { questionId: question.id, turns }, signal), analyst: ({ turns, camera, signal }) => request("context", { turns, camera }, signal) };
}
