// Docker check: run AFTER `docker compose up -d --build` in "xianfires erp project".
//   node tests/docker.mjs [http://localhost:3000] [admin email] [admin password]
// Checks the running containers: health, login, posting, receipts storage, backup + restore (inside the
// container), a restart keeping the login, and the database-offline page when MySQL stops.
import { execSync } from "node:child_process";

const BASE = process.argv[2] || "http://localhost:3000";
const EMAIL = process.argv[3] || process.env.DOCKER_ADMIN_EMAIL || "admin@djs.local";
const PASS = process.argv[4] || process.env.DOCKER_ADMIN_PASSWORD || "DjsErp#2026";
const compose = (args) => execSync(`docker compose ${args}`, { cwd: new URL("..", import.meta.url), stdio: "pipe" }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); };
const waitHealthy = async (want = 200, ms = 120000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(2000)) {
    try { const r = await fetch(`${BASE}/api/v1/health`); if (r.status === want) return true; } catch { /* starting */ }
  }
  return false;
};

const ps = compose("ps --format \"{{.Service}} {{.Health}}\"");
check("both containers healthy", /accounting healthy/.test(ps) && /db healthy/.test(ps), ps.trim().replace(/\s+/g, " "));
const h = await (await fetch(`${BASE}/api/v1/health`)).json();
check("health: app ok, database online", h?.data?.database === "online", JSON.stringify(h));

const login = await fetch(`${BASE}/admin/user/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
check("admin can log in", login.status === 200, `status=${login.status}`);
const call = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { cookie, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
for (const page of ["/admin", "/admin/accounting/accounts", "/admin/accounting/reports/trial-balance", "/admin/backups"]) {
  const r = await fetch(BASE + page, { headers: { cookie }, redirect: "manual" });
  check(`page ${page}`, r.status === 200, `status=${r.status}`);
}
const accounts = await (await fetch(`${BASE}/admin/accounting/accounts`, { headers: { cookie } })).text();
check("default chart of accounts loaded", accounts.includes("Cash in Bank") && accounts.includes("Sales Revenue"));

// Post a balanced entry through the app (account ids come from the New journal entry page's data).
const jePage = await (await fetch(`${BASE}/admin/accounting/journal-entries/new`, { headers: { cookie } })).text();
const pageData = JSON.parse(jePage.match(/id="journal-page-data">([\s\S]*?)<\/script>/)?.[1] || "{}");
const byCode = (code) => (pageData.accounts || []).find((a) => a.code === code)?.uuid;
const today = new Date().toISOString().slice(0, 10);
const je = await call("POST", "/api/accounting/journal-entries", { entry_date: today, description: "Docker check: owner capital", lines: [{ account: byCode("1010"), debit: 1000 }, { account: byCode("3000"), credit: 1000 }] });
check("journal entry posts inside Docker", je.status === 200 || je.status === 201, `status=${je.status} ${JSON.stringify(je.body?.error || "")}`);
const bad = await call("POST", "/api/accounting/journal-entries", { entry_date: today, description: "unbalanced", lines: [{ account: byCode("1010"), debit: 1000 }, { account: byCode("3000"), credit: 900 }] });
check("unbalanced entry refused", bad.status === 400);

// Backup and restore run mysqldump / mysql inside the container.
const b = await call("POST", "/api/backups", {});
check("backup made inside the container", b.status === 200 && /\.sql$/.test(b.body?.data?.name || ""), JSON.stringify(b.body));
const after = await call("POST", "/api/accounting/journal-entries", { entry_date: today, description: "Docker check: after backup", lines: [{ account: byCode("1010"), debit: 50 }, { account: byCode("3000"), credit: 50 }] });
check("change after backup", after.status === 200 || after.status === 201);
const r = await call("POST", `/api/backups/${encodeURIComponent(b.body?.data?.name || "x")}/restore`, { confirm: "RESTORE" });
check("restore works inside the container", r.status === 200, JSON.stringify(r.body).slice(0, 160));
const journals = await (await fetch(`${BASE}/admin/accounting/journal-entries?q=Docker+check`, { headers: { cookie } })).text();
check("restore removed the later change", journals.includes("owner capital") && !journals.includes("after backup"));

// Restart: the session is stored in MySQL, so the login survives.
compose("restart accounting");
check("app healthy again after restart", await waitHealthy(200));
const again = await fetch(`${BASE}/admin`, { headers: { cookie }, redirect: "manual" });
check("still logged in after a container restart", again.status === 200, `status=${again.status}`);

// Database stops: the app stays up and says so; it recovers when MySQL is back.
compose("stop db");
check("health says database offline (503)", await waitHealthy(503, 60000));
const off = await fetch(`${BASE}/admin`, { headers: { cookie }, redirect: "manual" });
check("pages show 'Database is offline'", off.status === 503 && (await off.text()).includes("Database is offline"), `status=${off.status}`);
compose("start db");
check("recovers when MySQL is back", await waitHealthy(200, 120000));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
