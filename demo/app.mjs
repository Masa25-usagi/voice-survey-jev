import { mountVoiceSurvey } from "../dist/widget.js";
import { bindForm, createCameraObserver, createSessionStarter, speakingProfile } from "../dist/index.js";
import { GeminiVoice, OpenAIVoice } from "../dist/providers/index.js";
import { survey, scripts } from "./survey.mjs";
import { fictionalDatasets, trainFictionalBundle, fictionalPipeline } from "./features.mjs";
import { createHttpFeatureAnalysis, evaluateTest } from "../dist/features/index.js";
const config = await fetch("/demo-config", { cache: "no-store" }).then(r => r.json());
const live = !config.offline;
const startSession = createSessionStarter();
const data = live ? undefined : await fictionalDatasets();
let bundle = data ? trainFictionalBundle(data, { l2: 0.025 }) : undefined;
const traces = {}, target = document.querySelector("#trace-target");
let finalTestOpened = false;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function renderTrace() {
  const trace = traces[document.querySelector("#trace-kind").value];
  const selected = target.value;
  target.replaceChildren(...(trace?.predictions ?? []).map(p => { const o = document.createElement("option"); o.value = p.target; o.textContent = p.target; return o; }));
  if ([...target.options].some(o => o.value === selected)) target.value = selected;
  const prediction = trace?.predictions.find(p => p.target === target.value), container = document.querySelector("#feature-trace");
  if (!prediction) { container.innerHTML = "<p>上の発言例を押すと、各特徴と重みを表示します。</p>"; return; }
  container.innerHTML = `<p>直前の計算 ${esc(new Date(trace.extractedAt).toLocaleTimeString())} · ${esc(trace.manifestId)} · ${trace.features.values.length} 次元 · ${trace.source === "scripted" ? "架空の特徴スコア" : esc(trace.jevModel)}</p><p>最大の候補：<strong>${esc(prediction.label)}</strong> · 候補スコア ${(100 * prediction.score).toFixed(1)}% · ${prediction.accepted ? "確認へ進める候補" : "見送り（しきい値または差が不足）"}</p><div class="scores">${Object.entries(prediction.scores).map(([label, value]) => `<div><span>${esc(label)}</span><meter min="0" max="1" value="${value}" aria-label="${esc(label)} の候補スコア"></meter><span>${(value * 100).toFixed(1)}%</span></div>`).join("")}</div><p>重み付きの和 ${prediction.logit.toFixed(3)} = バイアス ${prediction.bias.toFixed(3)} + 各特徴の寄与。全候補の和から候補スコアを計算します。</p><div class="table-wrap"><table><thead><tr><th>測定する特徴</th><th>スコア<br>0〜1</th><th>重み</th><th>寄与</th></tr></thead><tbody>${prediction.contributions.map((c, i) => `<tr><th>${esc(c.label)}</th><td>${c.value.toFixed(2)}<br><small>分布の幅 ${trace.features.uncertainty[i].toFixed(2)}</small></td><td>${c.weight.toFixed(3)}</td><td class="${c.contribution < 0 ? "negative" : "positive"}">${c.contribution.toFixed(3)}</td></tr>`).join("")}</tbody></table></div><p class="note">寄与 = 学習データで標準化したスコア × この候補の重み。候補スコアとJevの確信度は別の値です。</p>`;
}
function onTrace(trace) { traces[trace.kind] = trace; renderTrace(); }
let pipeline = bundle ? fictionalPipeline(bundle, onTrace) : undefined;
const analysis = live ? createHttpFeatureAnalysis(undefined, onTrace) : { mapper: input => pipeline.mapper(input), analyst: input => pipeline.analyst(input) };
const form = document.querySelector("#host-form");
const feedback = document.querySelector("#feedback");
let feedbackCount = 0;
const demoVoice = { connect: async () => {}, updateContext: () => { feedbackCount++; feedback.textContent = `次の返答へ説明方法を共有しました（架空の送信 ${feedbackCount} 回）。`; return true; }, speakQuestion() {}, setRevision() {}, disconnect() {} };
const widget = mountVoiceSurvey(document.querySelector("#survey"), {
  survey, ...analysis, offline: !live, profile: speakingProfile, candidateLabel: "重み付きモデルの候補（未確定）", scoreLabel: "候補スコア",
  onAnalysis: state => { if (!state.turns.length) { delete traces.answer; delete traces.context; renderTrace(); } },
  models: config.models.map(model => ({ key: model.key, label: model.label, create: () => model.provider === "gemini" ? new GeminiVoice({ startSession, modelKey: model.key, workletUrl: "/dist/capture-worklet.js" }) : new OpenAIVoice({ startSession, modelKey: model.key }) })),
  cameraObserver: config.camera ? createCameraObserver() : undefined,
  onComplete: () => { document.querySelector("#host-status").textContent = "確定した回答だけが下のフォームに入りました。フォームは送信していません。"; }
});
bindForm(widget.controller, form, { schedule: { name: "schedule" }, activities: { name: "activities" }, pace: { name: "pace" }, idea: { name: "idea" } });
form.addEventListener("submit", e => { e.preventDefault(); document.querySelector("#host-status").textContent = "送信しないデモです。入力した回答はこの画面のメモリだけにあります。"; });
document.querySelector("#fixtures").hidden = live;
document.querySelector("#mode").textContent = live ? "特徴スコア版 · 設定したAPIと学習済みの重み" : "特徴スコア版 · オフラインの実験";
function inject(text) { widget.attachDemoVoice(demoVoice); widget.injectTranscript("user", text); }
document.querySelector("#replay").addEventListener("click", () => { const script = scripts[widget.controller.question.id]; widget.attachDemoVoice(demoVoice); widget.injectTranscript("assistant", script.assistant); widget.injectTranscript("user", script.user); });
document.querySelector("#explain").addEventListener("click", () => inject("少し難しいので、短い身近な例で説明してください。"));
document.querySelector("#correction").addEventListener("click", () => inject("さっきの希望を訂正して、平日の夕方に変えたいです。"));
document.querySelector("#unknown").addEventListener("click", () => inject("判断材料が足りないので、今回は決められません。"));
document.querySelector("#material").addEventListener("click", () => { widget.attachDemoVoice(demoVoice); widget.setDemoObservation({ light: "bright", clarity: "clear", material: "present", face: "none", observedAt: Date.now() }); });
// The in-memory demo handle is also convenient for embedding experiments.
window.demoSurvey = widget;
widget.controller.subscribe(snapshot => { if (traces.answer?.questionId !== snapshot.context.questionId) { delete traces.answer; delete traces.context; renderTrace(); } });
document.querySelector("#trace-kind").addEventListener("change", renderTrace);
target.addEventListener("change", renderTrace);
document.querySelector("#training-controls").hidden = live;
function trainingReport() {
  if (!bundle) return;
  if (finalTestOpened) return;
  const id = widget.controller.question.id, model = bundle.questions[id].model;
  document.querySelector("#training-status").textContent = `この質問：${model.manifest.dimensions.length} 次元。学習 ${model.training.train} 件、調整 ${model.training.validation} 件、最終テスト ${model.training.test} 件（未開封）。L2 ${model.training.l2}。すべて架空データです。`;
  document.querySelector("#validation-result").textContent = `調整データでの計算確認：${Object.entries(model.validation).map(([key, m]) => `${key} 一致 ${(m.accuracy * 100).toFixed(1)}% / 候補を出す割合 ${(m.coverage * 100).toFixed(1)}%`).join("、")}。実Jevの性能は未測定です。`;
}
widget.controller.subscribe(trainingReport); trainingReport();
document.querySelector("#fit").addEventListener("click", async () => {
  const button = document.querySelector("#fit"); button.disabled = true; document.querySelector("#training-status").textContent = "学習用データだけで重みを計算しています…";
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try { bundle = trainFictionalBundle(data, { l2: Number(document.querySelector("#regularization").value) }); pipeline = fictionalPipeline(bundle, onTrace); delete traces.answer; delete traces.context; widget.stop(); widget.controller.clearProposal(); renderTrace(); trainingReport(); }
  catch { document.querySelector("#training-status").textContent = "学習に失敗しました。データと設定を確認してください。"; }
  finally { button.disabled = false; }
});
document.querySelector("#final-test").addEventListener("click", () => {
  const reports = Object.entries(bundle.questions).map(([id, item]) => [id, evaluateTest(item.model, data.questions[id])]);
  const context = evaluateTest(bundle.context, data.context);
  finalTestOpened = true;
  document.querySelector("#test-result").textContent = "架空特徴での最終テスト：" + [...reports, ["context", context]].map(([id, report]) => `${id}: ${Object.entries(report).map(([key, m]) => `${key} ${(m.accuracy * 100).toFixed(1)}%`).join(" / ")}`).join("、") + "。重みは変更していません。このデータは実Jevの精度を示しません。";
  document.querySelector("#final-test").disabled = true; document.querySelector("#fit").disabled = true; document.querySelector("#regularization").disabled = true;
  document.querySelector("#training-status").textContent = "最終テストを開いたため、この実験の重みを固定しました。会話例と特徴の確認は引き続き試せます。";
});
function download(value, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
document.querySelector("#export-model").addEventListener("click", () => download(bundle, "fictional-feature-bundle.json"));
document.querySelector("#export-manifest").addEventListener("click", () => download(bundle.questions[widget.controller.question.id].model.manifest, "fictional-feature-manifest.json"));
renderTrace();
