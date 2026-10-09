import { copy, sameContext } from "./types.js";
import type { Answer, Context, Proposal, Question, Survey, Value } from "./types.js";
import { defineSurvey, equalValue, validAnswer } from "./survey.js";

interface Row { proposal?: Proposal; draft?: Answer; source?: "manual" | "ai"; confirmed?: Answer }
export interface Snapshot { context: Context; question: Question; row: Row; visibleIds: string[]; confirmed: Record<string, Answer> }
export class SurveyController {
  #survey: Survey;
  #rows = new Map<string, Row>();
  #active: string;
  #connection = 0;
  #revision = 0;
  #listeners = new Set<(snapshot: Snapshot) => void>();
  constructor(survey: Survey) { this.#survey = defineSurvey(survey); this.#active = this.#survey.questions[0]!.id; }
  get survey(): Survey { return copy(this.#survey); }
  get question(): Question { return copy(this.survey.questions.find(q => q.id === this.#active)!); }
  get context(): Context { return { surveyId: this.survey.id, questionId: this.#active, connection: this.#connection, revision: this.#revision }; }
  get visibleIds(): string[] {
    const visible: string[] = [];
    for (const q of this.survey.questions) {
      const a = q.when && this.#rows.get(q.when.questionId)?.confirmed;
      if (!q.when || (visible.includes(q.when.questionId) && a?.kind === "value" && equalValue(a.value, q.when.equals))) visible.push(q.id);
    }
    return visible;
  }
  get snapshot(): Snapshot { return { context: this.context, question: this.question, row: copy(this.#row()), visibleIds: this.visibleIds, confirmed: this.confirmedAnswers() }; }
  #row(): Row { if (!this.#rows.has(this.#active)) this.#rows.set(this.#active, {}); return this.#rows.get(this.#active)!; }
  #notify(): void { const s = this.snapshot; for (const listener of this.#listeners) listener(copy(s)); }
  subscribe(listener: (snapshot: Snapshot) => void): () => void { this.#listeners.add(listener); listener(this.snapshot); return () => this.#listeners.delete(listener); }
  matches(context: Context): boolean { return sameContext(this.context, context); }
  reconnect(): Context { this.#connection++; this.#revision++; this.clearProposal(); return this.context; }
  invalidate(): Context { this.#revision++; this.#notify(); return this.context; }
  clearProposal(): void { const r = this.#row(); delete r.proposal; if (r.source === "ai" && !r.confirmed) { delete r.draft; delete r.source; } this.#notify(); }
  propose(proposal: Proposal, context: Context): boolean {
    if (!this.matches(context) || !validAnswer(this.question, proposal.answer) || !Number.isFinite(proposal.confidence) || proposal.confidence < 0.5 || proposal.confidence > 1 || !Number.isFinite(proposal.probability) || proposal.probability < 0.5 || proposal.probability > 1) return false;
    const r = this.#row();
    if (r.source === "manual" || r.confirmed) return false;
    r.proposal = copy(proposal); r.draft = copy(proposal.answer); r.source = "ai"; this.#notify(); return true;
  }
  select(value: Value): void { this.#manual({ kind: "value", value }); }
  skip(reason: "manual" | "declined" | "insufficient" = "manual"): void { this.#manual({ kind: "skip", reason }); }
  #manual(answer: Answer): void {
    if (!validAnswer(this.question, answer)) throw new Error("Invalid answer");
    this.#revision++;
    const r = this.#row(); r.draft = copy(answer); r.source = "manual"; delete r.proposal;
    // An edited confirmed answer is no longer exportable until confirmed again.
    delete r.confirmed; this.#pruneHidden(); this.#notify();
  }
  allowSuggestions(): void {
    this.#revision++; const r = this.#row(); delete r.draft; delete r.source; delete r.proposal; delete r.confirmed;
    this.#pruneHidden(); this.#notify();
  }
  clearSelection(): void {
    this.#revision++; const r = this.#row(); delete r.draft; delete r.confirmed; delete r.proposal; r.source = "manual";
    this.#pruneHidden(); this.#notify();
  }
  confirm(): Answer {
    const r = this.#row(); if (!r.draft) throw new Error("Choose an answer first");
    r.confirmed = copy(r.draft); this.#revision++; this.#pruneHidden(); this.#notify(); return copy(r.confirmed);
  }
  #pruneHidden(): void { const visible = new Set(this.visibleIds); for (const id of this.#rows.keys()) if (!visible.has(id)) this.#rows.delete(id); }
  goTo(id: string): void {
    if (!this.visibleIds.includes(id)) throw new Error("Question is not visible");
    if (id === this.#active) return;
    this.clearProposal(); this.#active = id; this.#revision++; this.#connection++; this.#notify();
  }
  next(): boolean {
    if (!this.#row().confirmed) throw new Error("Confirm before continuing");
    const ids = this.visibleIds; const next = ids[ids.indexOf(this.#active) + 1];
    if (!next) return false; this.goTo(next); return true;
  }
  confirmedAnswers(): Record<string, Answer> {
    const out: Record<string, Answer> = Object.create(null);
    for (const id of this.visibleIds) { const a = this.#rows.get(id)?.confirmed; if (a) out[id] = copy(a); }
    return out;
  }
  reset(): void { this.#rows.clear(); this.#active = this.survey.questions[0]!.id; this.#connection++; this.#revision++; this.#notify(); }
}
