/** Stateful area-average resampling. Chunk boundaries do not reset its phase. */
export class PcmEncoder {
  #ratio: number;
  #needed: number;
  #sum = 0;
  constructor(inputRate: number, outputRate = 16000) {
    if (!Number.isFinite(inputRate) || inputRate < outputRate || outputRate < 1) throw new Error("Invalid sample rate");
    this.#ratio = inputRate / outputRate; this.#needed = this.#ratio;
  }
  push(samples: Float32Array): Uint8Array {
    const values: number[] = [];
    for (const raw of samples) {
      const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      let remaining = 1;
      while (remaining > 1e-9) {
        const amount = Math.min(remaining, this.#needed); this.#sum += sample * amount; remaining -= amount; this.#needed -= amount;
        if (this.#needed < 1e-9) {
          const value = this.#sum / this.#ratio; values.push(Math.round(value * (value < 0 ? 32768 : 32767)));
          this.#sum = 0; this.#needed = this.#ratio;
        }
      }
    }
    const out = new Uint8Array(values.length * 2), view = new DataView(out.buffer);
    values.forEach((v, i) => view.setInt16(i * 2, v, true)); return out;
  }
}
export function pcmFloat(bytes: Uint8Array): Float32Array {
  if (bytes.length % 2) throw new Error("Incomplete PCM sample");
  const out = new Float32Array(bytes.length / 2), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
export function base64Bytes(bytes: Uint8Array): string {
  let raw = ""; for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(raw);
}
export function unbase64(text: string): Uint8Array { const raw = atob(text); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
