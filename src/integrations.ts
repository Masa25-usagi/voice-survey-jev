import type { Answer } from "./types.js";
import type { SurveyController } from "./controller.js";

export type FormMapping = Record<string, { name: string; values?: Record<string, string>; skipValue?: string }>;
export function formEntries(answers: Record<string, Answer>, mapping: FormMapping): [string, string][] {
  const out: [string, string][] = [];
  for (const [questionId, answer] of Object.entries(answers)) {
    const target = mapping[questionId]; if (!target) continue;
    if (answer.kind === "skip") { if (target.skipValue !== undefined) out.push([target.name, target.skipValue]); continue; }
    for (const value of Array.isArray(answer.value) ? answer.value : [answer.value]) out.push([target.name, target.values?.[String(value)] ?? String(value)]);
  }
  return out;
}
/** Only copies confirmed answers. Never submits the host form. */
export function bindForm(controller: SurveyController, form: HTMLFormElement, mapping: FormMapping): () => void {
  return controller.subscribe(snapshot => {
    const entries = formEntries(snapshot.confirmed, mapping);
    for (const target of Object.values(mapping)) {
      const values = entries.filter(([name]) => name === target.name).map(([, value]) => value);
      const elements = Array.from(form.elements).filter(e => e.getAttribute("name") === target.name);
      for (const element of elements) {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) continue;
        if (element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type)) element.checked = values.includes(element.value);
        else if (element instanceof HTMLSelectElement && element.multiple) for (const option of element.options) option.selected = values.includes(option.value);
        else element.value = values[0] ?? "";
        element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
}
/** Builds an explicit prefill link; no network call or automatic submission. */
export function prefillUrl(base: string, answers: Record<string, Answer>, mapping: FormMapping): string {
  const url = new URL(base); if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid form URL");
  for (const target of Object.values(mapping)) url.searchParams.delete(target.name);
  for (const [name, value] of formEntries(answers, mapping)) url.searchParams.append(name, value);
  return url.toString();
}
