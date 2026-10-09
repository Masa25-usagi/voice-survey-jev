export interface Option { id: string; label: string; meaning?: string }
export interface Source { title: string; publisher: string; url?: string; text: string }
export type Value = string | string[] | number;
interface BaseQuestion {
  id: string;
  title: string;
  explanation?: string;
  sources?: Source[];
  when?: { questionId: string; equals: Value };
}
export type Question =
  | (BaseQuestion & { type: "single"; options: Option[] })
  | (BaseQuestion & { type: "multiple"; options: Option[]; maxSelections?: number })
  | (BaseQuestion & { type: "scale"; min: number; max: number; step?: number; labels?: Record<string, string> })
  | (BaseQuestion & { type: "text"; maxLength?: number });
export interface Survey { id: string; title: string; language?: string; questions: Question[] }
export interface Context { surveyId: string; questionId: string; connection: number; revision: number }
export type Answer = { kind: "value"; value: Value } | { kind: "skip"; reason: "insufficient" | "declined" | "manual" };
export interface Proposal { answer: Answer; confidence: number; probability: number; model: string }
export interface Transcript { id: string; role: "user" | "assistant"; text: string; final: boolean; context: Context }
export type VoiceStatus = "connecting" | "listening" | "user-speaking" | "thinking" | "speaking" | "closed";
export type VoiceEvent =
  | { type: "status"; status: VoiceStatus }
  | { type: "transcript"; transcript: Transcript }
  | { type: "sources" }
  | { type: "profile"; field: string; value: string; evidence: string }
  | { type: "error"; code: string };
export interface SpeakingPreferences { speed?: "slow" | "normal"; detail?: "brief" | "normal" | "detailed"; examples?: "everyday" | "none" }
export interface ProfileField { id: string; label: string; options: (Option & { evidenceTerms?: string[] })[] }
export interface ProfileConfig { fields: ProfileField[] }
export interface VoiceConnection {
  connect(context: Context, question: Question, preferences: SpeakingPreferences, emit: (event: VoiceEvent) => void, signal: AbortSignal, profile?: ProfileConfig): Promise<void>;
  updateContext(text: string): boolean;
  speakQuestion(): void;
  setRevision(context: Context): void;
  resumePlayback?(): Promise<void>;
  disconnect(): void;
}
export type Usage = { inputTokens: number; outputTokens: number };
export function sameContext(a: Context, b: Context): boolean {
  return a.surveyId === b.surveyId && a.questionId === b.questionId && a.connection === b.connection && a.revision === b.revision;
}
export function copy<T>(value: T): T { return structuredClone(value); }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
