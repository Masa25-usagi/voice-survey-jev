import { copy, isRecord } from "../types.js";
import type { Context, ProfileConfig, Question, SpeakingPreferences, VoiceConnection, VoiceEvent } from "../types.js";
import type { SessionStarter } from "../http.js";

export interface OpenAIVoiceOptions {
  startSession: SessionStarter;
  modelKey: string;
  getMicrophone?: () => Promise<MediaStream>;
  createPeer?: () => RTCPeerConnection;
  createAudio?: () => HTMLAudioElement;
  timeoutMs?: number;
}
export class OpenAIVoice implements VoiceConnection {
  #options: OpenAIVoiceOptions;
  #peer?: RTCPeerConnection;
  #channel?: RTCDataChannel;
  #audio?: HTMLAudioElement;
  #stream?: MediaStream;
  #ac?: AbortController;
  #context?: Context;
  #emit?: (event: VoiceEvent) => void;
  #generation = 0;
  #turns = new Map<string, Context>();
  #status = "closed";
  #userSpeaking = false;
  #removeAbort?: () => void;
  constructor(options: OpenAIVoiceOptions) { this.#options = options; }
  #statusEvent(status: "connecting" | "listening" | "user-speaking" | "thinking" | "speaking" | "closed"): void { this.#status = status; this.#emit?.({ type: "status", status }); }
  #remember(id: string): void { this.#turns.set(id, copy(this.#context!)); while (this.#turns.size > 256) this.#turns.delete(this.#turns.keys().next().value!); }
  #send(event: unknown): boolean { if (this.#channel?.readyState !== "open") return false; try { this.#channel.send(JSON.stringify(event)); return true; } catch { return false; } }
  async connect(context: Context, question: Question, preferences: SpeakingPreferences, emit: (event: VoiceEvent) => void, signal: AbortSignal, profile?: ProfileConfig): Promise<void> {
    this.disconnect(); const generation = ++this.#generation;
    this.#context = copy(context); this.#emit = emit; const ac = new AbortController(); this.#ac = ac;
    const abort = () => this.disconnect(); signal.addEventListener("abort", abort, { once: true }); this.#removeAbort = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) { this.disconnect(); throw new Error("Connection cancelled"); }
    ac.signal.addEventListener("abort", () => { if (generation === this.#generation) this.disconnect(); }, { once: true });
    const timeout = setTimeout(() => ac.abort(), this.#options.timeoutMs ?? 15000);
    const active = () => generation === this.#generation && !ac.signal.aborted;
    const check = () => { if (!active()) throw new Error("Connection cancelled"); };
    this.#statusEvent("connecting");
    try {
      const peer = (this.#options.createPeer ?? (() => new RTCPeerConnection()))(); this.#peer = peer;
      const audio = (this.#options.createAudio ?? (() => new Audio()))(); audio.autoplay = true; this.#audio = audio;
      peer.ontrack = event => { if (!active()) return; audio.srcObject = event.streams[0] ?? new MediaStream([event.track]); void audio.play().catch(() => emit({ type: "error", code: "playback_blocked" })); };
      peer.onconnectionstatechange = () => { if (active() && ["failed", "disconnected"].includes(peer.connectionState)) { emit({ type: "error", code: "connection_lost" }); this.disconnect(); } };
      const stream = await (this.#options.getMicrophone ?? (() => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })))();
      if (!active()) { stream.getTracks().forEach(t => t.stop()); check(); }
      this.#stream = stream; for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      const channel = peer.createDataChannel("oai-events"); this.#channel = channel;
      channel.onmessage = event => { if (active()) this.#message(event.data); };
      let ready!: () => void; let failed!: (reason: unknown) => void;
      const opened = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
      // Install a handler immediately to avoid an unhandled rejection during SDP exchange.
      void opened.catch(() => {});
      channel.onopen = () => { if (active()) { this.#statusEvent("listening"); ready(); } };
      channel.onclose = () => { if (active()) { failed(new Error("Connection closed")); emit({ type: "error", code: "connection_lost" }); this.disconnect(); } };
      const abortReady = () => failed(new Error("Connection cancelled")); ac.signal.addEventListener("abort", abortReady, { once: true });
      const offer = await peer.createOffer(); check(); await peer.setLocalDescription(offer); check();
      if (peer.iceGatheringState !== "complete") await new Promise<void>((resolve, reject) => {
        const done = () => { if (peer.iceGatheringState === "complete") { clean(); resolve(); } };
        const abort = () => { clean(); reject(new Error("Connection cancelled")); };
        const clean = () => { peer.removeEventListener("icegatheringstatechange", done); ac.signal.removeEventListener("abort", abort); };
        peer.addEventListener("icegatheringstatechange", done); ac.signal.addEventListener("abort", abort, { once: true }); done(); if (ac.signal.aborted) abort();
      });
      check();
      const sdp = peer.localDescription?.sdp ?? offer.sdp; if (!sdp) throw new Error("Missing offer");
      const response = await this.#options.startSession({ context, question, preferences, profile, modelKey: this.#options.modelKey, sdp, signal: ac.signal }); check();
      if (response.provider !== "openai" || !response.sdp.startsWith("v=0")) throw new Error("Invalid session");
      await peer.setRemoteDescription({ type: "answer", sdp: response.sdp }); check();
      if (channel.readyState === "open") ready(); await opened; check();
      ac.signal.removeEventListener("abort", abortReady);
    } catch { if (generation === this.#generation) { emit({ type: "error", code: "connection_unavailable" }); this.disconnect(); } throw new Error("Voice connection unavailable"); }
    finally { clearTimeout(timeout); }
  }
  #message(data: unknown): void {
    try {
      if (typeof data !== "string") return; const event: unknown = JSON.parse(data); if (!isRecord(event)) return;
      if (event.type === "input_audio_buffer.speech_started") { this.#userSpeaking = true; if (typeof event.item_id === "string") this.#remember(event.item_id); this.#statusEvent("user-speaking"); }
      if (event.type === "input_audio_buffer.speech_stopped") { this.#userSpeaking = false; this.#statusEvent("thinking"); }
      if (event.type === "response.created") { if (isRecord(event.response) && typeof event.response.id === "string") this.#remember(event.response.id); if (!this.#userSpeaking) this.#statusEvent("thinking"); }
      if (event.type === "response.output_item.added" && isRecord(event.item) && typeof event.item.id === "string") {
        const context = typeof event.response_id === "string" && this.#turns.get(event.response_id); if (context) this.#turns.set(event.item.id, context);
      }
      if (event.type === "output_audio_buffer.started" && !this.#userSpeaking) this.#statusEvent("speaking");
      if ((event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") && !this.#userSpeaking) this.#statusEvent("listening");
      const role = event.type === "conversation.item.input_audio_transcription.completed" ? "user" : ["response.output_audio_transcript.done", "response.audio_transcript.done", "response.output_text.done"].includes(String(event.type)) ? "assistant" : undefined;
      if (role && typeof event.item_id === "string") {
        const context = this.#turns.get(event.item_id), text = event.transcript ?? event.text;
        if (context && typeof text === "string") this.#emit?.({ type: "transcript", transcript: { id: event.item_id, context, role, text: text.slice(-8000), final: true } });
      }
      if (event.type === "response.function_call_arguments.done" && typeof event.name === "string" && typeof event.call_id === "string") {
        const args = typeof event.arguments === "string" ? JSON.parse(event.arguments) : {};
        if (event.name === "show_sources") this.#emit?.({ type: "sources" });
        else if (event.name === "profile_choice" && isRecord(args) && [args.field, args.value, args.evidence].every(v => typeof v === "string")) this.#emit?.({ type: "profile", field: args.field as string, value: args.value as string, evidence: args.evidence as string });
        this.#send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify({ displayRequested: true, confirmationRequiresUser: true }) } });
        if (!this.#userSpeaking) this.#send({ type: "response.create" });
      }
      if (event.type === "error") { this.#emit?.({ type: "error", code: "provider_error" }); this.disconnect(); }
    } catch { this.#emit?.({ type: "error", code: "protocol_error" }); this.disconnect(); }
  }
  updateContext(text: string): boolean {
    return !this.#userSpeaking && this.#status === "listening" && this.#send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: text.slice(0,6000) }] } });
  }
  speakQuestion(): void { this.#send({ type: "response.create", response: { instructions: "現在の質問、または任意の導入の問いを一つだけ短く話してください。" } }); }
  setRevision(context: Context): void { this.#context = copy(context); }
  async resumePlayback(): Promise<void> { await this.#audio?.play(); }
  disconnect(): void {
    this.#generation++; this.#ac?.abort(); this.#removeAbort?.(); this.#removeAbort = undefined;
    if (this.#channel) { this.#channel.onmessage = null; this.#channel.onopen = null; this.#channel.onclose = null; this.#channel.close(); }
    if (this.#peer) { this.#peer.ontrack = null; this.#peer.onconnectionstatechange = null; this.#peer.close(); }
    this.#stream?.getTracks().forEach(t => t.stop()); if (this.#audio) { this.#audio.pause(); this.#audio.srcObject = null; }
    this.#channel = undefined; this.#peer = undefined; this.#stream = undefined; this.#audio = undefined; this.#turns.clear(); this.#userSpeaking = false; this.#statusEvent("closed");
  }
}
