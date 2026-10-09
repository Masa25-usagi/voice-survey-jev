import { base64Bytes, pcmFloat, unbase64 } from "../pcm.js";

export interface AudioIO {
  activate(): Promise<void>;
  capture(stream: MediaStream, send: (base64: string) => void): Promise<void>;
  play(base64: string): void;
  clear(): void;
  close(): void;
  readonly busy: boolean;
}
export class BrowserAudioIO implements AudioIO {
  #context: AudioContext;
  #worklet?: AudioWorkletNode;
  #source?: MediaStreamAudioSourceNode;
  #mute?: GainNode;
  #playing = new Set<AudioBufferSourceNode>();
  #end = 0;
  #closed = false;
  #onIdle: () => void;
  #workletUrl: string;
  constructor(onIdle: () => void, workletUrl = new URL("../capture-worklet.js", import.meta.url).href) {
    this.#context = new AudioContext(); this.#onIdle = onIdle; this.#workletUrl = workletUrl;
  }
  get busy(): boolean { return this.#playing.size > 0; }
  async activate(): Promise<void> { await this.#context.resume(); if (this.#context.state !== "running") throw new Error("Audio playback unavailable"); }
  async capture(stream: MediaStream, send: (base64: string) => void): Promise<void> {
    await this.#context.audioWorklet.addModule(this.#workletUrl); if (this.#closed) return;
    this.#worklet = new AudioWorkletNode(this.#context, "survey-capture"); this.#source = this.#context.createMediaStreamSource(stream);
    this.#mute = this.#context.createGain(); this.#mute.gain.value = 0;
    this.#worklet.port.onmessage = e => { if (!this.#closed && e.data instanceof Uint8Array) send(base64Bytes(e.data)); };
    this.#source.connect(this.#worklet); this.#worklet.connect(this.#mute); this.#mute.connect(this.#context.destination);
  }
  play(base64: string): void {
    if (this.#closed) return;
    const samples = pcmFloat(unbase64(base64));
    if (samples.length > 24000 * 5 || this.#end - this.#context.currentTime > 10) throw new Error("Audio buffer exceeded");
    const buffer = this.#context.createBuffer(1, samples.length, 24000); buffer.getChannelData(0).set(samples);
    const source = this.#context.createBufferSource(); source.buffer = buffer; source.connect(this.#context.destination);
    this.#playing.add(source);
    source.onended = () => { source.disconnect(); this.#playing.delete(source); if (!this.#closed && !this.busy) this.#onIdle(); };
    const start = Math.max(this.#context.currentTime, this.#end); source.start(start); this.#end = start + buffer.duration;
  }
  clear(): void {
    for (const source of this.#playing) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    this.#playing.clear(); this.#end = 0;
  }
  close(): void {
    if (this.#closed) return; this.#closed = true; this.clear();
    if (this.#worklet) { this.#worklet.port.onmessage = null; this.#worklet.port.postMessage("stop"); this.#worklet.port.close(); this.#worklet.disconnect(); }
    this.#source?.disconnect(); this.#mute?.disconnect(); void this.#context.close().catch(() => {});
  }
}
