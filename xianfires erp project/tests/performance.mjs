// Response-time check: logs in, then times the main pages and APIs (20 requests each, sequential and
// then 10 at once). Usage: node tests/performance.mjs [http://localhost:3000] [admin email] [password]
const BASE = process.argv[2] || "http://localhost:3000";
const EMAIL = process.argv[3] || "admin@djs.local";
const PASS = process.argv[4] || "DjsErp#2026";

const login = await fetch(`${BASE}/admin/user/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
if (login.status !== 200) { console.log(`login failed (${login.status})`); process.exit(1); }

const targets = [
  ["Dashboard", "/admin"],
  ["Chart of Accounts", "/admin/accounting/accounts"],
  ["Journal Entries", "/admin/accounting/journal-entries"],
  ["Trial Balance", "/admin/accounting/reports/trial-balance"],
  ["Income Statement", "/admin/accounting/reports/income-statement"],
  ["Balance Sheet", "/admin/accounting/reports/balance-sheet"],
  ["General Ledger", "/admin/accounting/reports/general-ledger"],
  ["Sales Invoices", "/admin/sales/invoices"],
  ["Audit Log", "/admin/audit-log"],
  ["Health API", "/api/v1/health"]
];
const time = async (url) => {
  const t = performance.now();
  const r = await fetch(BASE + url, { headers: { cookie } });
  await r.arrayBuffer();
  return { ms: performance.now() - t, ok: r.status === 200 };
};
const stats = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)], max: s[s.length - 1] };
};

let worst = 0, failures = 0;
console.log("Page / API".padEnd(20), "median".padStart(8), "p95".padStart(8), "max".padStart(8));
for (const [name, url] of targets) {
  await time(url); // warm-up
  const runs = [];
  for (let i = 0; i < 20; i++) { const r = await time(url); runs.push(r.ms); if (!r.ok) failures++; }
  const s = stats(runs);
  worst = Math.max(worst, s.p95);
  console.log(name.padEnd(20), `${s.median.toFixed(0)} ms`.padStart(8), `${s.p95.toFixed(0)} ms`.padStart(8), `${s.max.toFixed(0)} ms`.padStart(8));
}
// 10 users at the same time on the heaviest report.
const t = performance.now();
const burst = await Promise.all(Array.from({ length: 10 }, () => time("/admin/accounting/reports/general-ledger")));
const burstMs = performance.now() - t;
failures += burst.filter((r) => !r.ok).length;
console.log(`\n10 simultaneous General Ledger requests: all done in ${burstMs.toFixed(0)} ms (slowest ${Math.max(...burst.map((r) => r.ms)).toFixed(0)} ms)`);
console.log(`Slowest p95 of all pages: ${worst.toFixed(0)} ms; failed requests: ${failures}`);
console.log(worst < 500 && failures === 0 ? "RESULT: fast (every page under 0.5 s at p95)" : "RESULT: check the slow pages above");
