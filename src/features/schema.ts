import { isRecord } from "../types.js";
import type { Question, Usage } from "../types.js";
import { normalizedTurns } from "../jev.js";
import type { Turn } from "../jev.js";
import { safeObservation } from "../dialogue.js";
import type { CameraObservation } from "../dialogue.js";

export type FeatureBasis = "respondent_words" | "camera_observation";
export interface FeatureDimension { id: string; label: string; instructions: string; criteria: string[]; basis: FeatureBasis }
export interface FeatureManifest {
  version: 1;
  id: string;
  task: string;
  jevModel: string;
  designer: { kind: "llm"; model: string; scope: "task-only" | "training-only" };
  dimensions: FeatureDimension[];
}
export interface FeatureInput { turns: Turn[]; question?: Question; camera?: CameraObservation }
export interface FeatureVector {
  schemaKey: string;
  model: string;
  source: "jev" | "scripted";
  values: number[];
  uncertainty: number[];
  confidence: number[];
  usage: Usage;
}
export type FeatureExtractor = (manifest: FeatureManifest, input: FeatureInput, signal: AbortSignal) => Promise<FeatureVector>;

const identifier = /^[a-z][a-z0-9_\-]{0,63}$/;
function shortText(value: unknown, max: number): value is string { return typeof value === "string" && !!value.trim() && value.length <= max; }
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
/** Freezes the entire proposal, including the rubric order. Semantic review of LLM proposals is still required. */
export function freezeManifest(raw: unknown): FeatureManifest {
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.id !== "string" || !identifier.test(raw.id) || !shortText(raw.task, 3000) || typeof raw.jevModel !== "string" || !/^jev-\d+\.\d+\.\d+$/.test(raw.jevModel)) throw new Error("Invalid manifest or unpinned Jev model");
  const designer = raw.designer;
  if (!isRecord(designer) || designer.kind !== "llm" || !shortText(designer.model, 128) || !["task-only", "training-only"].includes(String(designer.scope))) throw new Error("The dimension designer must be recorded");
  if (!Array.isArray(raw.dimensions) || !raw.dimensions.length || raw.dimensions.length > 64) throw new Error("Expected 1 to 64 dimensions");
  const ids = new Set<string>();
  const dimensions: FeatureDimension[] = raw.dimensions.map(d => {
    if (!isRecord(d) || typeof d.id !== "string" || !identifier.test(d.id) || ids.has(d.id) || !shortText(d.label, 200) || !shortText(d.instructions, 3000) || !Array.isArray(d.criteria) || d.criteria.length < 2 || d.criteria.length > 10 || d.criteria.some(c => !shortText(c, 800)) || new Set(d.criteria).size !== d.criteria.length) throw new Error("Invalid dimension or rubric");
    if (!["respondent_words", "camera_observation"].includes(String(d.basis))) throw new Error("Feature evidence basis is required");
    ids.add(d.id); return { id: d.id, label: d.label, instructions: d.instructions, criteria: [...d.criteria] as string[], basis: d.basis as FeatureBasis };
  });
  return deepFreeze({ version: 1, id: raw.id, task: raw.task, jevModel: raw.jevModel, designer: { kind: "llm", model: designer.model, scope: designer.scope as FeatureManifest["designer"]["scope"] }, dimensions });
}
/** Exact canonical schema identity; this is not a security signature. Arrays remain ordered. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function manifestKey(manifest: FeatureManifest): string { return canonical(freezeManifest(manifest)); }
/** Labels, profile, image bytes and client metadata cannot enter the extractor state. */
export function featureState(input: FeatureInput, includeCamera = true): Record<string, unknown> {
  const state: Record<string, unknown> = { dialogue: normalizedTurns(input.turns).map(t => ({ role: t.role, text: t.text })) };
  if (input.question) {
    const q = input.question;
    state.question = { id: q.id, title: q.title, type: q.type, explanation: q.explanation ?? "", ...(q.type === "single" || q.type === "multiple" ? { options: q.options.map(o => ({ id: o.id, label: o.label, meaning: o.meaning ?? "" })) } : q.type === "scale" ? { min: q.min, max: q.max, step: q.step ?? 1, labels: q.labels ?? {} } : {}) };
  }
  if (includeCamera) { const camera = safeObservation(input.camera); if (camera) state.camera = { light: camera.light, clarity: camera.clarity, material: camera.material, face: camera.face }; }
  return state;
}
export async function inputDigest(input: FeatureInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(featureState(input, !input.question)));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
export function validateVector(manifest: FeatureManifest, vector: FeatureVector): void {
  if (!vector || vector.schemaKey !== manifestKey(manifest) || vector.model !== manifest.jevModel || !["jev", "scripted"].includes(vector.source)) throw new Error("Feature schema, source or Jev model mismatch");
  for (const values of [vector.values, vector.uncertainty, vector.confidence]) if (!Array.isArray(values) || values.length !== manifest.dimensions.length || values.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error("Invalid feature vector");
  if (!isRecord(vector.usage) || !Number.isSafeInteger(vector.usage.inputTokens) || !Number.isSafeInteger(vector.usage.outputTokens) || vector.usage.inputTokens < 0 || vector.usage.outputTokens < 0) throw new Error("Invalid feature usage");
}
