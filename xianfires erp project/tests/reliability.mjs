// Verifies: sessions survive a restart (MySQL store), logout removes the session, health checks the DB,
// and a DB outage gives 503 "Database is offline" instead of a generic error. Runs on a disposable clone.
import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const APP = path.join(ROOT, "xianfires erp project");
const req = createRequire(path.join(APP, "package.json"));
const mysql = req("mysql2/promise");
const bcrypt = req("bcryptjs");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const DB = "xianfires_erp_verify";
const EMAIL = "qa.tester@verify.local", PASS = "Verify-" + Math.random().toString(36).slice(2, 10) + "A1!";
const bin = fs.readdirSync("C:/laragon/bin/mysql").map((d) => `C:/laragon/bin/mysql/${d}/bin`)[0];
const pwArg = env.DB_PASSWORD ? `-p${env.DB_PASSWORD}` : "";
execSync(`"${bin}/mysql" -uroot ${pwArg} -e "DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}"`);
execSync(`"${bin}/mysqldump" -uroot ${pwArg} --single-transaction xianfires_erp | "${bin}/mysql" -uroot ${pwArg} ${DB}`, { shell: "cmd.exe", maxBuffer: 1 << 28 });
const db = await mysql.createConnection({ host: "localhost", user: "root", password: env.DB_PASSWORD || "", database: DB });
await db.query("INSERT INTO admin_user (uuid, status, email, password, full_name, role, created_at, updated_at) VALUES (UUID(), 1, ?, ?, 'QA Tester', 'admin', NOW(), NOW())", [EMAIL, await bcrypt.hash(PASS, 10)]);

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); };

async function start(port, extraEnv = {}) {
  const app = spawn(process.execPath, ["index.js"], { cwd: APP, env: { ...process.env, ...env, DB_NAME: DB, PORT: String(port), DB_HOST: "localhost", DB_USER: "root", DB_PASSWORD: env.DB_PASSWORD || "", ...extraEnv } });
  app.log = ""; app.stdout.on("data", (d) => (app.log += d)); app.stderr.on("data", (d) => (app.log += d));
  for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${port}/admin/login`); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
  return app;
}
const stop = (app) => new Promise((r) => { app.on("exit", r); app.kill(); });

// 1. Sessions survive a restart
let app = await start(3010);
const base = "http://localhost:3010";
const login = await fetch(base + "/admin/user/login", { method: "POST", redirect: "manual", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
check("login works with the MySQL session store", login.status === 200);
const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM admin_session");
check("session row saved in admin_session", n >= 1, `rows=${n}`);
const h1 = await fetch(base + "/api/v1/health");
const h1b = await h1.json();
check("health = 200 and database online", h1.status === 200 && h1b.data.database === "online", JSON.stringify(h1b));
await stop(app);
app = await start(3010);
const after = await fetch(base + "/admin", { redirect: "manual", headers: { cookie } });
check("still logged in after a server restart", after.status === 200, `status=${after.status}`);
const out = await fetch(base + "/admin/user/logout", { redirect: "manual", headers: { cookie } });
const gone = await fetch(base + "/admin", { redirect: "manual", headers: { cookie } });
check("logout ends the session", gone.status === 302, `logout=${out.status} then=${gone.status}`);
const crawl = await fetch(base + "/admin/login");
check("login page still renders", crawl.status === 200);
await stop(app);

// 2. Database offline (wrong port = MySQL unreachable)
const down = await start(3011, { DB_PORT: "3399" });
const b2 = "http://localhost:3011";
const h2 = await fetch(b2 + "/api/v1/health");
const h2b = await h2.json();
check("health = 503 and database offline", h2.status === 503 && h2b.data.database === "offline", JSON.stringify(h2b));
const l2 = await fetch(b2 + "/admin/user/login", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
const l2b = await l2.json();
check("login answers 503 'database is offline'", l2.status === 503 && /offline/i.test(l2b.error?.message), `${l2.status} ${l2b.error?.message}`);
const p2 = await fetch(b2 + "/admin/login");
check("login page still opens without a database", p2.status === 200);
const d2 = await fetch(b2 + "/admin", { redirect: "manual", headers: { cookie } });
const d2html = await d2.text();
check("page with a session shows 'Database is offline'", d2.status === 503 && d2html.includes("Database is offline"), `status=${d2.status}`);
check("server still running after the outage", (await fetch(b2 + "/admin/login")).status === 200);
await stop(down);

await db.end();
execSync(`"${bin}/mysql" -uroot ${pwArg} -e "DROP DATABASE IF EXISTS ${DB}"`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) console.log(down.log.slice(-1500));
