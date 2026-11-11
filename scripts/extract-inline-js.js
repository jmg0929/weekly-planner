// index.html 안의 <script> 본문(src 없는 것)을 .js 파일로 꺼냄 — 문법 검사 · Semgrep이 읽을 수 있게
// 앞에 빈 줄을 채워서 꺼낸 파일의 줄 번호 = index.html 줄 번호 (검사 결과를 바로 index.html에서 찾을 수 있음)
// 실행: node scripts/extract-inline-js.js [index.html] [.ci/js]
"use strict";
const fs = require("fs"), path = require("path");

function extract(htmlPath, outDir) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const base = path.basename(htmlPath, path.extname(htmlPath));
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  const files = [];
  let m, n = 0;
  fs.mkdirSync(outDir, { recursive: true });
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue;                                        // 외부 파일
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text\/javascript|module)$/i.test(type)) continue;               // JSON 등은 제외
    const bodyStart = m.index + m[0].indexOf(">") + 1;
    const line = html.slice(0, bodyStart).split("\n").length;                       // 본문이 시작하는 줄
    const file = path.join(outDir, `${base}.inline-${++n}.js`);
    fs.writeFileSync(file, "\n".repeat(line - 1) + m[2]);
    files.push({ file, line });
  }
  return files;
}

module.exports = { extract };

if (require.main === module) {
  const files = extract(process.argv[2] || "index.html", process.argv[3] || ".ci/js");
  files.forEach((f) => console.log(`${f.file}  (index.html ${f.line}줄부터)`));
}
