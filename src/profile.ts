import { copy } from "./types.js";
import type { ProfileConfig, SpeakingPreferences } from "./types.js";

export class ProfileDraft {
  readonly config: ProfileConfig;
  #values: Record<string, string> = Object.create(null);
  #manual = new Set<string>();
  constructor(config: ProfileConfig) {
    if (config.fields.length > 10 || new Set(config.fields.map(f => f.id)).size !== config.fields.length) throw new Error("Invalid profile");
    for (const f of config.fields) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(f.id) || !f.label.trim() || f.options.length < 2 || f.options.length > 30 || new Set(f.options.map(o => o.id)).size !== f.options.length) throw new Error("Invalid profile field");
      for (const o of f.options) if (!/^[a-z][a-z0-9_]{0,63}$/.test(o.id) || !o.label.trim()) throw new Error("Invalid profile option");
    }
    this.config = copy(config);
  }
  get values(): Record<string, string> { return { ...this.#values }; }
  set(field: string, value: string): void {
    if (!this.config.fields.find(f => f.id === field)?.options.some(o => o.id === value)) throw new Error("Invalid profile value");
    this.#values[field] = value;
    this.#manual.add(field);
  }
  suggest(field: string, value: string, evidence: string, respondentWords: string[]): boolean {
    const option = this.config.fields.find(f => f.id === field)?.options.find(o => o.id === value);
    if (!option || this.#manual.has(field) || evidence.trim().length < 2 || evidence.length > 200 || !respondentWords.some(text => text.includes(evidence))) return false;
    const terms = option.evidenceTerms ?? [option.label];
    if (!terms.some(term => term.trim().length >= 2 && evidence.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return false;
    this.#values[field] = value; return true;
  }
  reset(): void { this.#values = Object.create(null); this.#manual.clear(); }
  speakingPreferences(): SpeakingPreferences {
    const out: SpeakingPreferences = {};
    if (["slow", "normal"].includes(this.#values.speed ?? "")) out.speed = this.#values.speed as SpeakingPreferences["speed"];
    if (["brief", "normal", "detailed"].includes(this.#values.detail ?? "")) out.detail = this.#values.detail as SpeakingPreferences["detail"];
    if (["everyday", "none"].includes(this.#values.examples ?? "")) out.examples = this.#values.examples as SpeakingPreferences["examples"];
    // Arbitrary demographic fields stay in the host's draft and are never passed into conversation adaptation.
    return out;
  }
}
export const speakingProfile: ProfileConfig = { fields: [
  { id: "speed", label: "話す速さ", options: [{ id: "slow", label: "ゆっくり", evidenceTerms: ["ゆっくり", "slow"] }, { id: "normal", label: "いつもどおり", evidenceTerms: ["いつもどおり", "normal"] }] },
  { id: "detail", label: "説明の長さ", options: [{ id: "brief", label: "短く", evidenceTerms: ["短く", "短い", "brief"] }, { id: "normal", label: "ふつう", evidenceTerms: ["ふつう", "普通", "normal"] }, { id: "detailed", label: "詳しく", evidenceTerms: ["詳しく", "詳細", "detail"] }] },
  { id: "examples", label: "説明の例", options: [{ id: "everyday", label: "身近な例", evidenceTerms: ["身近", "生活", "example"] }, { id: "none", label: "例は不要", evidenceTerms: ["例は不要", "例はいらない", "no example"] }] }
] };
