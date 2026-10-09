import type { Fetcher } from "../http.js";
import type { JevRequest, JevResult } from "../jev.js";
import { validateJevResult } from "../jev.js";

export class JevClient {
  #key: string;
  #fetch: Fetcher;
  constructor(apiKey: string, fetcher: Fetcher = (u, i) => fetch(u, i)) { this.#key = apiKey; this.#fetch = fetcher; }
  async evaluate(request: JevRequest, signal: AbortSignal): Promise<JevResult> {
    if (!this.#key) throw new Error("Decision service not configured");
    const body = JSON.stringify(request);
    if (new TextEncoder().encode(body).length > 64000) throw new Error("Decision request too large");
    const response = await this.#fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { Authorization: `Bearer ${this.#key}`, "Content-Type": "application/json" }, body, signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Decision service unavailable"); }
    return validateJevResult(await response.json(), request);
  }
}
