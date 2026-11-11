// 문법 · 형식 검사: index.html 안 스크립트, sw.js, manifest.webmanifest
// 실행: node scripts/check-syntax.js   (실패하면 종료 코드 1)
"use strict";
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const { extract } = require("./extract-inline-js");

const root = path.join(__dirname, "..");
const out = path.join(root, ".ci", "js");
let failed = 0;

function nodeCheck(file, label) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status === 0) { console.log(`ok    ${label}`); return; }
  failed++;
  console.error(`FAIL  ${label}\n${(r.stderr || "").trim()}`);
}

const scripts = extract(path.join(root, "index.html"), out);
if (!scripts.length) { failed++; console.error("FAIL  index.html에서 스크립트를 찾지 못함"); }
scripts.forEach((s, i) => nodeCheck(s.file, `index.html 스크립트 ${i + 1} (${s.line}줄~)`));
nodeCheck(path.join(root, "sw.js"), "sw.js");

try {
  const mf = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  for (const k of ["name", "start_url", "display", "icons"]) if (!(k in mf)) throw new Error(`"${k}" 없음`);
  console.log("ok    manifest.webmanifest");
} catch (e) {
  failed++;
  console.error(`FAIL  manifest.webmanifest — ${e.message}`);
}

if (failed) { console.error(`\n${failed}건 실패`); process.exit(1); }
console.log("\n모두 통과");
