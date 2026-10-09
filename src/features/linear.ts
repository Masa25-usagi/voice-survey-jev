import { isRecord } from "../types.js";
import { canonical, freezeManifest, validateVector } from "./schema.js";
import type { FeatureManifest, FeatureVector, FeatureBasis } from "./schema.js";

export type Split = "train" | "validation" | "test";
export interface Target { id: string; labels: string[]; basis?: FeatureBasis }
export interface TrainingRow { id: string; group: string; inputDigest: string; split: Split; features: FeatureVector; labels: Record<string, string> }
export interface Head { target: Target; weights: number[][]; bias: number[]; threshold: number; margin: number }
export interface Metrics { rows: number; accuracy: number; logLoss: number; coverage: number; acceptedAccuracy: number | null; support: Record<string, number> }
export interface WeightedModel {
  version: 1; manifest: FeatureManifest; source: FeatureVector["source"];
  center: number[]; scale: number[]; heads: Head[];
  training: { train: number; validation: number; test: number; l2: number; steps: number; balanced: true };
  validation: Record<string, Metrics>;
}
export interface Contribution { id: string; label: string; value: number; standardized: number; weight: number; contribution: number }
export interface Prediction { target: string; label: string; score: number; margin: number; accepted: boolean; scores: Record<string, number>; bias: number; logit: number; contributions: Contribution[] }
export interface TrainOptions { l2?: number; steps?: number; learningRate?: number; minimumPrecision?: number }
function softmax(logits: number[]): number[] {
  const max = Math.max(...logits), exp = logits.map(v => Math.exp(v - max)), sum = exp.reduce((s, v) => s + v, 0); return exp.map(v => v / sum);
}
function dot(a: number[], b: number[]): number { return a.reduce((s, v, i) => s + v * b[i]!, 0); }
function normalized(model: Pick<WeightedModel, "center" | "scale">, values: number[]): number[] { return values.map((v, i) => (v - model.center[i]!) / model.scale[i]!); }
function scores(head: Head, vector: number[]): number[] { return softmax(head.weights.map((w, c) => dot(w, vector) + head.bias[c]!)); }
function checkedTargets(targets: Target[]): Target[] {
  if (!Array.isArray(targets) || !targets.length || targets.length > 64 || new Set(targets.map(t => t.id)).size !== targets.length) throw new Error("Invalid targets");
  return targets.map(t => { if (!/^[a-z][a-z0-9_\-]{0,63}$/.test(t.id) || !Array.isArray(t.labels) || t.labels.length < 2 || t.labels.length > 256 || t.labels.some(l => typeof l !== "string" || !l.trim() || l.length > 128) || new Set(t.labels).size !== t.labels.length || (t.basis !== undefined && !["respondent_words", "camera_observation"].includes(t.basis))) throw new Error("Invalid target labels"); return { id: t.id, labels: [...t.labels], ...(t.basis ? { basis: t.basis } : {}) }; });
}
/** Groups and exact inputs must never cross split boundaries. Cached rows need their original input digest. */
export function validateDataset(manifest: FeatureManifest, targets: Target[], rows: TrainingRow[]): FeatureVector["source"] {
  const specs = checkedTargets(targets);
  if (!Array.isArray(rows) || rows.length < 6 || rows.length > 100000) throw new Error("Insufficient or oversized dataset");
  const ids = new Set<string>(), digests = new Set<string>(), groups = new Map<string, Split>(), source = rows[0]!.features?.source;
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id || row.id.length > 200 || ids.has(row.id) || typeof row.group !== "string" || !row.group || row.group.length > 200 || !/^[a-f0-9]{64}$/.test(row.inputDigest) || !["train", "validation", "test"].includes(row.split)) throw new Error("Invalid dataset row");
    if (digests.has(row.inputDigest)) throw new Error("Duplicate input: deduplicate before splitting");
    if (groups.has(row.group) && groups.get(row.group) !== row.split) throw new Error("A group crosses dataset splits");
    ids.add(row.id); digests.add(row.inputDigest); groups.set(row.group, row.split);
    validateVector(manifest, row.features); if (row.features.source !== source) throw new Error("Do not mix scripted and Jev features");
    if (!isRecord(row.labels) || Object.keys(row.labels).length !== specs.length || specs.some(t => !t.labels.includes(row.labels[t.id]!))) throw new Error("Missing or unknown teacher label");
  }
  for (const split of ["train", "validation", "test"] as const) if (!rows.some(r => r.split === split)) throw new Error(`Missing ${split} split`);
  for (const t of specs) for (const label of t.labels) if (rows.filter(r => r.split === "train" && r.labels[t.id] === label).length < 2 || !rows.some(r => r.split === "validation" && r.labels[t.id] === label)) throw new Error(`Insufficient train/validation support: ${t.id}/${label}`);
  return source;
}
function fitHead(target: Target, data: { row: TrainingRow; vector: number[] }[], manifest: FeatureManifest, options: Required<Pick<TrainOptions, "steps" | "learningRate">> & { l2: number }): Head {
  const dimensions = manifest.dimensions.length;
  const counts = target.labels.map(l => data.filter(d => d.row.labels[target.id] === l).length);
  const head: Head = { target, weights: target.labels.map(() => Array(dimensions).fill(0) as number[]), bias: target.labels.map(() => 0), threshold: 1, margin: 0.1 };
  // Full-batch, class-balanced multiclass logistic loss with L2 on weights; deterministic initialization.
  for (let step = 0; step < options.steps; step++) {
    const gradient = head.weights.map(w => w.map(v => options.l2 * v)), biases = head.bias.map(() => 0);
    for (const d of data) {
      const actual = target.labels.indexOf(d.row.labels[target.id]!), p = scores(head, d.vector), balance = 1 / (target.labels.length * counts[actual]!);
      for (let c = 0; c < p.length; c++) {
        const error = (p[c]! - (actual === c ? 1 : 0)) * balance;
        biases[c]! += error; for (let j = 0; j < dimensions; j++) if (!target.basis || manifest.dimensions[j]!.basis === target.basis) gradient[c]![j]! += error * d.vector[j]!;
      }
    }
    const rate = options.learningRate / Math.sqrt(1 + step / 150);
    head.weights.forEach((w, c) => { w.forEach((_, j) => { w[j]! -= rate * gradient[c]![j]!; }); head.bias[c]! -= rate * biases[c]!; });
  }
  return head;
}
function metrics(head: Head, center: number[], scale: number[], rows: TrainingRow[]): Metrics {
  if (!rows.length) throw new Error("Empty evaluation split");
  let correct = 0, accepted = 0, acceptedCorrect = 0, loss = 0;
  const support = Object.fromEntries(head.target.labels.map(l => [l, 0]));
  for (const row of rows) {
    const p = scores(head, normalized({ center, scale }, row.features.values)), ranking = p.map((score, i) => ({ score, i })).sort((a, b) => b.score - a.score), best = ranking[0]!, actual = head.target.labels.indexOf(row.labels[head.target.id]!);
    const right = best.i === actual; correct += Number(right); support[row.labels[head.target.id]!]!++;
    loss -= Math.log(Math.max(1e-12, p[actual]!));
    if (best.score >= head.threshold && best.score - ranking[1]!.score >= head.margin) { accepted++; acceptedCorrect += Number(right); }
  }
  return { rows: rows.length, accuracy: correct / rows.length, logLoss: loss / rows.length, coverage: accepted / rows.length, acceptedAccuracy: accepted ? acceptedCorrect / accepted : null, support };
}
/** Fits scaling/weights on train; chooses regularization and abstention only on validation. Test labels never tune anything. */
export function trainWeights(manifestInput: FeatureManifest, targetInput: Target[], rows: TrainingRow[], options: TrainOptions = {}): WeightedModel {
  const manifest = freezeManifest(manifestInput), targets = checkedTargets(targetInput), source = validateDataset(manifest, targets, rows);
  const steps = options.steps ?? 300, learningRate = options.learningRate ?? 0.18, precision = options.minimumPrecision ?? 0.9;
  if (!Number.isSafeInteger(steps) || steps < 10 || steps > 3000 || !Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 1 || !Number.isFinite(precision) || precision < 0.5 || precision > 1 || (options.l2 !== undefined && (!Number.isFinite(options.l2) || options.l2 < 0 || options.l2 > 10))) throw new Error("Invalid training options");
  const train = rows.filter(r => r.split === "train"), validation = rows.filter(r => r.split === "validation"), n = manifest.dimensions.length;
  const center = Array.from({ length: n }, (_, j) => train.reduce((s, r) => s + r.features.values[j]!, 0) / train.length);
  const scale = center.map((mean, j) => Math.max(0.1, Math.sqrt(train.reduce((s, r) => s + (r.features.values[j]! - mean) ** 2, 0) / train.length)));
  const data = train.map(row => ({ row, vector: normalized({ center, scale }, row.features.values) }));
  let best: { heads: Head[]; l2: number; loss: number } | undefined;
  for (const l2 of options.l2 === undefined ? [0.005, 0.025, 0.1] : [options.l2]) {
    const heads = targets.map(t => fitHead(t, data, manifest, { l2, steps, learningRate }));
    const loss = heads.reduce((s, h) => s + metrics(h, center, scale, validation).logLoss, 0) / heads.length;
    if (!best || loss < best.loss) best = { heads, l2, loss };
  }
  const reports: Record<string, Metrics> = Object.create(null);
  for (const head of best!.heads) {
    let coverage = -1, selectedThreshold = 1;
    for (const threshold of [0.55, 0.65, 0.75, 0.85, 0.95]) {
      head.threshold = threshold; const report = metrics(head, center, scale, validation);
      if (report.acceptedAccuracy !== null && report.acceptedAccuracy >= precision && report.coverage * validation.length >= 5 && report.coverage > coverage) { coverage = report.coverage; selectedThreshold = threshold; }
    }
    head.threshold = selectedThreshold;
    reports[head.target.id] = metrics(head, center, scale, validation);
  }
  return freezeModel({ version: 1, manifest, source, center, scale, heads: best!.heads, training: { train: train.length, validation: validation.length, test: rows.filter(r => r.split === "test").length, l2: best!.l2, steps, balanced: true }, validation: reports });
}
/** Evaluation is a separate step after the final model is frozen; it cannot update thresholds or weights. */
export function evaluateTest(modelInput: WeightedModel, rows: TrainingRow[]): Record<string, Metrics> {
  const model = freezeModel(modelInput); validateDataset(model.manifest, model.heads.map(h => h.target), rows);
  const test = rows.filter(r => r.split === "test"); if (test.some(r => r.features.source !== model.source)) throw new Error("Feature source mismatch");
  return Object.fromEntries(model.heads.map(h => [h.target.id, metrics(h, model.center, model.scale, test)]));
}
export function freezeModel(raw: unknown): WeightedModel {
  if (!isRecord(raw) || raw.version !== 1 || !["jev", "scripted"].includes(String(raw.source))) throw new Error("Invalid weighted model");
  const manifest = freezeManifest(raw.manifest), n = manifest.dimensions.length;
  const numeric = (a: unknown, length: number): a is number[] => Array.isArray(a) && a.length === length && a.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6);
  if (!numeric(raw.center, n) || raw.center.some(v => v < 0 || v > 1) || !numeric(raw.scale, n) || raw.scale.some(v => v < 0.1 || v > 1) || !Array.isArray(raw.heads)) throw new Error("Invalid normalization");
  const targets = checkedTargets(raw.heads.map(h => isRecord(h) ? h.target as Target : { id: "", labels: [] }));
  raw.heads.forEach((h, i) => { if (!isRecord(h) || !Array.isArray(h.weights) || h.weights.length !== targets[i]!.labels.length || h.weights.some(w => !numeric(w, n)) || !numeric(h.bias, targets[i]!.labels.length) || typeof h.threshold !== "number" || !Number.isFinite(h.threshold) || h.threshold < 0.5 || h.threshold > 1 || typeof h.margin !== "number" || !Number.isFinite(h.margin) || h.margin < 0 || h.margin > 1) throw new Error("Invalid classifier weights"); });
  raw.heads.forEach((h, i) => { const head = h as Head, basis = targets[i]!.basis; if (basis && head.weights.some(w => w.some((v, j) => manifest.dimensions[j]!.basis !== basis && v !== 0))) throw new Error("Weights violate the evidence boundary"); });
  if (!isRecord(raw.training) || !isRecord(raw.validation) || raw.training.balanced !== true || ![raw.training.train, raw.training.validation, raw.training.test, raw.training.steps].every(v => typeof v === "number" && Number.isSafeInteger(v) && v > 0) || typeof raw.training.l2 !== "number" || !Number.isFinite(raw.training.l2) || raw.training.l2 < 0 || raw.training.l2 > 10) throw new Error("Invalid training metadata");
  const reports: Record<string, Metrics> = Object.create(null);
  for (const target of targets) {
    const m = raw.validation[target.id];
    if (!isRecord(m) || !isRecord(m.support)) throw new Error("Invalid validation report");
    const support = m.support;
    if (m.rows !== raw.training.validation || ![m.accuracy, m.coverage].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) || typeof m.logLoss !== "number" || !Number.isFinite(m.logLoss) || m.logLoss < 0 || !(m.acceptedAccuracy === null || typeof m.acceptedAccuracy === "number" && Number.isFinite(m.acceptedAccuracy) && m.acceptedAccuracy >= 0 && m.acceptedAccuracy <= 1) || Object.keys(support).length !== target.labels.length || target.labels.some(l => typeof support[l] !== "number" || !Number.isSafeInteger(support[l]) || Number(support[l]) < 0) || Object.values(support).reduce<number>((s, v) => s + Number(v), 0) !== m.rows) throw new Error("Invalid validation report");
    reports[target.id] = { rows: Number(m.rows), accuracy: Number(m.accuracy), logLoss: m.logLoss, coverage: Number(m.coverage), acceptedAccuracy: m.acceptedAccuracy as number | null, support: Object.fromEntries(target.labels.map(l => [l, Number((m.support as Record<string, unknown>)[l])])) };
  }
  const training = raw.training;
  const model: WeightedModel = { version: 1, manifest, source: raw.source as FeatureVector["source"], center: [...raw.center], scale: [...raw.scale], heads: raw.heads.map((h, i) => { const head = h as Head; return { target: targets[i]!, weights: head.weights.map(w => [...w]), bias: [...head.bias], threshold: head.threshold, margin: head.margin }; }), training: { train: Number(training.train), validation: Number(training.validation), test: Number(training.test), l2: training.l2 as number, steps: Number(training.steps), balanced: true }, validation: reports };
  const freeze = (v: unknown): void => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }; freeze(model); return model;
}
export function predictWeighted(model: WeightedModel, vector: FeatureVector, targetId: string): Prediction {
  validateVector(model.manifest, vector); if (vector.source !== model.source) throw new Error("Feature source mismatch: scripted weights cannot be used with live Jev");
  const head = model.heads.find(h => h.target.id === targetId); if (!head) throw new Error("Unknown prediction target");
  const z = normalized(model, vector.values), p = scores(head, z), ranking = p.map((score, i) => ({ score, i })).sort((a, b) => b.score - a.score), best = ranking[0]!, margin = best.score - ranking[1]!.score;
  const contributions = model.manifest.dimensions.map((d, j) => ({ id: d.id, label: d.label, value: vector.values[j]!, standardized: z[j]!, weight: head.weights[best.i]![j]!, contribution: head.weights[best.i]![j]! * z[j]! }));
  return { target: targetId, label: head.target.labels[best.i]!, score: best.score, margin, accepted: best.score >= head.threshold && margin >= head.margin, scores: Object.fromEntries(head.target.labels.map((label, i) => [label, p[i]!])), bias: head.bias[best.i]!, logit: head.bias[best.i]! + contributions.reduce((s, c) => s + c.contribution, 0), contributions };
}
/** Deterministic group split for unassigned data; support is checked separately before training. */
export function splitGroups<T extends { group: string }>(rows: T[], seed = "feature-v1"): (T & { split: Split })[] {
  const assignments = new Map<string, Split>();
  return rows.map(row => { let split = assignments.get(row.group); if (!split) { let h = 2166136261; for (const char of canonical([seed, row.group])) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0; const p = h / 2 ** 32; split = p < 0.6 ? "train" : p < 0.8 ? "validation" : "test"; assignments.set(row.group, split); } return { ...row, split }; });
}
