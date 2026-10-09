import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
const result = await build({ entryPoints: ["demo/app.mjs"], outfile: "demo/bundle.js", bundle: true, platform: "browser", format: "esm", target: "es2022", legalComments: "external", sourcemap: false, metafile: true });
const packages = new Set(Object.keys(result.metafile.inputs).filter(p => p.startsWith("node_modules/")).map(p => p.split("/").slice(1, p.split("/")[1].startsWith("@") ? 3 : 2).join("/")));
const notices = [];
for (const name of packages) {
  const root = `node_modules/${name}`, info = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
  let license;
  for (const file of ["LICENSE", "LICENSE.txt", "LICENSE.md", "license", "license.md"]) { try { license = await readFile(`${root}/${file}`, "utf8"); break; } catch {} }
  if (!license) throw new Error(`Missing bundled dependency license: ${name}`);
  notices.push(`${name} ${info.version} (${info.license})\n${license}`);
}
await writeFile("demo/THIRD_PARTY_LICENSES.txt", notices.join("\n\n"));
