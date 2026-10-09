import { mountVoiceSurvey } from "../dist/widget.js";
import { bindForm, createCameraObserver, createHttpAnalysis, createSessionStarter, speakingProfile } from "../dist/index.js";
import { GeminiVoice, OpenAIVoice } from "../dist/providers/index.js";
import { survey, scripts } from "./survey.mjs";
import { offlineMapper, offlineAnalyst } from "./offline.mjs";
const config = await fetch("/demo-config", { cache: "no-store" }).then(r => r.json());
const live = !config.offline;
const startSession = createSessionStarter();
const analysis = live ? createHttpAnalysis() : { mapper: offlineMapper, analyst: offlineAnalyst };
const form = document.querySelector("#host-form");
const feedback = document.querySelector("#feedback");
let feedbackCount = 0;
const demoVoice = { connect: async () => {}, updateContext: () => { feedbackCount++; feedback.textContent = `次の返答へ説明方法を共有しました（架空の送信 ${feedbackCount} 回）。`; return true; }, speakQuestion() {}, setRevision() {}, disconnect() {} };
const widget = mountVoiceSurvey(document.querySelector("#survey"), {
  survey, ...analysis, offline: !live, profile: speakingProfile,
  models: config.models.map(model => ({ key: model.key, label: model.label, create: () => model.provider === "gemini" ? new GeminiVoice({ startSession, modelKey: model.key, workletUrl: "/dist/capture-worklet.js" }) : new OpenAIVoice({ startSession, modelKey: model.key }) })),
  cameraObserver: config.camera ? createCameraObserver() : undefined,
  onComplete: () => { document.querySelector("#host-status").textContent = "確定した回答だけが下のフォームに入りました。フォームは送信していません。"; }
});
bindForm(widget.controller, form, { schedule: { name: "schedule" }, activities: { name: "activities" }, pace: { name: "pace" }, idea: { name: "idea" } });
form.addEventListener("submit", e => { e.preventDefault(); document.querySelector("#host-status").textContent = "送信しないデモです。入力した回答はこの画面のメモリだけにあります。"; });
document.querySelector("#fixtures").hidden = live;
document.querySelector("#mode").textContent = live ? "利用者が設定したAPIへ接続するモード" : "オフライン · 架空の会話と回答";
function inject(text) { widget.attachDemoVoice(demoVoice); widget.injectTranscript("user", text); }
document.querySelector("#replay").addEventListener("click", () => { const script = scripts[widget.controller.question.id]; widget.attachDemoVoice(demoVoice); widget.injectTranscript("assistant", script.assistant); widget.injectTranscript("user", script.user); });
document.querySelector("#explain").addEventListener("click", () => inject("少し難しいので、短い身近な例で説明してください。"));
document.querySelector("#correction").addEventListener("click", () => inject("さっきの希望を訂正して、平日の夕方に変えたいです。"));
document.querySelector("#unknown").addEventListener("click", () => inject("判断材料が足りないので、今回は決められません。"));
document.querySelector("#material").addEventListener("click", () => { widget.attachDemoVoice(demoVoice); widget.setDemoObservation({ light: "bright", clarity: "clear", material: "present", face: "none", observedAt: Date.now() }); });
// The in-memory demo handle is also convenient for embedding experiments.
window.demoSurvey = widget;
