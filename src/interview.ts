import { copy } from "./types.js";
import type { Context, Question, Transcript, VoiceConnection, VoiceStatus } from "./types.js";
import type { Turn, MappingResult } from "./jev.js";
import type { CameraObservation, DialogueAnalysis } from "./dialogue.js";
import { feedbackText, safeObservation } from "./dialogue.js";
import { SurveyController } from "./controller.js";

export type Mapper = (input: { question: Question; turns: Turn[]; signal: AbortSignal }) => Promise<MappingResult>;
export type Analyst = (input: { turns: Turn[]; camera?: CameraObservation; signal: AbortSignal }) => Promise<DialogueAnalysis>;
export interface InterviewOptions {
  mapper: Mapper;
  analyst?: Analyst;
  debounceMs?: number;
  analysisIntervalMs?: number;
  now?: () => number;
  onChange?: (state: InterviewSnapshot) => void;
}
export interface InterviewSnapshot { turns: Turn[]; camera?: CameraObservation; analysis?: DialogueAnalysis; disposition?: MappingResult["disposition"]; error?: "mapping_unavailable" | "analysis_unavailable" }
export class InterviewSession {
  readonly controller: SurveyController;
  #options: InterviewOptions;
  #scope: Context;
  #turns: Turn[] = [];
  #camera?: CameraObservation;
  #analysis?: DialogueAnalysis;
  #disposition?: MappingResult["disposition"];
  #error?: InterviewSnapshot["error"];
  #mapSequence = 0;
  #analysisSequence = 0;
  #mapping?: AbortController;
  #analyzing?: AbortController;
  #mapTimer?: ReturnType<typeof setTimeout>;
  #analysisTimer?: ReturnType<typeof setTimeout>;
  #lastAnalysisStart = -Infinity;
  #stopped = false;
  #voice?: VoiceConnection;
  #voiceStatus: VoiceStatus = "closed";
  #unsubscribe: () => void;
  constructor(controller: SurveyController, options: InterviewOptions) {
    this.controller = controller; this.#options = options; this.#scope = controller.context;
    this.#unsubscribe = controller.subscribe(snapshot => {
      if (snapshot.context.revision === this.#scope.revision && snapshot.context.connection === this.#scope.connection && snapshot.context.questionId === this.#scope.questionId) return;
      this.#scope = snapshot.context; this.#cancel(); this.#turns = []; this.#analysis = undefined; this.#disposition = undefined; this.#camera = undefined;
      this.#voice?.setRevision(this.#scope); this.#notify();
    });
  }
  #now(): number { return (this.#options.now ?? Date.now)(); }
  get snapshot(): InterviewSnapshot { return copy({ turns: this.#turns, camera: safeObservation(this.#camera, this.#now()), analysis: this.#analysis, disposition: this.#disposition, error: this.#error }); }
  #notify(): void { this.#options.onChange?.(this.snapshot); }
  attachVoice(voice?: VoiceConnection): void { this.#voice = voice; this.#voiceStatus = "closed"; }
  voiceStatus(status: VoiceStatus): void {
    if (this.#stopped) return;
    if (status === "user-speaking" && this.#voiceStatus !== "user-speaking") {
      // New speech makes an unfinished decision obsolete before its transcript arrives.
      this.#cancel(); this.#disposition = undefined; this.#analysis = undefined; this.#error = undefined;
      this.controller.clearProposal(); this.#notify();
    }
    this.#voiceStatus = status; this.#share();
  }
  #share(): void {
    if (this.#stopped || this.#voiceStatus !== "listening" || !this.#analysis || this.#analysis.shared || !this.controller.matches(this.#scope)) return;
    if (this.#voice?.updateContext(feedbackText(this.#analysis))) { this.#analysis.shared = true; this.#notify(); }
  }
  ingest(event: Transcript): boolean {
    if (this.#stopped || !event.final || !this.controller.matches(event.context) || !event.text.trim() || event.id.length > 150) return false;
    const text = event.text.slice(-8000).trim();
    const previous = this.#turns.find(t => t.id === event.id && t.role === event.role);
    if (previous?.text === text) return false;
    if (previous) previous.text = text;
    else this.#turns.push({ id: event.id, role: event.role, text });
    while (this.#turns.length > 48) this.#turns.shift();
    let excess = this.#turns.reduce((sum, t) => sum + t.text.length, 0) - 12000;
    while (excess > 0 && this.#turns.length) {
      const first = this.#turns[0]!;
      if (first.text.length <= excess) { excess -= first.text.length; this.#turns.shift(); }
      else { first.text = first.text.slice(excess); excess = 0; }
    }
    this.#error = undefined;
    if (event.role === "user") { this.controller.clearProposal(); this.#disposition = undefined; }
    this.#scheduleMapping(); this.#scheduleAnalysis(); this.#notify(); return true;
  }
  setCamera(observation?: CameraObservation): void {
    if (this.#stopped) return;
    this.#camera = safeObservation(observation, this.#now());
    if (!this.#camera && this.#analysis) {
      this.#analysis.findings.visual_response = { value: "none", confidence: 1, reliable: true, basis: "camera_observation" };
      this.#analysis.shared = false; this.#share(); this.#notify();
    }
    this.#scheduleAnalysis(); this.#notify();
  }
  #scheduleMapping(): void {
    this.#mapSequence++; this.#mapping?.abort(); clearTimeout(this.#mapTimer);
    if (!this.#turns.some(t => t.role === "user")) return;
    const sequence = this.#mapSequence, scope = copy(this.#scope), turns = copy(this.#turns), question = this.controller.question;
    this.#mapTimer = setTimeout(async () => {
      const ac = new AbortController(); this.#mapping = ac;
      try {
        const result = await this.#options.mapper({ question, turns, signal: ac.signal });
        if (this.#stopped || ac.signal.aborted || sequence !== this.#mapSequence || !this.controller.matches(scope) || this.#voiceStatus === "user-speaking") return;
        this.#disposition = result.disposition;
        if (result.proposal) this.controller.propose(result.proposal, scope);
        this.#notify();
      } catch {
        if (!this.#stopped && !ac.signal.aborted && sequence === this.#mapSequence && this.controller.matches(scope)) { this.#error = "mapping_unavailable"; this.#notify(); }
      }
    }, this.#options.debounceMs ?? 500);
  }
  #scheduleAnalysis(): void {
    this.#analysisSequence++; this.#analyzing?.abort(); clearTimeout(this.#analysisTimer);
    if (!this.#options.analyst || !this.#turns.some(t => t.role === "user")) return;
    const sequence = this.#analysisSequence, scope = copy(this.#scope);
    const wait = Math.max(0, (this.#options.analysisIntervalMs ?? 8000) - (this.#now() - this.#lastAnalysisStart));
    this.#analysisTimer = setTimeout(async () => {
      const ac = new AbortController(); this.#analyzing = ac; this.#lastAnalysisStart = this.#now();
      try {
        const analysis = await this.#options.analyst!({ turns: copy(this.#turns), camera: safeObservation(this.#camera, this.#now()), signal: ac.signal });
        if (this.#stopped || ac.signal.aborted || sequence !== this.#analysisSequence || !this.controller.matches(scope)) return;
        this.#analysis = copy(analysis); this.#analysis.shared = false; this.#share(); this.#notify();
      } catch {
        if (!this.#stopped && !ac.signal.aborted && sequence === this.#analysisSequence && this.controller.matches(scope)) { this.#error = "analysis_unavailable"; this.#notify(); }
      }
    }, wait);
  }
  #cancel(): void {
    this.#mapSequence++; this.#analysisSequence++; clearTimeout(this.#mapTimer); clearTimeout(this.#analysisTimer);
    this.#mapping?.abort(); this.#analyzing?.abort();
  }
  stop(): void {
    if (this.#stopped) return; this.#stopped = true; this.#cancel(); this.#unsubscribe();
    this.#turns = []; this.#camera = undefined; this.#analysis = undefined; this.#disposition = undefined; this.#error = undefined;
    this.#voice = undefined; this.#notify();
  }
}
