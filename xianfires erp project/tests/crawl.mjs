// Crawl every Accounting admin page on a disposable clone (xianfires_erp_verify) as an admin.
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
const DB = "xianfires_erp_verify", PORT = 3010, BASE = `http://localhost:${PORT}`;
const EMAIL = "qa.tester@verify.local", PASS = "Verify-" + Math.random().toString(36).slice(2, 10) + "A1!";
const bin = fs.readdirSync("C:/laragon/bin/mysql").map((d) => `C:/laragon/bin/mysql/${d}/bin`)[0];
const pwArg = env.DB_PASSWORD ? `-p${env.DB_PASSWORD}` : "";

execSync(`"${bin}/mysql" -uroot ${pwArg} -e "DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}"`);
execSync(`"${bin}/mysqldump" -uroot ${pwArg} --single-transaction --routines xianfires_erp | "${bin}/mysql" -uroot ${pwArg} ${DB}`, { shell: "cmd.exe", maxBuffer: 1 << 28 });

const db = await mysql.createConnection({ host: "localhost", user: "root", password: env.DB_PASSWORD || "", database: DB });
await db.query("DELETE FROM admin_user WHERE email = ?", [EMAIL]);
await db.query("INSERT INTO admin_user (uuid, status, email, password, full_name, role, created_at, updated_at) VALUES (UUID(), 1, ?, ?, 'QA Tester', 'admin', NOW(), NOW())", [EMAIL, await bcrypt.hash(PASS, 10)]);

const app = spawn(process.execPath, ["index.js"], { cwd: APP, env: { ...process.env, ...env, DB_NAME: DB, PORT: String(PORT), DB_HOST: "localhost", DB_USER: "root", DB_PASSWORD: env.DB_PASSWORD || "" } });
let log = "";
app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 40; i++) { try { await fetch(BASE + "/admin/login"); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }

let cookie = "";
const r = await fetch(BASE + "/admin/user/login", { method: "POST", redirect: "manual", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
cookie = (r.headers.get("set-cookie") || "").split(";")[0];
console.log("login", r.status);

const seen = new Set(), queue = ["/admin"], problems = [];
while (queue.length && seen.size < 400) {
  const u = queue.shift();
  if (seen.has(u)) continue; seen.add(u);
  const res = await fetch(BASE + u, { redirect: "manual", headers: { cookie } });
  const ct = res.headers.get("content-type") || "";
  if (res.status >= 300 && res.status < 400) { const loc = res.headers.get("location"); if (loc && loc.startsWith("/admin") && !loc.includes("logout")) queue.push(loc); continue; }
  if (res.status !== 200) { problems.push(`${res.status} ${u}`); continue; }
  if (!ct.includes("html")) continue;
  const html = await res.text();
  if (/\{\{|undefined|NaN|\[object Object\]|Internal Server Error|Something went wrong/.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) problems.push(`SUSPECT ${u}: ${(html.replace(/<script[\s\S]*?<\/script>/g, "").match(/.{0,60}(\{\{|undefined|NaN|\[object Object\]|Internal Server Error|Something went wrong).{0,60}/) || [""])[0].replace(/\s+/g, " ")}`);
  for (const m of html.matchAll(/href="(\/admin[^"#?]*)(\?[^"#]*)?"/g)) {
    const link = m[1] + (m[2] || "").replace(/&amp;/g, "&");
    if (/logout|export|download|\.csv|receipt/i.test(link)) continue;
    if (!seen.has(link)) queue.push(link);
  }
}
console.log("pages", seen.size);
console.log(problems.length ? problems.join("\n") : "no page problems");
const errs = log.split(/\r?\n/).filter((l) => /error|exception|warn/i.test(l));
console.log("server log issues:", errs.length ? "\n" + errs.slice(0, 30).join("\n") : "none");
app.kill();
await db.end();
