export { survey } from "../demo/survey.mjs";
export const turns = [{ id: "u1", role: "user", text: "週末の昼間がいいです。" }];
export const context = { surveyId: "fictional-workshop", questionId: "schedule", connection: 1, revision: 1 };
export const proposal = (value = "weekend") => ({ answer: { kind: "value", value }, confidence: .88, probability: .94, model: "fixture" });
export function decision(request, picks = {}, confidence = .9, probability = .95) {
  return { model: "jev-fixture", usage: { input_tokens: 40, output_tokens: 4 }, answers: Object.fromEntries(Object.entries(request.questions).map(([key, spec]) => {
    if (spec.type === "noul") return [key, { type: "noul", noul: picks[key] ?? .01 }];
    const choices = Object.keys(spec.criteria); const choice = picks[key] ?? (choices.includes("unknown") ? "unknown" : choices[0]);
    return [key, { type: "choice", choice, confidence, probabilities: Object.fromEntries(choices.map(v => [v, v === choice ? probability : (1 - probability) / (choices.length - 1)])) }];
  })) };
}
export const wait = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
export function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
export function fakeStream() { const track = { stopped: 0, stop() { this.stopped++; } }; return { track, getTracks: () => [track], getAudioTracks: () => [track] }; }
