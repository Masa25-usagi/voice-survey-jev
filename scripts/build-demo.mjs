import { build } from "esbuild";
import { readFile, readdir, writeFile } from "node:fs/promises";
const result = await build({ entryPoints: ["demo/app.mjs"], outfile: "demo/bundle.js", bundle: true, platform: "browser", format: "esm", target: "es2022", legalComments: "external", sourcemap: false, metafile: true });
const packages = new Set(Object.keys(result.metafile.inputs).filter(p => p.startsWith("node_modules/")).map(p => p.split("/").slice(1, p.split("/")[1].startsWith("@") ? 3 : 2).join("/")));
const notices = [];
for (const name of packages) {
  const root = `node_modules/${name}`, info = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
  const entries = await readdir(root, { withFileTypes: true });
  const licenses = entries.filter(f => f.isFile() && /^licen[cs]e(?:\.(?:txt|md))?$/i.test(f.name)).map(f => f.name);
  if (!licenses.length) throw new Error(`Missing bundled dependency license: ${name}`);
  const files = [...licenses, ...entries.filter(f => f.isFile() && /^notice(?:\.(?:txt|md))?$/i.test(f.name)).map(f => f.name)].sort();
  const texts = await Promise.all(files.map(async file => `${file}\n${await readFile(`${root}/${file}`, "utf8")}`));
  notices.push(`${name} ${info.version} (${info.license})\n${texts.join("\n")}`);
}
await writeFile("demo/THIRD_PARTY_LICENSES.txt", notices.join("\n\n"));
