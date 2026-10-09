import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const excluded = new Set([".git", "node_modules", "dist"]);
async function sourceFiles(directory = ".") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (!entry.name.endsWith(".tgz") && !entry.name.startsWith("bundle.js")) files.push(path);
  }
  return files;
}
let files;
try { files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean); } catch { files = await sourceFiles(); }
if (!files.length) files = await sourceFiles();
const privateRoot = new RegExp("/" + "Users" + "/(?!example(?:/|\\b))[^\\s\"'<>]+");
const patterns = [
  ["private path", privateRoot],
  ["private home path", new RegExp("/" + "home" + "/(?!example(?:/|\\b))[^\\s\"'<>]+")],
  ["deployment host", /[a-z0-9-]+\.chatgpt\.site/i],
  ["long-term key", /\b(?:sk-[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,})\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
];
const emailPattern = /[A-Za-z0-9._%+-]+@(?!(?:example\.(?:com|org)|users\.noreply\.github\.com)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// These are the exact public copyright contacts in the bundled dependency notices.
// Preserve those notices; this exception applies to that generated file only.
const copyrightContacts = new Set(["tim" + "@" + "debuggable.com", "felix" + "@" + "debuggable.com", "sindresorhus" + "@" + "gmail.com"]);
const findings = [];
for (const file of files) {
  if ((/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example")) || /(?:credentials?\.json|connection\.json|\.(?:pem|p12|png|jpe?g|webp|wav|mp3|m4a|mp4|pdf|zip))$/i.test(file)) findings.push({ file, kind: "excluded file type" });
  const content = await readFile(file, "utf8");
  for (const [kind, pattern] of patterns) if (pattern.test(content)) findings.push({ file, kind });
  for (const email of content.match(emailPattern) ?? []) if (file !== "demo/THIRD_PARTY_LICENSES.txt" || !copyrightContacts.has(email)) findings.push({ file, kind: "personal email" });
}
if (findings.length) { for (const f of findings) console.error(`${f.file}: ${f.kind}`); process.exitCode = 1; }
else console.log(`Public-source pattern check passed (${files.length} files). Run an independent secrets scanner and manual content review before publication.`);
