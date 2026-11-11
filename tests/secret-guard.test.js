// 실행: node tests/secret-guard.test.js   (커밋 직전 비밀값 검사 규칙이 실제로 잡는지 / 공개값은 통과시키는지)
// 가짜 키는 실행할 때 만들어서 저장소에는 키 모양 문자열이 남지 않게 함
"use strict";
const crypto = require("crypto");
const { scanLines } = require("../scripts/secret-guard");

const rand = (n) => crypto.randomBytes(n).toString("base64url").replace(/[-_]/g, "x").slice(0, n);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.${rand(43)}`;

const cases = [
  ["새 형식 서버 키", `const K = "sb_${"secret"}_${rand(32)}";`, "supabase-secret-key"],
  ["service_role JWT", `key: "${jwt({ iss: "supabase", role: "service_role" })}"`, "supabase-service-role-jwt"],
  ["service_role JWT (다른 정렬)", `x=${jwt({ iss: "supabase-x", ref: "abc", role: "service_role" })}`, "supabase-service-role-jwt"],
  ["개인 키", `-----BEGIN ${"PRIVATE"} KEY-----`, "private-key"],
  ["AWS 키", `AKIA${rand(16).toUpperCase().replace(/[^A-Z0-9]/g, "Q")}`, "aws-access-key"],
  ["GitHub 토큰", `token=ghp_${rand(36)}`, "github-token"],
  ["공개용 키는 통과", `var SB_KEY = "sb_publishable_${rand(32)}";`, null],
  ["anon JWT는 통과", `key: "${jwt({ iss: "supabase", role: "anon" })}"`, null],
  ["평범한 코드는 통과", `el.innerHTML = esc(t.title);`, null],
];

let fail = 0;
for (const [name, text, expect] of cases) {
  const hits = scanLines([{ file: "t", line: 1, text }]).map((h) => h.rule.id);
  const ok = expect ? hits.includes(expect) : hits.length === 0;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (기대 ${expect}, 결과 ${hits.join(",") || "없음"})`}`);
  if (!ok) fail++;
}
if (fail) { console.error(`\n${fail}건 실패`); process.exit(1); }
console.log(`\n${cases.length}건 모두 통과`);
