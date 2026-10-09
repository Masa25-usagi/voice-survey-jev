import { access, readFile, writeFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import { freezeManifest, JevFeatureClient, inputDigest, proposeDimensions, trainWeights, evaluateTest, freezeModel, freezeBundle } from "../dist/features/index.js";

const [command, ...args] = process.argv.slice(2), flags = {};
for (let i = 0; i < args.length; i++) { if (!/^--[a-z-]+$/.test(args[i]) || Object.hasOwn(flags, args[i])) throw new Error("Invalid flags"); flags[args[i]] = args[i + 1]?.startsWith("--") || i === args.length - 1 ? true : args[++i]; }
const required = name => { const value = flags[`--${name}`]; if (typeof value !== "string") throw new Error(`Missing --${name}`); return value; };
const json = async path => JSON.parse(await readFile(path, "utf8"));
const jsonl = async path => (await readFile(path, "utf8")).split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
const save = async (value, lines = false) => { await writeFile(required("out"), lines ? value.map(r => JSON.stringify(r)).join("\n") + "\n" : JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); console.log("Saved. Existing files are never overwritten."); };
const signal = AbortSignal.timeout(120000);
if (["design", "extract", "train", "evaluate", "bundle"].includes(command)) {
  let exists = false;
  try { await access(required("out")); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (exists) throw new Error("Output already exists; choose a new --out path before making provider calls");
}
if (command === "design") {
  if (flags["--live"] !== true || !process.env.GEMINI_API_KEY) throw new Error("Design requires --live and your own GEMINI_API_KEY");
  const task = await json(required("task")), rows = await jsonl(required("data")), model = required("llm-model");
  const google = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const proposal = await proposeDimensions(task, rows, async (prompt, schema, abortSignal) => {
    const response = await google.models.generateContent({ model, contents: prompt, config: { abortSignal, responseMimeType: "application/json", responseJsonSchema: schema } });
    if (!response.text || response.text.length > 64000) throw new Error("Invalid designer response"); return JSON.parse(response.text);
  }, model, signal);
  await save(proposal); console.log("Review the observable traits and rubrics before extraction. This is a proposal, not measured quality.");
} else if (command === "extract") {
  if (flags["--live"] !== true || !process.env.TYPESAFE_API_KEY) throw new Error("Extraction requires --live and your own TYPESAFE_API_KEY");
  const manifest = freezeManifest(await json(required("manifest"))), rows = await jsonl(required("data")), client = new JevFeatureClient(process.env.TYPESAFE_API_KEY);
  const seen = new Set(), groups = new Map(), prepared = [];
  const ids = new Set();
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id || row.id.length > 200 || ids.has(row.id) || typeof row.group !== "string" || !row.group || row.group.length > 200 || !["train", "validation", "test"].includes(row.split) || !row.labels || typeof row.labels !== "object" || Array.isArray(row.labels) || Object.values(row.labels).some(v => typeof v !== "string") || !row.input) throw new Error("Expected unique id, group, split, input and labels");
    ids.add(row.id);
    const digest = await inputDigest(row.input); if (seen.has(digest)) throw new Error("Duplicate input"); seen.add(digest);
    if (groups.has(row.group) && groups.get(row.group) !== row.split) throw new Error("A group crosses splits"); groups.set(row.group, row.split); prepared.push({ row, digest });
  }
  const cache = [];
  for (const { row, digest } of prepared) {
    // Explicit construction prevents teacher labels or metadata from reaching Jev.
    const features = await client.extract(manifest, { turns: row.input.turns, question: row.input.question, camera: row.input.camera }, AbortSignal.timeout(30000));
    cache.push({ id: row.id, group: row.group, split: row.split, inputDigest: digest, labels: row.labels, features });
  }
  await save(cache, true); console.log(`Extracted ${cache.length} rows. Cache contains labels and feature values; keep it private.`);
} else if (command === "train") {
  const manifest = freezeManifest(await json(required("manifest"))), task = await json(required("task")), rows = await jsonl(required("cache"));
  const model = trainWeights(manifest, task.targets, rows, flags["--l2"] ? { l2: Number(flags["--l2"]) } : {});
  await save(model); console.log(JSON.stringify({ training: model.training, validation: model.validation, test: "Not evaluated. Freeze your choice before using evaluate." }, null, 2));
} else if (command === "evaluate") {
  const model = freezeModel(await json(required("model"))), rows = await jsonl(required("cache"));
  const report = { source: model.source, manifestId: model.manifest.id, test: evaluateTest(model, rows) }; await save(report);
} else if (command === "bundle") {
  const survey = await json(required("survey")), files = await json(required("models")), questions = {};
  for (const q of survey.questions) {
    const { questionKey } = await import("../dist/features/pipeline.js"); questions[q.id] = { questionKey: questionKey(q), model: await json(files.questions[q.id]) };
  }
  await save(freezeBundle({ version: 1, questions, context: await json(files.context) }, survey));
} else {
  console.log("Commands: design, extract, train, evaluate, bundle. See docs/FEATURES.md for JSONL formats and examples. Build first with npm run build.");
  process.exitCode = command ? 1 : 0;
}
