import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSurveyHandler } from "../dist/server/index.js";
import { createFeatureSurveyHandler } from "../dist/server/features.js";
import { speakingProfile } from "../dist/profile.js";
import { survey } from "./survey.mjs";
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT ?? 4387);
const origin = `http://127.0.0.1:${port}`;
const allowedOrigins = [origin, `http://localhost:${port}`];
const live = process.env.VOICE_SURVEY_LIVE === "1";
const models = {};
if (live && process.env.GEMINI_API_KEY && process.env.GEMINI_LIVE_MODEL) models.gemini = { provider: "gemini", model: process.env.GEMINI_LIVE_MODEL, label: "Gemini Live" };
if (live && process.env.OPENAI_API_KEY && process.env.OPENAI_REALTIME_MODEL) models.openai = { provider: "openai", model: process.env.OPENAI_REALTIME_MODEL, label: "OpenAI Realtime" };
if (live && process.env.OPENAI_API_KEY && process.env.OPENAI_REALTIME_MINI_MODEL) models.openai_mini = { provider: "openai", model: process.env.OPENAI_REALTIME_MINI_MODEL, label: "OpenAI Realtime Mini" };
let windowStart = Date.now(), requests = 0;
const options = { survey, allowedOrigins, authorize: () => live, consumeBudget: () => { if (Date.now() - windowStart > 60000) { windowStart = Date.now(); requests = 0; } return ++requests <= 60; }, typesafeApiKey: process.env.TYPESAFE_API_KEY, geminiApiKey: process.env.GEMINI_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY, openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL, visionModel: process.env.GEMINI_VISION_MODEL, models, profile: speakingProfile };
if (live && (!process.env.FEATURE_BUNDLE || !process.env.TYPESAFE_API_KEY)) throw new Error("Live feature mode requires FEATURE_BUNDLE and your own TYPESAFE_API_KEY. Train weights on actual Jev features first.");
const handler = live ? createFeatureSurveyHandler({ ...options, bundle: JSON.parse(await readFile(process.env.FEATURE_BUNDLE, "utf8")) }) : createSurveyHandler({ ...options, authorize: () => false });
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };
const server = createServer(async (req, res) => {
  const ac = new AbortController(); req.on("aborted", () => ac.abort()); res.on("close", () => { if (!res.writableEnded) ac.abort(); });
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === "/demo-config") { res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify({ offline: !live, camera: live && !!process.env.GEMINI_VISION_MODEL && !!process.env.GEMINI_API_KEY, models: Object.entries(models).map(([key, m]) => ({ key, provider: m.provider, label: m.label })) })); return; }
    if (url.pathname.startsWith("/api/voice-survey/")) {
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: req, duplex: "half" }), signal: ac.signal });
      const response = await handler(request); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const relative = url.pathname === "/" ? "demo/index.html" : ["/index.html", "/style.css", "/bundle.js", "/bundle.js.LEGAL.txt", "/THIRD_PARTY_LICENSES.txt"].includes(url.pathname) ? `demo${url.pathname}` : url.pathname.startsWith("/dist/") ? decodeURIComponent(url.pathname).slice(1) : undefined;
    if (!relative || !["GET", "HEAD"].includes(req.method)) { res.writeHead(404); res.end("Not found"); return; }
    const file = resolve(project, relative); if (!file.startsWith(project + sep) || relative.includes("..")) { res.writeHead(404); res.end("Not found"); return; }
    const content = await readFile(file);
    res.setHeader("Content-Type", mime[extname(file)] ?? "text/plain; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(req.method === "HEAD" ? undefined : content);
  } catch { if (!res.headersSent) res.writeHead(500); res.end("Demo request unavailable"); }
});
server.listen(port, "127.0.0.1", () => console.log(`Fictional survey demo: ${origin}`));
