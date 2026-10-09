import { freezeManifest, manifestKey, inputDigest, featureState, trainWeights, questionKey, answerTargets, contextTargets, createFeaturePipeline } from "../dist/features/index.js";
import { survey } from "./survey.mjs";

// Original fictional fixtures. These scripted measurements are not Jev predictions.
const feature = (id, label, instructions, read, basis = "respondent_words") => ({ id, label, instructions, basis, criteria: ["No supporting evidence", "Tentative or partial evidence", "Explicit supporting evidence"], read });
const common = [
  feature("substantive", "具体的な発言", "Presence of substantive respondent content about an activity, availability or pace, rather than a request for clarification.", s => /(したい|いいです|希望|参加|作[りる]|描[いく]|書[いく]|ペース|好き)/.test(s)),
  feature("lack_information", "判断材料の不足を明示", "Explicit statement that missing information prevents the respondent from deciding.", s => /判断材料が足りない|情報が足りず|まだ決められません/.test(s)),
  feature("refusal", "回答を控えると明示", "Explicit respondent statement declining to answer, rather than lack of knowledge.", s => /回答を控え|答えたくない|回答しません/.test(s)),
  feature("clarification", "説明を依頼", "Explicit request to explain the question, without treating the question as a respondent preference.", s => /説明してください|どういう意味|教えてください/.test(s)),
  feature("indecision", "複数の可能性を残す", "Explicit indecision between competing preferences, without resolving them.", s => /迷っています|決めかね|どちらか迷う/.test(s)),
  feature("correction", "前の発言を訂正", "An explicit correction of an earlier respondent statement.", s => /訂正|変えたい|さっきの/.test(s))
];
const availability = [
  feature("weekday_available", "平日夕方の都合", "A current affirmative statement of weekday evening availability; a rejected or earlier superseded mention is absent.", s => /平日の夕方/.test(s) && !/平日の夕方は無理/.test(s)),
  feature("weekend_available", "週末昼間の都合", "A current affirmative statement of weekend daytime availability; negated or superseded mentions are absent.", s => /週末|土日/.test(s) && !/週末は無理|週末ではなく/.test(s)),
  feature("unrestricted", "時間の制約なし", "Explicit statement that both proposed time windows are available.", s => /どちらでも|両方の時間/.test(s))
];
const activities = [
  feature("paper_activity", "紙を使う制作への言及", "Affirmative respondent interest in making things from paper, excluding explicitly rejected mentions.", s => /紙の工作/.test(s) && !/紙の工作はしない/.test(s)),
  feature("story_activity", "文章を書く制作への言及", "Affirmative respondent interest in writing a story, excluding explicitly rejected mentions.", s => /物語/.test(s) && !/物語は書かない/.test(s)),
  feature("drawing_activity", "絵を描く制作への言及", "Affirmative respondent interest in drawing, excluding explicitly rejected mentions.", s => /絵を描/.test(s) && !/絵は描かない/.test(s))
];
const levels = Array.from({ length: 5 }, (_, i) => feature(`number_${i + 1}`, `数値 ${i + 1} の明示`, `The respondent explicitly states ${i + 1} as their current numerical pace on the given scale. Do not count the scale endpoint mentioned as context.`, s => new RegExp(`(?:なら|は|を|で)${i + 1}(?:くらい|に|が|を)`).test(s)));
const ideas = [feature("new_activity", "新しい制作案", "A concrete respondent proposal of a new activity, excluding requests for explanation.", s => /地図|しおり|共同作品|折り紙/.test(s))];
const contextDefinitions = [
  feature("understood", "理解したと発言", "An explicit statement of understanding the question.", s => /内容は理解できました/.test(s)),
  feature("wording_difficult", "言葉が難しいと発言", "An explicit statement that the question wording is difficult.", s => /言葉が難しい|少し難しい/.test(s)),
  feature("definite", "確かな意向の表現", "Explicit definite intention, without unresolved alternatives.", s => /これで決めています/.test(s)),
  feature("conditional", "条件節", "An explicit if-condition attached to participation or preference.", s => /条件が合えば/.test(s)),
  feature("unsure", "迷いの表現", "Explicit respondent indecision.", s => /迷っています/.test(s)),
  feature("facts_enough", "材料は十分と発言", "Explicit statement that available information is sufficient.", s => /判断材料は十分/.test(s)),
  feature("facts_needed", "追加情報を依頼", "Explicit request for information needed to decide.", s => /判断材料が足りない|情報を知りたい/.test(s)),
  feature("declines", "回答を控えると発言", "Explicit refusal to answer.", s => /回答を控え/.test(s)),
  ...[["cost", "費用", /費用を重視/], ["time", "時間", /時間を重視|ペース/], ["access", "アクセス", /行きやすさを重視/], ["quality", "品質", /品質を重視/], ["other", "その他の重視点", /環境への配慮を重視/]].map(([id, label, regex]) => feature(`priority_${id}`, label, `An explicit statement of concern about ${id}; do not infer priorities from personal attributes.`, s => regex.test(s))),
  feature("short_request", "短い説明を依頼", "Explicit request for a brief explanation.", s => /短く説明|短い/.test(s)),
  feature("example_request", "例を依頼", "Explicit request for an everyday example.", s => /身近な例/.test(s)),
  feature("detail_request", "詳細を依頼", "Explicit request for a detailed explanation.", s => /詳しく説明/.test(s)),
  feature("no_explanation", "追加説明を辞退", "Explicit statement that no more explanation is needed.", s => /追加の説明は不要/.test(s)),
  feature("comfortable_words", "安心と本人が発言", "The respondent explicitly says they feel comfortable. Facial appearance is never evidence for this feature.", s => /安心しています/.test(s)),
  feature("concern_words", "心配と本人が発言", "The respondent explicitly says they are worried. Facial appearance is never evidence for this feature.", s => /心配しています/.test(s)),
  feature("break_request", "休憩を依頼", "Explicit request to pause or rest.", s => /休憩したい/.test(s)),
  feature("concrete_example", "具体例を述べる", "An explicit example, particular time or proposed object in the respondent's words.", s => /具体例として|夕方|昼間|地図|紙の工作|段階/.test(s)),
  feature("general_statement", "一般的な希望を述べる", "A general preference explicitly stated without a concrete example.", s => /一般的には楽しい活動を希望/.test(s)),
  feature("very_little", "内容が少ない", "Explicitly very little substantive respondent content.", s => /まだ発言する内容がありません/.test(s)),
  feature("dim_capture", "暗い映像", "The fixed camera observation states dim lighting. This measures capture quality only.", (_, c) => c?.light === "dim", "camera_observation"),
  feature("blurred_capture", "不鮮明な映像", "The fixed camera observation states a blurred image. This measures capture quality only.", (_, c) => c?.clarity === "blurred", "camera_observation"),
  feature("material_visible", "資料が見える", "Printed material is present in the fixed observation. Do not read or identify its contents.", (_, c) => c?.material === "present", "camera_observation"),
  feature("face_shape_visible", "静止した顔の形の観察", "A clearly captured non-neutral static facial shape in the fixed observation, without interpreting feelings, pain, personality or identity.", (_, c) => c?.light === "bright" && c?.clarity === "clear" && ["brow_tension", "smile_shape", "hand_near_temple"].includes(c?.face), "camera_observation"),
  feature("unknown_capture", "撮影条件が不明", "A provided camera observation has unknown lighting or clarity, rather than no camera.", (_, c) => c?.light === "unknown" || c?.clarity === "unknown", "camera_observation")
];
const definitions = new Map();
function manifest(id, task, defs) {
  definitions.set(id, defs);
  return freezeManifest({ version: 1, id, task, jevModel: "jev-1.13.0", designer: { kind: "llm", model: "Codex — task-only demo proposal", scope: "task-only" }, dimensions: defs.map(({ read, ...d }) => d) });
}
export const manifests = Object.fromEntries(survey.questions.map(q => [q.id, manifest(`demo_${q.id}`, `Extract observable features for the fictional workshop question: ${q.title}`, [...common, ...(q.id === "schedule" ? availability : q.id === "activities" ? activities : q.id === "pace" ? levels : ideas)])]));
export const contextManifest = manifest("demo_context", "Measure atomic conversational expressions and fixed capture conditions for the eight existing dialogue support targets.", contextDefinitions);
export async function scriptedExtractor(m, input, signal) {
  if (signal.aborted) throw new Error("Cancelled");
  const defs = definitions.get(m.id); if (!defs || manifestKey(m) !== manifestKey(m.id === contextManifest.id ? contextManifest : Object.values(manifests).find(s => s.id === m.id))) throw new Error("Demo schema changed");
  const state = featureState(input, !input.question), last = [...state.dialogue].reverse().find(t => t.role === "user")?.text ?? "";
  const values = defs.map(d => d.read(last, state.camera) ? 0.97 : 0.03);
  return { schemaKey: manifestKey(m), model: m.jevModel, source: "scripted", values, uncertainty: values.map(() => 0.1), confidence: values.map(() => 0.95), usage: { inputTokens: 0, outputTokens: 0 } };
}
const noAnswer = [
  ["判断材料が足りないので、今回は決められません。", "reserved_insufficient"],
  ["今回は回答を控えます。", "reserved_declined"],
  ["少し難しいので、短い身近な例で説明してください。", "reserved_no_answer"],
  ["いくつかの可能性があって迷っています。", "reserved_uncertain"]
];
function cases(q) {
  let choices;
  if (q.id === "schedule") choices = [["平日の夕方に参加したいです。", "weekday"], ["平日は予定があるので、週末の昼間なら参加できそうです。", "weekend"], ["どちらでも参加できます。", "either"]];
  else if (q.id === "pace") choices = Array.from({ length: 5 }, (_, i) => [`5段階なら${i + 1}くらいのペースがいいです。`, `level_${i}`]);
  else if (q.id === "idea") choices = [["みんなで一つの架空の街の地図を描いてみたいです。", "ready"], ["共同作品としてしおりを作りたいです。", "ready"]];
  else {
    const names = ["紙の工作", "短い物語を書くこと", "絵を描くこと"];
    choices = [1, 2, 3, 4, 5, 6].map(mask => [names.filter((_, i) => mask & (1 << i)).join("と") + "をやってみたいです。", "ready", mask]);
  }
  return [...choices, ...noAnswer];
}
const phrases = {
  understanding: { clear: "内容は理解できました。", needs_help: "言葉が難しいです。", unknown: "" },
  deliberation: { settled: "これで決めています。", conditional: "条件が合えば参加したいです。", uncertain: "迷っています。", unknown: "" },
  information: { enough: "判断材料は十分です。", needs_information: "情報を知りたいです。", declined: "回答を控えます。", unknown: "" },
  priority: { cost: "費用を重視します。", time: "時間を重視します。", accessibility: "行きやすさを重視します。", quality: "品質を重視します。", other: "環境への配慮を重視します。", unknown: "" },
  explanation: { brief: "短く説明してください。", example: "身近な例で説明してください。", detailed: "詳しく説明してください。", none: "追加の説明は不要です。", unknown: "" },
  stated_feeling: { comfortable: "安心しています。", concerned: "心配しています。", needs_break: "休憩したいです。", unknown: "" },
  specificity: { concrete: "具体例として小さな作品を希望します。", general: "一般的には楽しい活動を希望します。", insufficient: "まだ発言する内容がありません。", unknown: "" }
};
export async function fictionalDatasets() {
  const data = { questions: {}, context: [] }, used = new Set();
  async function add(rows, m, input, labels, split, group, id) {
    const digest = await inputDigest(input); if (used.has(digest)) return false; used.add(digest);
    rows.push({ id, group, split, inputDigest: digest, labels, features: await scriptedExtractor(m, input, new AbortController().signal) }); return true;
  }
  for (const q of survey.questions) {
    const rows = []; data.questions[q.id] = rows;
    for (const split of ["train", "validation", "test"]) for (const [index, [text, label, mask]] of cases(q).entries()) for (let variant = 0; variant < (split === "train" ? 8 : 4); variant++) {
      const id = `${q.id}_${split}_${index}_${variant}`, labels = Object.fromEntries(answerTargets(q).map(t => [t.id, t.id === "answer" || t.id === "readiness" ? label : mask & (1 << Number(t.id.slice(5))) ? "yes" : "no"]));
      // Context wording varies by fictional session. All variants of this session stay in one split.
      const input = { question: q, turns: [{ id: "interviewer", role: "assistant", text: `架空の相談 ${split} ${variant}。${q.title}` }, { id: "respondent", role: "user", text }] };
      await add(rows, manifests[q.id], input, labels, split, `${q.id}_${split}_${index}`, id);
    }
  }
  let seed = 31997; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const split of ["train", "validation", "test"]) for (let i = 0; i < (split === "train" ? 280 : 120); i++) {
    const targets = contextTargets(), labels = Object.fromEntries(targets.map(t => [t.id, i < 12 ? t.labels[i % t.labels.length] : t.labels[Math.floor(random() * t.labels.length)]]));
    const visual = labels.visual_response;
    const camera = visual === "none" ? undefined : { light: visual === "unreliable" ? "dim" : visual === "unknown" ? "unknown" : "bright", clarity: visual === "unknown" ? "unknown" : "clear", material: visual === "material" ? "present" : "absent", face: visual === "patient_wait" ? "brow_tension" : "none", observedAt: Date.now() };
    const text = Object.entries(phrases).map(([key, choices]) => choices[labels[key]]).join("") || "よろしくお願いします。";
    const input = { turns: [{ id: "context", role: "assistant", text: `架空の相談 ${split}。` }, { id: "words", role: "user", text }], camera };
    if (!await add(data.context, contextManifest, input, labels, split, `context_${split}_${i}`, `context_${split}_${i}`)) i--;
  }
  return data;
}
export function trainFictionalBundle(data, options = {}) {
  const questions = Object.fromEntries(survey.questions.map(q => [q.id, { questionKey: questionKey(q), model: trainWeights(manifests[q.id], answerTargets(q), data.questions[q.id], options) }]));
  return { version: 1, questions, context: trainWeights(contextManifest, contextTargets(), data.context, options) };
}
export function fictionalPipeline(bundle, onTrace) { return createFeaturePipeline(survey, bundle, scriptedExtractor, onTrace); }
