// 실행: node tests/sw-cache-policy.test.js sw.js   (TC-14: 서비스워커 캐시 범위)
// sw.js를 수정 없이 불러와서 fetch 처리 규칙만 시험 (가짜 self / caches / fetch)
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(process.argv[2], "utf8");
const listeners = {}, stored = [], netCalls = [];
const cacheObj = { put: (req, resp) => { stored.push(req.url); return Promise.resolve(); }, addAll: () => Promise.resolve() };
const ctx = {
  self: { location: { origin: "https://jmg0929.github.io" }, addEventListener: (t, f) => (listeners[t] = f), skipWaiting() {}, clients: { claim() {} } },
  caches: { match: () => Promise.resolve(undefined), open: () => Promise.resolve(cacheObj), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
  fetch: (req) => { netCalls.push(req.url); return Promise.resolve({ clone() { return {}; } }); },
  URL, console, Promise,
};
vm.createContext(ctx); vm.runInContext(src, ctx);
const urls = [
  ["GET", "https://jmg0929.github.io/weekly-planner/index.html", true],
  ["GET", "https://jmg0929.github.io/weekly-planner/icon-192.png", true],
  ["GET", "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css", true],
  ["GET", "https://PROJECT.supabase.co/rest/v1/events?select=id,data", false],
  ["GET", "https://PROJECT.supabase.co/auth/v1/user", false],
  ["POST", "https://PROJECT.supabase.co/auth/v1/token?grant_type=password", false],
  ["GET", "https://date.nager.at/api/v3/PublicHolidays/2026/KR", false],
  ["GET", "https://challenges.cloudflare.com/x.js", false],
];
(async () => {
  let ok = true;
  for (const [method, url, expectCache] of urls) {
    stored.length = 0; let responded = false;
    const ev = { request: { method, url }, respondWith: (p) => { responded = true; return p; } };
    const r = listeners.fetch(ev);
    await new Promise((res) => setTimeout(res, 20));
    const cached = stored.includes(url);
    const pass = cached === expectCache && responded === expectCache;
    ok = ok && pass;
    console.log((pass ? "PASS" : "FAIL") + "  " + method + " " + url.replace(/\?.*/, "") + "  handled=" + responded + " cached=" + cached);
  }
  console.log(ok ? "ALL PASS" : "SOME FAILED");
})();
