import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveCallbacks, LiveConnectConfig, LiveServerMessage, Session } from "@google/genai";
import { copy, isRecord } from "../types.js";
import type { Context, ProfileConfig, Question, SpeakingPreferences, VoiceConnection, VoiceEvent, VoiceStatus } from "../types.js";
import type { SessionStarter } from "../http.js";
import { BrowserAudioIO } from "./audio.js";
import type { AudioIO } from "./audio.js";

export interface GeminiVoiceOptions {
  startSession: SessionStarter;
  modelKey: string;
  getMicrophone?: () => Promise<MediaStream>;
  createAudioIO?: (onIdle: () => void) => AudioIO;
  connectLive?: (token: string, model: string, config: LiveConnectConfig, callbacks: LiveCallbacks) => Promise<Session>;
  timeoutMs?: number;
  workletUrl?: string;
}
interface CaptionBuffer { id: string; text: string; context: Context; closed: boolean }
export class GeminiVoice implements VoiceConnection {
  #options: GeminiVoiceOptions;
  #session?: Session;
  #stream?: MediaStream;
  #io?: AudioIO;
  #ac?: AbortController;
  #removeAbort?: () => void;
  #context?: Context;
  #emit?: (event: VoiceEvent) => void;
  #generation = 0;
  #captionId = 0;
  #captions = new Map<"user" | "assistant", CaptionBuffer>();
  #modelActive = false;
  #status: VoiceStatus = "closed";
  constructor(options: GeminiVoiceOptions) { this.#options = options; }
  #statusEvent(status: VoiceStatus): void { this.#status = status; this.#emit?.({ type: "status", status }); }
  #idle(): void { if (!this.#io?.busy && !this.#modelActive && this.#session) this.#statusEvent("listening"); }
  async connect(context: Context, question: Question, preferences: SpeakingPreferences, emit: (event: VoiceEvent) => void, signal: AbortSignal, profile?: ProfileConfig): Promise<void> {
    this.disconnect(); const generation = ++this.#generation;
    this.#context = copy(context); this.#emit = emit; const ac = new AbortController(); this.#ac = ac;
    const abort = () => this.disconnect(); signal.addEventListener("abort", abort, { once: true }); this.#removeAbort = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) { this.disconnect(); throw new Error("Connection cancelled"); }
    ac.signal.addEventListener("abort", () => { if (generation === this.#generation) this.disconnect(); }, { once: true });
    const timer = setTimeout(() => ac.abort(), this.#options.timeoutMs ?? 15000);
    const active = () => generation === this.#generation && !ac.signal.aborted;
    const check = () => { if (!active()) throw new Error("Connection cancelled"); };
    this.#statusEvent("connecting");
    try {
      const io = (this.#options.createAudioIO ?? (onIdle => new BrowserAudioIO(onIdle, this.#options.workletUrl)))(() => { if (active()) this.#idle(); });
      this.#io = io; await io.activate(); check();
      const stream = await (this.#options.getMicrophone ?? (() => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })))();
      if (!active()) { stream.getTracks().forEach(t => t.stop()); check(); } this.#stream = stream;
      const response = await this.#options.startSession({ context, question, preferences, profile, modelKey: this.#options.modelKey, signal: ac.signal }); check();
      if (response.provider !== "gemini" || !response.token.startsWith("auth_tokens/")) throw new Error("Invalid session");
      const connectLive = this.#options.connectLive ?? ((token, model, config, callbacks) => new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1beta" } }).live.connect({ model, config, callbacks }));
      const session = await connectLive(response.token, response.model, { abortSignal: ac.signal, responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {} }, {
        onmessage: message => { if (active()) this.#message(message); },
        onerror: () => { if (active()) { emit({ type: "error", code: "provider_error" }); this.disconnect(); } },
        onclose: () => { if (active()) { emit({ type: "error", code: "connection_lost" }); this.disconnect(); } }
      });
      if (!active()) { session.close(); check(); } this.#session = session;
      await io.capture(stream, audio => { if (active()) { try { session.sendRealtimeInput({ audio: { data: audio, mimeType: "audio/pcm;rate=16000" } }); } catch { emit({ type: "error", code: "connection_lost" }); this.disconnect(); } } });
      check(); this.#statusEvent("listening");
    } catch { if (generation === this.#generation) { emit({ type: "error", code: "connection_unavailable" }); this.disconnect(); } throw new Error("Voice connection unavailable"); }
    finally { clearTimeout(timer); }
  }
  #caption(role: "user" | "assistant", text: string, final: boolean): void {
    if (!text) return;
    let buffer = this.#captions.get(role);
    if (!buffer || (buffer.closed && !(final && (buffer.text === text || buffer.text.endsWith(text))))) {
      buffer = { id: `gemini_${++this.#captionId}`, text: "", context: copy(this.#context!), closed: false }; this.#captions.set(role, buffer);
    }
    if (text.startsWith(buffer.text)) buffer.text = text;
    else if (!buffer.text.endsWith(text)) buffer.text += text;
    buffer.text = buffer.text.slice(-8000);
    this.#emit?.({ type: "transcript", transcript: { id: buffer.id, role, text: buffer.text, context: copy(buffer.context), final } });
    if (final) buffer.closed = true;
  }
  #flushCaptions(): void {
    for (const [role, buffer] of this.#captions) if (!buffer.closed && buffer.text) {
      this.#emit?.({ type: "transcript", transcript: { id: buffer.id, role, text: buffer.text, context: copy(buffer.context), final: true } }); buffer.closed = true;
    }
  }
  #message(message: LiveServerMessage): void {
    try {
      if (message.goAway) { this.#emit?.({ type: "error", code: "reconnect_required" }); this.disconnect(); return; }
      const content = message.serverContent;
      if (content?.interrupted) { this.#io?.clear(); this.#modelActive = false; this.#statusEvent("user-speaking"); }
      if (content?.inputTranscription?.text) {
        this.#caption("user", content.inputTranscription.text, content.inputTranscription.finished === true);
        this.#statusEvent(content.inputTranscription.finished ? "thinking" : "user-speaking");
      }
      if (content?.outputTranscription?.text) this.#caption("assistant", content.outputTranscription.text, content.outputTranscription.finished === true);
      for (const part of content?.modelTurn?.parts ?? []) if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) { this.#modelActive = true; this.#statusEvent("speaking"); this.#io?.play(part.inlineData.data); }
      if (content?.turnComplete) {
        this.#flushCaptions(); this.#modelActive = String(content.interactionStatus) === "IN_PROGRESS";
        if (this.#modelActive) this.#statusEvent("thinking"); else this.#idle();
      }
      if (content?.waitingForInput || String(content?.interactionStatus) === "IDLE") { this.#modelActive = false; this.#idle(); }
      for (const call of message.toolCall?.functionCalls ?? []) {
        if (call.name === "show_sources") this.#emit?.({ type: "sources" });
        if (call.name === "profile_choice" && isRecord(call.args) && [call.args.field, call.args.value, call.args.evidence].every(v => typeof v === "string")) this.#emit?.({ type: "profile", field: call.args.field as string, value: call.args.value as string, evidence: call.args.evidence as string });
        this.#session?.sendToolResponse({ functionResponses: [{ name: call.name, id: call.id, response: { displayRequested: true, confirmationRequiresUser: true } }] });
      }
    } catch { this.#emit?.({ type: "error", code: "protocol_error" }); this.disconnect(); }
  }
  updateContext(text: string): boolean {
    if (!this.#session || this.#status !== "listening" || this.#io?.busy || this.#modelActive) return false;
    try { this.#session.sendClientContent({ turns: [{ role: "user", parts: [{ text: text.slice(0,6000) }] }], turnComplete: false }); return true; } catch { return false; }
  }
  speakQuestion(): void { this.#session?.sendClientContent({ turns: [{ role: "user", parts: [{ text: "現在の質問、または任意の導入の問いを一つだけ短く話してください。" }] }], turnComplete: true }); }
  setRevision(context: Context): void { this.#context = copy(context); }
  async resumePlayback(): Promise<void> { await this.#io?.activate(); }
  disconnect(): void {
    this.#generation++; this.#ac?.abort(); this.#removeAbort?.(); this.#removeAbort = undefined;
    try { this.#session?.close(); } catch {}
    this.#stream?.getTracks().forEach(t => { try { t.stop(); } catch {} }); try { this.#io?.close(); } catch {}
    this.#session = undefined; this.#stream = undefined; this.#io = undefined; this.#captions.clear(); this.#modelActive = false; this.#statusEvent("closed");
  }
}
