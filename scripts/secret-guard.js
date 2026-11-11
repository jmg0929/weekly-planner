// 커밋 직전 비밀값 검사 (설치 없이 Node만으로 동작하는 1차 방어선 — CI에서는 gitleaks가 전체 이력을 다시 검사)
// 실행: node scripts/secret-guard.js            → 이번 커밋에 추가되는 줄(git diff --cached)만 검사
//       node scripts/secret-guard.js 파일...     → 지정한 파일 전체 검사
"use strict";
const fs = require("fs"), { execFileSync } = require("child_process");

const RULES = [
  { id: "supabase-secret-key", why: "Supabase 서버 키 (RLS 무시)", re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { id: "supabase-service-role-jwt", why: "Supabase service_role 키 (RLS 무시)", test: hasServiceRoleJwt },
  { id: "private-key", why: "개인 키", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "aws-access-key", why: "AWS 액세스 키", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { id: "github-token", why: "GitHub 토큰", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
];

// JWT를 찾아 본문을 실제로 풀어 보고 role이 service_role인지 확인 (anon 키 등은 통과)
function hasServiceRoleJwt(line) {
  const jwts = line.match(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  return jwts.some((t) => {
    try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8")).role === "service_role"; }
    catch (e) { return false; }
  });
}

function scanLines(lines) {
  const hits = [];
  for (const { file, line, text } of lines) {
    for (const r of RULES) {
      if (r.re ? r.re.test(text) : r.test(text)) hits.push({ file, line, rule: r });
    }
  }
  return hits;
}

// git diff --cached -U0 결과에서 "추가된 줄"과 그 파일 · 줄 번호만 뽑음
function stagedLines() {
  const diff = execFileSync("git", ["diff", "--cached", "-U0", "--no-color", "--no-ext-diff"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = [];
  let file = null, ln = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) { file = raw.slice(4).replace(/^b\//, ""); continue; }
    const h = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) { ln = +h[1]; continue; }
    if (raw.startsWith("+") && file) out.push({ file, line: ln++, text: raw.slice(1) });
  }
  return out;
}

// 지워진 파일 · 큰 파일(이미지 등)은 건너뜀
function fileLines(files) {
  return files
    .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile() && fs.statSync(f).size < 2 * 1024 * 1024)
    .flatMap((f) => fs.readFileSync(f, "utf8").split("\n").map((text, i) => ({ file: f, line: i + 1, text })));
}

module.exports = { scanLines, hasServiceRoleJwt };

if (require.main === module) {
  const args = process.argv.slice(2);
  const hits = scanLines(args.length ? fileLines(args) : stagedLines());
  if (!hits.length) { console.log("secret-guard: 비밀값 없음"); process.exit(0); }
  console.error("secret-guard: 비밀값으로 보이는 내용이 있어 커밋을 막았어요.\n");
  hits.forEach((h) => console.error(`  ${h.file}:${h.line}  [${h.rule.id}] ${h.rule.why}`));   // 값 자체는 출력하지 않음
  console.error("\n키는 저장소에 넣지 말고 서버(Supabase 대시보드 · GitHub Secrets)에만 두세요.");
  process.exit(1);
}
