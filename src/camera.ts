import { safeObservation } from "./dialogue.js";
import type { CameraObservation } from "./dialogue.js";
export interface CameraOptions {
  observe: (jpeg: string, signal: AbortSignal) => Promise<CameraObservation>;
  onObservation: (observation?: CameraObservation) => void;
  onError?: () => void;
  getCamera?: () => Promise<MediaStream>;
  captureFrame?: (video: HTMLVideoElement) => string;
  intervalMs?: number;
}
export class CameraSession {
  #options: CameraOptions;
  #video: HTMLVideoElement;
  #stream?: MediaStream;
  #request?: AbortController;
  #timer?: ReturnType<typeof setTimeout>;
  #expiry?: ReturnType<typeof setTimeout>;
  #generation = 0;
  constructor(video: HTMLVideoElement, options: CameraOptions) { this.#video = video; this.#options = options; }
  get active(): boolean { return this.#stream !== undefined; }
  async start(consent: boolean): Promise<void> {
    if (!consent) throw new Error("Camera consent required"); this.stop(); const generation = ++this.#generation;
    try {
      const stream = await (this.#options.getCamera ?? (() => navigator.mediaDevices.getUserMedia({ audio: false, video: { width: 640, height: 360, facingMode: "user" } })))();
      if (generation !== this.#generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.#stream = stream; this.#video.muted = true; this.#video.playsInline = true; this.#video.srcObject = stream; await this.#video.play();
      if (generation === this.#generation) void this.#tick(generation);
    } catch { if (generation === this.#generation) { this.stop(); this.#options.onError?.(); } }
  }
  async #tick(generation: number): Promise<void> {
    if (generation !== this.#generation || !this.#stream) return;
    const ac = new AbortController(); this.#request = ac;
    try {
      const capture = this.#options.captureFrame ?? (video => {
        if (!video.videoWidth) throw new Error("Camera not ready");
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
        const context = canvas.getContext("2d"); if (!context) throw new Error("Capture unavailable");
        context.drawImage(video, 0, 0, 640, 360); const data = canvas.toDataURL("image/jpeg", 0.6).split(",")[1]!; canvas.width = 0; canvas.height = 0; return data;
      });
      const observation = await this.#options.observe(capture(this.#video), ac.signal);
      if (generation !== this.#generation || ac.signal.aborted) return;
      const safe = safeObservation(observation); this.#options.onObservation(safe); clearTimeout(this.#expiry);
      this.#expiry = setTimeout(() => { if (generation === this.#generation) this.#options.onObservation(undefined); }, 30000);
    } catch { if (generation === this.#generation && !ac.signal.aborted) { this.#options.onObservation(undefined); this.#options.onError?.(); } }
    finally { if (generation === this.#generation) this.#timer = setTimeout(() => void this.#tick(generation), this.#options.intervalMs ?? 8000); }
  }
  stop(): void {
    this.#generation++; clearTimeout(this.#timer); clearTimeout(this.#expiry); this.#request?.abort();
    this.#stream?.getTracks().forEach(t => t.stop()); this.#stream = undefined; this.#video.pause(); this.#video.srcObject = null; this.#options.onObservation(undefined);
  }
}
