// RLS 공격 시나리오 테스트 — 앱과 똑같이 Supabase REST API(PostgREST)로 요청해서 "남의 데이터"를 건드려 봄
// 실제 서버가 아니라 CI 안에서 띄운 로컬 Supabase에 supabase/schema.sql을 적용해서 실행
// 실행: SB_URL=http://127.0.0.1:54321 SB_ANON=<로컬 anon 키> node tests/rls/rls.test.js
"use strict";
const crypto = require("crypto");
const fs = require("fs");

const BASE = process.env.SB_URL, ANON = process.env.SB_ANON;
if (!BASE || !ANON) { console.error("SB_URL, SB_ANON 환경 변수가 필요해요"); process.exit(2); }

const TABLES = ["events", "categories", "todos", "todo_categories"];   // (user_id, id) 기본 키 표
const rnd = () => crypto.randomUUID().slice(0, 8);
const results = [];
let failed = 0;

function check(id, name, ok, detail) {
  results.push({ id, name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${id}  ${name}${ok ? "" : `  — ${detail || ""}`}`);
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error title=RLS ${id}::${name} — ${detail || ""}`);
}

async function api(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: ANON, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (e) { json = text; }
  return { status: r.status, json };
}

// 가입(로컬은 메일 인증 없음) → 앱이 받는 것과 같은 사용자 토큰
async function signup() {
  const r = await fetch(BASE + "/auth/v1/signup", {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `rls-${rnd()}@example.test`, password: "T-" + crypto.randomUUID() }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("가입 실패: " + r.status + " " + JSON.stringify(j).slice(0, 200));
  return { token: j.access_token, id: j.user.id };
}

const UPSERT = "resolution=merge-duplicates,return=representation";   // 앱이 쓰는 방식 (on_conflict=user_id,id)
const rows = (res) => (Array.isArray(res.json) ? res.json : []);
const denied = (res) => res.status === 401 || res.status === 403;

async function readOwn(user, table, id) {
  const r = await api("GET", `/rest/v1/${table}?select=user_id,id,data,updated_at&id=eq.${id}`, { token: user.token });
  return rows(r)[0];
}

async function tableTests(A, B, table, n) {
  const T = `T${n}`, now = Date.now(), id = "a" + rnd();
  // 준비: A가 자기 행을 만듦 (앱과 같은 upsert)
  let r = await api("POST", `/rest/v1/${table}?on_conflict=user_id,id`, { token: A.token, prefer: UPSERT, body: [{ id, data: { t: "A의 비밀" }, deleted: false, updated_at: now }] });
  check(`${T}-01`, `${table}: 본인 행 쓰기 · user_id 자동 = 본인`, r.status === 201 && rows(r)[0] && rows(r)[0].user_id === A.id, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);

  r = await api("GET", `/rest/v1/${table}?select=user_id,id,data`, { token: B.token });
  check(`${T}-02`, `${table}: B가 전체 조회 → A 행 안 보임`, r.status === 200 && !rows(r).some((x) => x.user_id === A.id), `${r.status} ${rows(r).length}행`);

  r = await api("GET", `/rest/v1/${table}?select=*&user_id=eq.${A.id}`, { token: B.token });
  check(`${T}-03`, `${table}: B가 A의 user_id로 필터 → 0행`, r.status === 200 && rows(r).length === 0, `${r.status} ${rows(r).length}행`);

  r = await api("PATCH", `/rest/v1/${table}?user_id=eq.${A.id}&id=eq.${id}`, { token: B.token, prefer: "return=representation", body: { data: { t: "B가 고침" }, updated_at: now + 1000 } });
  let own = await readOwn(A, table, id);
  check(`${T}-04`, `${table}: B가 A 행 수정 → 0행 반영 · 내용 그대로`, rows(r).length === 0 && own && own.data.t === "A의 비밀", `${r.status} 반영 ${rows(r).length} · 현재 ${own && own.data.t}`);

  r = await api("DELETE", `/rest/v1/${table}?user_id=eq.${A.id}&id=eq.${id}`, { token: B.token, prefer: "return=representation" });
  own = await readOwn(A, table, id);
  check(`${T}-05`, `${table}: B가 A 행 삭제 → 0행 · 그대로 있음`, rows(r).length === 0 && !!own, `${r.status} 삭제 ${rows(r).length}`);

  r = await api("POST", `/rest/v1/${table}`, { token: B.token, body: [{ user_id: A.id, id: "b" + rnd(), data: { t: "심기" }, deleted: false, updated_at: now }] });
  check(`${T}-06`, `${table}: B가 user_id=A로 새 행 심기 → 거부`, denied(r), `${r.status}`);

  r = await api("POST", `/rest/v1/${table}?on_conflict=user_id,id`, { token: B.token, prefer: UPSERT, body: [{ user_id: A.id, id, data: { t: "덮어쓰기" }, deleted: false, updated_at: now + 5000 }] });
  own = await readOwn(A, table, id);
  check(`${T}-07`, `${table}: B가 A 행 키로 upsert 덮어쓰기 → 거부 · 그대로`, denied(r) && own && own.data.t === "A의 비밀", `${r.status} · 현재 ${own && own.data.t}`);

  r = await api("PATCH", `/rest/v1/${table}?id=eq.${id}`, { token: A.token, prefer: "return=representation", body: { user_id: B.id } });
  own = await readOwn(A, table, id);
  check(`${T}-08`, `${table}: A가 자기 행을 B에게 넘기기(user_id 변경) → 거부`, denied(r) && !!own, `${r.status}`);

  r = await api("GET", `/rest/v1/${table}?select=*`);
  check(`${T}-09`, `${table}: 로그인 안 한 요청(anon) 조회 → 데이터 없음`, (r.status === 200 && rows(r).length === 0) || denied(r), `${r.status} ${rows(r).length}행`);

  r = await api("POST", `/rest/v1/${table}`, { body: [{ id: "x" + rnd(), data: {}, deleted: false, updated_at: now }] });
  check(`${T}-10`, `${table}: 로그인 안 한 요청(anon) 쓰기 → 거부`, denied(r), `${r.status}`);

  // 무결성: 최신 우선(keep_newer) · 크기 · id 길이
  await api("PATCH", `/rest/v1/${table}?id=eq.${id}`, { token: A.token, body: { data: { t: "옛 기기" }, updated_at: now - 60000 } });
  own = await readOwn(A, table, id);
  check(`${T}-11`, `${table}: 더 옛 시각의 수정은 무시 (keep_newer)`, own && own.data.t === "A의 비밀", `현재 ${own && own.data.t}`);

  r = await api("POST", `/rest/v1/${table}`, { token: A.token, body: [{ id: "big" + rnd(), data: { t: crypto.randomBytes(5000).toString("hex") }, deleted: false, updated_at: now }] });
  check(`${T}-12`, `${table}: data 8KB 넘으면 거부`, r.status === 400, `${r.status}`);

  r = await api("POST", `/rest/v1/${table}`, { token: A.token, body: [{ id: "i".repeat(41), data: {}, deleted: false, updated_at: now }] });
  check(`${T}-13`, `${table}: id 41자 거부`, r.status === 400, `${r.status}`);
}

async function prefsTests(A, B) {
  const now = Date.now();
  let r = await api("POST", "/rest/v1/prefs?on_conflict=user_id", { token: A.token, prefer: UPSERT, body: [{ data: { lec: true }, updated_at: now }] });
  check("P-01", "prefs: 본인 설정 쓰기", r.status === 201 && rows(r)[0] && rows(r)[0].user_id === A.id, `${r.status}`);
  r = await api("GET", "/rest/v1/prefs?select=*", { token: B.token });
  check("P-02", "prefs: B에게 A 설정 안 보임", r.status === 200 && !rows(r).some((x) => x.user_id === A.id), `${r.status}`);
  r = await api("PATCH", `/rest/v1/prefs?user_id=eq.${A.id}`, { token: B.token, prefer: "return=representation", body: { data: { hacked: true }, updated_at: now + 1000 } });
  check("P-03", "prefs: B가 A 설정 수정 → 0행", rows(r).length === 0, `${r.status} ${rows(r).length}`);
  r = await api("POST", "/rest/v1/prefs?on_conflict=user_id", { token: B.token, prefer: UPSERT, body: [{ user_id: A.id, data: { hacked: true }, updated_at: now + 2000 }] });
  check("P-04", "prefs: B가 user_id=A로 upsert → 거부", denied(r), `${r.status}`);
}

// 발견 사항(실패로 세지 않음): 미래 시각으로 저장하면 그 행이 잠김 — keep_newer가 시각 상한을 보지 않음
async function futureClockFinding(A) {
  const id = "f" + rnd(), now = Date.now();
  await api("POST", "/rest/v1/todos", { token: A.token, body: [{ id, data: { t: "시계가 100년 앞선 기기" }, deleted: false, updated_at: now + 100 * 365 * 864e5 }] });
  await api("PATCH", `/rest/v1/todos?id=eq.${id}`, { token: A.token, body: { data: { t: "정상 기기에서 수정" }, updated_at: now + 1000 } });
  const own = await readOwn(A, "todos", id);
  const locked = own && own.data.t !== "정상 기기에서 수정";
  console.log(`info  F-01  미래 시각 행 잠김: ${locked ? "재현됨 (정상 기기의 수정이 무시됨)" : "재현 안 됨"}`);
  if (locked && process.env.GITHUB_ACTIONS) console.log("::warning title=RLS F-01::미래 시각(updated_at)으로 저장된 행은 이후 정상 수정이 모두 무시됨 — 본인 계정 한정 · docs/10 참고");
  return locked;
}

(async () => {
  const A = await signup(), B = await signup();
  console.log(`사용자 A · B 가입 (로컬)\n`);
  for (let i = 0; i < TABLES.length; i++) await tableTests(A, B, TABLES[i], i + 1);
  await prefsTests(A, B);
  const f01 = await futureClockFinding(A);

  const pass = results.length - failed;
  console.log(`\n${pass}/${results.length} 통과${failed ? ` · ${failed} 실패` : ""}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`### RLS 공격 시나리오 — ${pass}/${results.length} 통과`, "", "| ID | 시나리오 | 결과 |", "|---|---|---|"]
      .concat(results.map((x) => `| ${x.id} | ${x.name} | ${x.ok ? "✅" : "❌ " + (x.detail || "")} |`))
      .concat(["", `F-01 미래 시각 행 잠김: ${f01 ? "재현됨 (발견 사항)" : "재현 안 됨"}`]);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
  }
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=RLS::${pass}/${results.length} 통과 · F-01 ${f01 ? "재현됨" : "재현 안 됨"}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); if (process.env.GITHUB_ACTIONS) console.log(`::error title=RLS::${String(e.message).slice(0, 300)}`); process.exit(1); });
