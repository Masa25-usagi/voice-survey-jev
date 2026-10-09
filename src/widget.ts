import { SurveyController } from "./controller.js";
import { InterviewSession } from "./interview.js";
import type { Mapper, Analyst, InterviewSnapshot } from "./interview.js";
import { optionsFor } from "./survey.js";
import type { Answer, ProfileConfig, Survey, VoiceConnection, VoiceEvent, VoiceStatus } from "./types.js";
import { DIMENSIONS } from "./dialogue.js";
import type { CameraObservation } from "./dialogue.js";
import { CameraSession } from "./camera.js";
import { ProfileDraft } from "./profile.js";

export interface WidgetModel { key: string; label: string; create: () => VoiceConnection }
export interface WidgetOptions {
  survey: Survey;
  mapper: Mapper;
  analyst?: Analyst;
  models?: WidgetModel[];
  profile?: ProfileConfig;
  cameraObserver?: (jpeg: string, signal: AbortSignal) => Promise<CameraObservation>;
  consentText?: string;
  offline?: boolean;
  onConfirm?: (questionId: string, answer: Answer) => void;
  onComplete?: (answers: Record<string, Answer>) => void;
  onAnalysis?: (analysis: InterviewSnapshot) => void;
}
const labels: Record<string, string> = {
  clear: "理解を明示", needs_help: "やさしい説明を希望", unknown: "未判定", settled: "意見を明示", conditional: "条件あり", uncertain: "迷いを明示",
  enough: "材料が十分", needs_information: "判断材料を希望", declined: "回答を見送り", cost: "費用", time: "時間", accessibility: "使いやすさ・アクセス", quality: "品質・信頼性", other: "ほかの要素",
  brief: "短い説明", example: "身近な例", detailed: "詳しい説明", none: "追加対応なし", comfortable: "安心と発言", concerned: "心配と発言", needs_break: "休憩を希望",
  concrete: "具体的な例あり", general: "一般的な意見", insufficient: "材料が少ない", material: "資料の説明を提示", patient_wait: "急がせず待つ", unreliable: "映像を判断に使わない"
};
const statusLabels: Record<VoiceStatus, string> = { connecting: "接続中", listening: "話しかけてください", "user-speaking": "聞いています", thinking: "考えています", speaking: "話しています", closed: "音声は停止中" };
const observationLabels: Record<string, string> = { bright: "明るい", dim: "暗い", clear: "鮮明", blurred: "不鮮明", present: "資料あり", absent: "資料なし", brow_tension: "眉を寄せた形", smile_shape: "口角が上がった形", hand_near_temple: "こめかみ付近に手", neutral: "目立つ形の変化なし", none: "顔なし", unknown: "未判定" };
const esc = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const CSS = `:host{display:block;color:#15292b;font:16px/1.65 system-ui,sans-serif}*{box-sizing:border-box}.shell{max-width:780px;margin:auto;background:#fff;border:1px solid #cfdddb;border-radius:24px;padding:clamp(18px,4vw,36px)}.eyebrow{font-size:.8rem;letter-spacing:.1em;color:#426561}.meta,.hint{font-size:.88rem;color:#52706d}h2{font-size:clamp(1.3rem,3vw,1.8rem);line-height:1.45;margin:.5rem 0 1.2rem}button,input,select,textarea{font:inherit}button{cursor:pointer;background:#e9f2ef;color:#173c36;border:1px solid #bad0ca;border-radius:12px;padding:10px 16px;min-height:44px}button.primary{background:#185f53;color:white;border-color:#185f53}button:disabled{cursor:default;opacity:.45}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.choices{display:grid;gap:10px}.choice{display:flex;align-items:center;gap:12px;border:1px solid #d5e0dd;padding:12px 16px;border-radius:12px;cursor:pointer;min-height:48px}.choice:has(input:checked){border-color:#267760;background:#eaf5ee}.choice input{width:20px;height:20px;accent-color:#185f53}.candidate{border-left:3px solid #b7803d;background:#fcf8ef;padding:12px 16px;margin:18px 0}.candidate p{margin:0}.voice{border-top:1px solid #dde6e3;padding-top:20px;margin-top:24px}.status{display:inline-block;font-size:.82rem;padding:3px 10px;border-radius:20px;background:#eef2ed}.consent{display:flex;gap:10px;align-items:flex-start;font-size:.86rem;margin:14px 0}.consent input{flex:0 0 auto;width:19px;height:19px;margin-top:5px;accent-color:#185f53}select,textarea{width:100%;max-width:100%;border:1px solid #bed0ca;border-radius:10px;background:#fff;padding:10px}textarea{min-height:110px;resize:vertical}details{margin:18px 0}summary{cursor:pointer;font-weight:600}table{width:100%;border-collapse:collapse;font-size:.85rem;table-layout:fixed}td,th{text-align:left;vertical-align:top;padding:8px 4px;border-bottom:1px solid #e2e9e6;overflow-wrap:anywhere}th:first-child{width:36%}.caption{background:#f4f7f5;padding:10px 14px;font-size:.88rem;overflow-wrap:anywhere}.error{color:#8a3829}.sources a{color:#185f53;overflow-wrap:anywhere}.profile-fields{display:grid;gap:12px;margin:12px 0}video{max-width:100%;width:320px;border-radius:12px;display:block;margin-top:10px}[hidden]{display:none!important}:focus-visible{outline:3px solid #dca957;outline-offset:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.review{border-top:1px solid #e2e9e6;padding:14px 0}`;

export class SurveyWidget {
  readonly controller: SurveyController;
  readonly profile?: ProfileDraft;
  #container: HTMLElement;
  #root: ShadowRoot;
  #body: HTMLElement;
  #video: HTMLVideoElement;
  #options: WidgetOptions;
  #session?: InterviewSession;
  #state: InterviewSnapshot = { turns: [] };
  #voice?: VoiceConnection;
  #abort?: AbortController;
  #camera?: CameraSession;
  #cameraRunning = false;
  #cameraConsent = false;
  #modelKey?: string;
  #voiceConsent = false;
  #intro = false;
  #phase: "profile" | "survey" = "survey";
  #introDone = false;
  #profileWords: string[] = [];
  #profilePending: { field: string; value: string; evidence: string }[] = [];
  #status: VoiceStatus = "closed";
  #running = false;
  #error = "";
  #playbackBlocked = false;
  #caption = "";
  #sourcesOpen = false;
  #completed = false;
  #generation = 0;
  #fixtureId = 0;
  #unsubscribe: () => void;
  #onHide: () => void;
  #onPageHide: () => void;
  constructor(container: HTMLElement, options: WidgetOptions) {
    if (typeof options.mapper !== "function") throw new Error("An answer mapper is required");
    this.#options = options; this.#container = container; this.controller = new SurveyController(options.survey);
    if (options.profile) this.profile = new ProfileDraft(options.profile);
    const mount = document.createElement("div"); container.append(mount); this.#root = mount.attachShadow({ mode: "open" });
    this.#root.innerHTML = `<style>${CSS}</style><section class="shell" aria-label="音声アンケート"><div id="content"></div><div id="camera" hidden><video aria-label="カメラのプレビュー" muted playsinline></video></div></section>`;
    this.#body = this.#root.querySelector("#content")!; this.#video = this.#root.querySelector("video")!;
    this.#modelKey = options.models?.[0]?.key; this.#unsubscribe = this.controller.subscribe(() => this.#render());
    if (options.offline) this.#newSession();
    this.#onHide = () => { if (document.visibilityState === "hidden") this.stop(); }; this.#onPageHide = () => this.stop();
    document.addEventListener("visibilitychange", this.#onHide); window.addEventListener("pagehide", this.#onPageHide);
    this.#render();
  }
  get root(): ShadowRoot { return this.#root; }
  get analysis(): InterviewSnapshot { return structuredClone(this.#state); }
  #newSession(): void {
    this.#session?.stop(); this.#session = new InterviewSession(this.controller, { mapper: this.#options.mapper, analyst: this.#options.analyst, onChange: state => { this.#state = state; this.#options.onAnalysis?.(state); this.#render(); } });
  }
  #answerText(answer: Answer): string {
    if (answer.kind === "skip") return answer.reason === "insufficient" ? "判断材料が足りないので見送り" : "今回は見送り";
    const q = this.controller.question;
    if (q.type === "text") return String(answer.value);
    const values = Array.isArray(answer.value) ? answer.value : [answer.value];
    return values.map(v => optionsFor(q).find(o => q.type === "scale" ? Number(o.meaning) === v : o.id === v)?.label ?? String(v)).join("、");
  }
  #render(): void {
    if (!this.#body) return;
    const focused = this.#root.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const focusKey = focused?.dataset.focus; const selection = focused instanceof HTMLTextAreaElement ? [focused.selectionStart, focused.selectionEnd] : undefined;
    const analysisOpen = this.#body.querySelector<HTMLDetailsElement>("details.analysis")?.open ?? false;
    const profileOpen = this.#body.querySelector<HTMLDetailsElement>("details.profile")?.open ?? false;
    const snap = this.controller.snapshot, q = snap.question, draft = snap.row.draft;
    const choices = q.type === "text" ? `<textarea data-focus="answer-text" id="answer-text" aria-label="回答" maxlength="${q.maxLength ?? 2000}">${esc(draft?.kind === "value" ? draft.value : "")}</textarea>`
      : `<div class="choices" role="group" aria-label="回答の選択肢">${optionsFor(q).map(o => {
        const value = q.type === "scale" ? Number(o.meaning) : o.id;
        const selected = draft?.kind === "value" && (Array.isArray(draft.value) ? draft.value.includes(o.id) : draft.value === value);
        return `<label class="choice"><input data-focus="option-${esc(o.id)}" type="${q.type === "multiple" ? "checkbox" : "radio"}" name="answer" value="${esc(o.id)}" ${selected ? "checked" : ""}><span>${esc(o.label)}</span></label>`;
      }).join("")}</div>`;
    const profileFields = this.profile ? `<div class="profile-fields">${this.profile.config.fields.map(f => `<label>${esc(f.label)}<select data-profile="${esc(f.id)}" data-focus="profile-${esc(f.id)}"><option value="">答えない</option>${f.options.map(o => `<option value="${esc(o.id)}" ${this.profile!.values[f.id] === o.id ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`).join("")}</div><button id="profile-reset">希望をリセット</button>` : "";
    const findings = this.#state.analysis, observation = this.#state.camera;
    this.#body.innerHTML = this.#completed ? `<p class="eyebrow">完了</p><h2>回答を確認しました</h2><p>確定した回答をアンケートへ渡しました。</p>${Object.entries(snap.confirmed).map(([id, answer]) => `<div class="review"><strong>${esc(this.controller.survey.questions.find(q => q.id === id)?.title)}</strong><p>${esc(answer.kind === "skip" ? "見送り" : Array.isArray(answer.value) ? answer.value.join("、") : answer.value)}</p><button data-review="${esc(id)}">この回答を見直す</button></div>`).join("")}<button id="reset">最初からやり直す</button>` : `
      <p class="eyebrow">${esc(this.controller.survey.title)}</p><p class="meta">${snap.visibleIds.indexOf(q.id) + 1} / ${snap.visibleIds.length} 問</p>
      ${this.#phase === "profile" ? `<h2>話し方の希望を伝えられます</h2><p>すべて任意です。画面で訂正でき、答えずに質問へ進めます。</p>${profileFields}<div class="actions"><button class="primary" id="intro-finish">この希望で質問へ</button><button id="intro-skip">希望を伝えず質問へ</button></div>` : `<h2>${esc(q.title)}</h2>${q.explanation ? `<details><summary>質問の意味を読む</summary><p>${esc(q.explanation)}</p></details>` : ""}${choices}
      ${draft ? `<div class="candidate"><p>${snap.row.confirmed ? "確定済み" : snap.row.source === "ai" ? this.#options.offline ? "架空のAI候補（未確定）" : "Jevの候補（未確定）" : "あなたが選んだ回答（未確定）"}：<strong>${esc(this.#answerText(draft))}</strong></p>${snap.row.proposal ? `<p class="hint">確信度 ${Math.round(snap.row.proposal.confidence * 100)}%（正解率ではありません）</p>` : ""}</div>` : `<p class="hint">候補を選ぶか、会話で考えを伝えてください。確定はあなたの操作で行います。</p>`}
      <div class="actions"><button id="back" ${snap.visibleIds.indexOf(q.id) === 0 ? "disabled" : ""}>戻る</button><button class="primary" id="confirm" ${!draft ? "disabled" : ""}>${snap.visibleIds.at(-1) === q.id ? "この回答で完了" : "この回答で次へ"}</button><button id="skip">今回は見送る</button>${snap.row.source === "manual" ? `<button id="allow-ai">AI候補を再び使う</button>` : ""}</div>
      ${q.sources?.length ? `<details class="sources" ${this.#sourcesOpen ? "open" : ""}><summary>参考資料</summary>${q.sources.map(s => `<p><strong>${esc(s.title)}</strong> · ${esc(s.publisher)}<br>${esc(s.text)}${s.url ? `<br><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">資料を開く</a>` : ""}</p>`).join("")}</details>` : ""}`}
      ${this.#options.offline ? `<p class="hint">架空のオフラインデモです。マイク・カメラ・外部APIは使いません。</p>` : this.#options.models?.length ? `<div class="voice"><span class="status" role="status">${statusLabels[this.#status]}</span><label class="hint">話すAI<select id="model" data-focus="model">${this.#options.models.map(m => `<option value="${esc(m.key)}" ${m.key === this.#modelKey ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></label>
      ${this.profile && !this.#introDone ? `<label class="consent"><input type="checkbox" id="intro" ${this.#intro ? "checked" : ""}>最初に音声で話し方の希望を伝える（任意）</label>` : ""}
      <label class="consent"><input type="checkbox" id="consent" ${this.#voiceConsent ? "checked" : ""}>${esc(this.#options.consentText ?? "音声を選択したAI提供元へ、文字起こしをTypeSafeへ送り、回答候補と会話分析を作ることに同意します。")}</label>
      <div class="actions"><button class="primary" id="start" ${!this.#voiceConsent || this.#running ? "disabled" : ""}>AIと話す</button><button id="stop" ${!this.#running ? "disabled" : ""}>音声を止める</button>${this.#playbackBlocked ? `<button id="play">音声を再生する</button>` : ""}</div></div>` : ""}
      ${this.profile && this.#phase !== "profile" ? `<details class="profile" ${profileOpen ? "open" : ""}><summary>話し方の希望（任意）</summary>${profileFields}</details>` : ""}
      ${this.#caption ? `<p class="caption">${esc(this.#caption)}</p>` : ""}
      ${this.#error || this.#state.error ? `<p class="error" role="status">${esc(this.#error || "分析を取得できません。手動で回答できます。")}</p>` : ""}
      <details class="analysis" ${analysisOpen ? "open" : ""}><summary>会話の分析を見る</summary><p class="hint">確信度は正解率ではありません。映像から回答や気持ちを決めません。</p>${findings ? `<table><thead><tr><th>項目</th><th>候補</th><th>確信度</th></tr></thead><tbody>${Object.entries(DIMENSIONS).map(([key, d]) => {
        const f = findings.findings[key as keyof typeof DIMENSIONS]; return `<tr><th>${esc(d.label)}<br><span class="hint">${f.basis === "camera_observation" ? "映像の観察" : "本人の言葉"}</span></th><td>${esc(labels[f.value] ?? f.value)}${f.reliable ? "" : "（未確定）"}</td><td>${Math.round(f.confidence * 100)}%</td></tr>`;
      }).join("")}</tbody></table><p class="hint">分析時刻 ${esc(new Date(findings.analyzedAt).toLocaleTimeString())}${findings.latencyMs !== undefined ? ` · ${Math.round(findings.latencyMs)} ms` : ""} · ${esc(findings.model)}</p><p class="hint">次の返答への対応：${findings.shared ? this.#options.offline ? "共有済み（デモ）" : "共有済み" : "会話の区切りで共有待ち"}。共有は送信成功を示します。</p><p class="caption">参照した本人の発言：${esc(findings.lastUserText)}</p>` : `<p class="hint">会話が入ると分析を表示します。</p>`}
      ${observation ? `<p class="caption">カメラの観察：${esc([observation.light, observation.clarity, observation.material, observation.face].map(v => observationLabels[v] ?? "未判定").join(" / "))}。気持ちや回答の診断ではありません。</p>` : ""}
      ${this.#options.cameraObserver ? `<label class="consent"><input id="camera-consent" type="checkbox" ${this.#cameraConsent ? "checked" : ""}>カメラの静止画を画像分析の提供元へ送り、見え方と観察項目を会話の補助に使うことに同意します。</label><div class="actions"><button id="camera-start" ${!this.#cameraConsent || !this.#running || this.#cameraRunning || this.#phase === "profile" ? "disabled" : ""}>カメラを使う</button><button id="camera-stop" ${!this.#cameraRunning ? "disabled" : ""}>カメラを止める</button></div>` : ""}</details>`;
    this.#events();
    if (focusKey) { const next = this.#body.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`); next?.focus({ preventScroll: true }); if (selection && next instanceof HTMLTextAreaElement) next.setSelectionRange(selection[0]!, selection[1]!); }
  }
  #events(): void {
    const on = (id: string, fn: () => void) => this.#body.querySelector(`#${id}`)?.addEventListener("click", fn);
    const check = (id: string, fn: (checked: boolean) => void) => this.#body.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener("change", e => fn((e.target as HTMLInputElement).checked));
    for (const input of this.#body.querySelectorAll<HTMLInputElement>("input[name=answer]")) input.addEventListener("change", () => {
      const q = this.controller.question;
      if (q.type === "multiple") { const selected = Array.from(this.#body.querySelectorAll<HTMLInputElement>("input[name=answer]:checked")).map(i => i.value); if (!selected.length) this.controller.clearSelection(); else { try { this.controller.select(selected); } catch { this.#error = "選べる数を超えています。"; this.#render(); } } }
      else this.controller.select(q.type === "scale" ? Number(optionsFor(q).find(o => o.id === input.value)!.meaning) : input.value);
    });
    this.#body.querySelector<HTMLTextAreaElement>("#answer-text")?.addEventListener("input", e => { const value = (e.target as HTMLTextAreaElement).value; if (value.trim()) this.controller.select(value); else this.controller.clearSelection(); });
    on("confirm", () => this.#confirm()); on("skip", () => { this.controller.skip(); this.#confirm(); });
    on("back", () => { const ids = this.controller.visibleIds; this.#navigate(ids[ids.indexOf(this.controller.question.id) - 1]!); });
    on("allow-ai", () => this.controller.allowSuggestions());
    on("start", () => void this.start()); on("stop", () => this.stop());
    check("consent", value => { this.#voiceConsent = value; if (!value) this.stop(); this.#render(); }); check("intro", value => { this.#intro = value; this.#render(); });
    this.#body.querySelector<HTMLSelectElement>("#model")?.addEventListener("change", e => { this.#modelKey = (e.target as HTMLSelectElement).value; const restart = this.#running; this.stop(); if (restart) void this.start(); });
    for (const select of this.#body.querySelectorAll<HTMLSelectElement>("select[data-profile]")) select.addEventListener("change", () => { if (select.value) this.profile?.set(select.dataset.profile!, select.value); else { const kept = this.profile?.values ?? {}; delete kept[select.dataset.profile!]; this.profile?.reset(); for (const [k, v] of Object.entries(kept)) this.profile?.set(k, v); } this.#render(); });
    on("profile-reset", () => { this.profile?.reset(); this.#profilePending = []; this.#render(); });
    on("intro-finish", () => this.#finishIntro(false)); on("intro-skip", () => this.#finishIntro(true));
    check("camera-consent", value => { this.#cameraConsent = value; if (!value) this.#stopCamera(); this.#render(); });
    on("camera-start", () => void this.#startCamera()); on("camera-stop", () => { this.#stopCamera(); this.#render(); });
    on("play", () => void this.#voice?.resumePlayback?.().then(() => { this.#playbackBlocked = false; this.#render(); }).catch(() => {}));
    on("reset", () => { this.stop(); this.controller.reset(); this.profile?.reset(); this.#completed = false; this.#introDone = false; if (this.#options.offline) this.#newSession(); this.#render(); });
    for (const button of this.#body.querySelectorAll<HTMLButtonElement>("button[data-review]")) button.addEventListener("click", () => { this.#completed = false; this.#navigate(button.dataset.review!); });
  }
  #confirm(): void {
    const id = this.controller.question.id, answer = this.controller.confirm(); this.#options.onConfirm?.(id, answer);
    this.#container.dispatchEvent(new CustomEvent("voice-survey-confirm", { detail: { questionId: id, answer }, bubbles: true }));
    const wasRunning = this.#running;
    if (this.controller.next()) { this.stop(); if (this.#options.offline) this.#newSession(); else if (wasRunning) void this.start(); }
    else { this.stop(); this.#completed = true; const answers = this.controller.confirmedAnswers(); this.#options.onComplete?.(answers); this.#container.dispatchEvent(new CustomEvent("voice-survey-complete", { detail: answers, bubbles: true })); }
    this.#render();
  }
  #navigate(id: string): void {
    const wasRunning = this.#running; this.stop(); this.controller.goTo(id); this.#sourcesOpen = false;
    if (this.#options.offline) this.#newSession(); else if (wasRunning) void this.start(); this.#render();
  }
  #finishIntro(skip: boolean): void {
    if (skip) this.profile?.reset(); this.#introDone = true; this.#phase = "survey"; const restart = this.#running; this.stop(); if (restart) void this.start(); this.#render();
  }
  async start(): Promise<void> {
    if (!this.#voiceConsent || !this.#modelKey || this.#completed || this.#options.offline) return;
    const model = this.#options.models?.find(m => m.key === this.#modelKey); if (!model) return;
    this.stop(); const generation = ++this.#generation; this.#running = true; this.#error = ""; this.#status = "connecting";
    this.#phase = this.#intro && !this.#introDone && this.profile ? "profile" : "survey";
    const context = this.controller.reconnect(); const voice = model.create(); this.#voice = voice; const ac = new AbortController(); this.#abort = ac;
    if (this.#phase === "survey") { this.#newSession(); this.#session?.attachVoice(voice); }
    this.#render();
    try {
      await voice.connect(context, this.controller.question, this.profile?.speakingPreferences() ?? {}, event => { if (generation === this.#generation) this.#voiceEvent(event); }, ac.signal, this.#phase === "profile" ? this.profile?.config : undefined);
      if (generation === this.#generation) voice.speakQuestion();
    } catch { if (generation === this.#generation) { this.stop(); this.#error = "音声を開始できません。手動で回答できます。"; this.#render(); } }
  }
  #voiceEvent(event: VoiceEvent): void {
    if (event.type === "status") { this.#status = event.status; this.#session?.voiceStatus(event.status); }
    if (event.type === "transcript" && this.controller.matches(event.transcript.context)) {
      this.#caption = `${event.transcript.role === "user" ? "あなた" : "聞き手"}：${event.transcript.text.slice(-800)}`;
      if (this.#phase === "profile") {
        if (event.transcript.final && event.transcript.role === "user") { this.#profileWords.push(event.transcript.text.slice(-8000)); this.#profileWords = this.#profileWords.slice(-10); this.#applyProfile(); }
      } else this.#session?.ingest(event.transcript);
    }
    if (event.type === "sources") this.#sourcesOpen = true;
    if (event.type === "profile" && this.#phase === "profile") { this.#profilePending.push(event); this.#profilePending = this.#profilePending.slice(-10); this.#applyProfile(); }
    if (event.type === "error") {
      this.#error = event.code === "playback_blocked" ? "音声の再生ボタンを押してください。" : "音声接続を続けられません。手動で回答できます。";
      this.#playbackBlocked = event.code === "playback_blocked";
      if (!this.#playbackBlocked) queueMicrotask(() => this.stop());
    }
    this.#render();
  }
  #applyProfile(): void { this.#profilePending = this.#profilePending.filter(p => !this.profile?.suggest(p.field, p.value, p.evidence, this.#profileWords)); }
  async #startCamera(): Promise<void> {
    if (!this.#cameraConsent || !this.#running || this.#phase === "profile" || !this.#options.cameraObserver) return;
    this.#camera = new CameraSession(this.#video, { observe: this.#options.cameraObserver, onObservation: observation => this.#session?.setCamera(observation), onError: () => { if (!this.#camera?.active) { this.#cameraRunning = false; this.#root.querySelector<HTMLElement>("#camera")!.hidden = true; } this.#error = "映像の観察を取得できません。音声や手動回答は続けられます。"; this.#render(); } });
    this.#cameraRunning = true; this.#root.querySelector<HTMLElement>("#camera")!.hidden = false; this.#render(); await this.#camera.start(true);
  }
  #stopCamera(): void { this.#camera?.stop(); this.#camera = undefined; this.#cameraRunning = false; this.#root.querySelector<HTMLElement>("#camera")!.hidden = true; }
  stop(): void {
    this.#generation++; this.#running = false; this.#abort?.abort(); this.#voice?.disconnect(); this.#voice = undefined; this.#session?.stop(); this.#session = undefined;
    this.#stopCamera(); this.#state = { turns: [] }; this.#profileWords = []; this.#profilePending = []; this.#caption = ""; this.#status = "closed";
    this.controller.invalidate(); this.#render();
  }
  /** Synthetic fixtures only. Live widgets deliberately do not accept injected speech. */
  injectTranscript(role: "user" | "assistant", text: string, id = `fixture_${++this.#fixtureId}`): boolean {
    if (!this.#options.offline || this.#completed) return false; if (!this.#session) this.#newSession();
    return this.#session!.ingest({ id, role, text, final: true, context: this.controller.context });
  }
  setDemoObservation(observation?: CameraObservation): void { if (this.#options.offline) this.#session?.setCamera(observation); }
  attachDemoVoice(voice: VoiceConnection): void { if (this.#options.offline) { this.#session?.attachVoice(voice); this.#session?.voiceStatus("listening"); } }
  destroy(): void { this.stop(); this.profile?.reset(); this.#unsubscribe(); document.removeEventListener("visibilitychange", this.#onHide); window.removeEventListener("pagehide", this.#onPageHide); this.#root.host.remove(); }
}
export function mountVoiceSurvey(container: HTMLElement, options: WidgetOptions): SurveyWidget { return new SurveyWidget(container, options); }
/** Optional native custom element. Set its options property from your application. */
export function defineVoiceSurveyElement(tag = "voice-survey"): void {
  if (customElements.get(tag)) return;
  class VoiceSurveyElement extends HTMLElement {
    #options?: WidgetOptions;
    #widget?: SurveyWidget;
    set options(options: WidgetOptions) { this.#options = options; this.#widget?.destroy(); this.#widget = this.isConnected ? mountVoiceSurvey(this, options) : undefined; }
    get widget(): SurveyWidget | undefined { return this.#widget; }
    connectedCallback(): void { if (this.#options && !this.#widget) this.#widget = mountVoiceSurvey(this, this.#options); }
    disconnectedCallback(): void { this.#widget?.destroy(); this.#widget = undefined; }
  }
  customElements.define(tag, VoiceSurveyElement);
}
