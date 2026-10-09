import type { ProfileConfig, Question, SpeakingPreferences, Survey } from "../types.js";
import { isRecord } from "../types.js";
import { optionsFor } from "../survey.js";
export function speakingPreferences(input: unknown): SpeakingPreferences {
  if (input === undefined) return {};
  if (!isRecord(input)) throw new Error("Invalid preferences");
  const out: SpeakingPreferences = {};
  for (const [key, allowed] of Object.entries({ speed: ["slow", "normal"], detail: ["brief", "normal", "detailed"], examples: ["everyday", "none"] })) {
    if (input[key] === undefined) continue;
    if (!allowed.includes(String(input[key]))) throw new Error("Invalid preferences");
    Object.assign(out, { [key]: input[key] });
  }
  return out;
}
export function interviewInstructions(survey: Survey, question: Question, preferences: SpeakingPreferences, profile?: ProfileConfig): string {
  const rules = "あなたはアンケートの聞き手です。自然な日本語で短く受け止め、一度に一つの問いを扱ってください。質問や根拠資料を必要に応じて分かりやすく説明し、複数の見方を公平に示してください。賛否・正解・選択肢を誘導せず、曖昧なときだけ一度の短い追加質問にしてください。回答の分類は別の判定器と本人の画面操作が行います。回答を確定したと言わず、勝手に次問へ進まないでください。知識が足りないことと中立の回答を区別してください。利用者が話し始めたら譲ってください。資料の表示にはshow_sourcesを使えます。後から届く会話補助情報には返事や割り込みをせず、次の自然な返答にだけ反映してください。人物属性や表情から気持ち・理解力・好み・回答を推測しないでください。";
  if (profile) return rules + "いまは任意の自己紹介です。次の項目について、分かる範囲で希望を一度だけ聞いてください。未回答を埋める追質問は不要です。本人が明確に述べた希望だけprofile_choiceで提案し、evidenceには本人の言葉をそのまま短く指定してください。確認や訂正は画面で本人が行います。本人がスキップしたら追わず、画面の操作で質問へ移るまで設問には答えを求めないでください。" + JSON.stringify(profile);
  return rules + JSON.stringify({ surveyTitle: survey.title, language: survey.language ?? "ja", currentQuestion: { title: question.title, type: question.type, explanation: question.explanation, options: optionsFor(question), sources: question.sources ?? [] }, speakingPreferences: preferences });
}
export const sourceTool = { name: "show_sources", description: "Request display of the current survey question's references.", parameters: { type: "object", properties: {}, additionalProperties: false } };
export const profileTool = { name: "profile_choice", description: "Propose an optional explicitly stated profile value for the respondent to review.", parameters: { type: "object", properties: { field: { type: "string" }, value: { type: "string" }, evidence: { type: "string" } }, required: ["field", "value", "evidence"], additionalProperties: false } };
