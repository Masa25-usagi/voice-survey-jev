import { PcmEncoder } from "./pcm.js";
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class SurveyCapture extends AudioWorkletProcessor {
  #encoder = new PcmEncoder(sampleRate);
  #chunks: number[] = [];
  #running = true;
  constructor() { super(); this.port.onmessage = e => { if (e.data === "stop") { this.#running = false; this.#chunks = []; } }; }
  process(inputs: Float32Array[][]): boolean {
    if (!this.#running) return false;
    const channel = inputs[0]?.[0]; if (!channel) return true;
    const bytes = this.#encoder.push(channel); for (const value of bytes) this.#chunks.push(value);
    while (this.#chunks.length >= 640) {
      const packet = new Uint8Array(this.#chunks.splice(0, 640));
      this.port.postMessage(packet, [packet.buffer]);
    }
    return true;
  }
}
registerProcessor("survey-capture", SurveyCapture);
