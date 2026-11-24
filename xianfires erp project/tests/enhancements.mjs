// E2E for backups, CSV export buttons, payroll summary/payslip and sidebar labels, on disposable clones.
import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const APP = path.join(ROOT, "xianfires erp project");
const HR = path.join(ROOT, "DJs-Human-Resource-Management-main");
const BACKUPS = path.join(APP, "storage", "backups");
const reqA = createRequire(path.join(APP, "package.json"));
const mysql = reqA("mysql2/promise");
const bcryptjs = reqA("bcryptjs");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const ADB = "xianfires_erp_verify", HDB = "djs_hr_verify";
const A = "http://localhost:3010", H = "http://localhost:3012";
const PASS = "Verify-" + Math.random().toString(36).slice(2, 10) + "A1!";
const bin = fs.readdirSync("C:/laragon/bin/mysql").map((d) => `C:/laragon/bin/mysql/${d}/bin`)[0];
const pwArg = env.DB_PASSWORD ? `-p${env.DB_PASSWORD}` : "";
const clone = (from, to) => {
  execSync(`"${bin}/mysql" -uroot ${pwArg} -e "DROP DATABASE IF EXISTS ${to}; CREATE DATABASE ${to}"`);
  execSync(`"${bin}/mysqldump" -uroot ${pwArg} --single-transaction ${from} | "${bin}/mysql" -uroot ${pwArg} ${to}`, { shell: "cmd.exe", maxBuffer: 1 << 28 });
};
clone("xianfires_erp", ADB);
clone("djs_hr", HDB);
const adb = await mysql.createConnection({ host: "localhost", user: "root", password: env.DB_PASSWORD || "", database: ADB, timezone: "Z" });
for (const [email, role] of [["qa.admin@verify.local", "admin"], ["qa.viewer@verify.local", "viewer"]]) {
  await adb.query("INSERT INTO admin_user (uuid, status, email, password, full_name, role, created_at, updated_at) VALUES (UUID(), 1, ?, ?, 'QA', ?, NOW(), NOW())", [email, await bcryptjs.hash(PASS, 10), role]);
}

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); };
function start(cwd, port, extra) {
  const app = spawn(process.execPath, ["index.js"], { cwd, env: { ...process.env, ...env, DB_HOST: "localhost", DB_USER: "root", DB_PASSWORD: env.DB_PASSWORD || "", PORT: String(port), ...extra } });
  app.log = ""; app.stdout.on("data", (d) => (app.log += d)); app.stderr.on("data", (d) => (app.log += d));
  return app;
}
const ready = async (url) => { for (let i = 0; i < 80; i++) { try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 300)); } } };
const hrApp = start(HR, 3012, { DB_NAME: HDB, ERP_URL_ERP: A });
const acApp = start(APP, 3010, { DB_NAME: ADB, ERP_URL_HR: H });
await ready(`${A}/admin/login`); await ready(`${H}/login`);

const login = async (email) => (await fetch(`${A}/admin/user/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email, password: PASS }) })).headers.get("set-cookie").split(";")[0];
const admin = await login("qa.admin@verify.local");
const viewer = await login("qa.viewer@verify.local");
const get = (cookie, url) => fetch(A + url, { redirect: "manual", headers: { cookie } });
const call = async (cookie, method, url, body) => {
  const r = await fetch(A + url, { method, headers: { cookie, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const before = new Set(fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS) : []);

// ---- Backups
let r = await get(admin, "/admin/backups");
check("backup page opens for admin", r.status === 200 && (await r.text()).includes("Back up now"));
check("backup page refused for viewer", (await get(viewer, "/admin/backups")).status === 403);
check("viewer cannot make a backup", (await call(viewer, "POST", "/api/backups", {})).status === 403);
const b1 = await call(admin, "POST", "/api/backups", {});
check("backup made", b1.status === 200 && /^xianfires_erp_verify-\d{8}-\d{6}\.sql$/.test(b1.body?.data?.name), JSON.stringify(b1.body));
const b1name = b1.body?.data?.name;
const b1file = path.join(BACKUPS, b1name || "x");
check("backup file is a MySQL dump", fs.existsSync(b1file) && /MySQL dump/.test(fs.readFileSync(b1file, "utf8").slice(0, 400)));
check("sessions are not in the backup", !/INSERT INTO `admin_session`/.test(fs.readFileSync(b1file, "utf8")));
const page = await (await get(admin, "/admin/backups")).text();
check("backup listed", page.includes(b1name));
const dl = await get(admin, `/admin/backups/download/${encodeURIComponent(b1name)}`);
check("download works", dl.status === 200 && /attachment/.test(dl.headers.get("content-disposition") || ""));
check("download refuses path tricks", (await get(admin, "/admin/backups/download/..%2F..%2F.env")).status === 404);
check("download refuses viewer", (await get(viewer, `/admin/backups/download/${encodeURIComponent(b1name)}`)).status === 403);

// Change the books after the backup, then restore and see the change disappear.
const [[acc]] = await adb.query("SELECT uuid FROM accounting_account WHERE code = '1010'");
const [[cap]] = await adb.query("SELECT uuid FROM accounting_account WHERE code = '3000'");
const today = new Date().toISOString().slice(0, 10);
const je = await call(admin, "POST", "/api/accounting/journal-entries", { entry_date: today, description: "QA after-backup entry", lines: [{ account: acc.uuid, debit: 123.45 }, { account: cap.uuid, credit: 123.45 }] });
check("change made after backup", je.status === 200 || je.status === 201, JSON.stringify(je.body).slice(0, 120));
const count = async () => (await adb.query("SELECT COUNT(*) n FROM accounting_journal_entry WHERE description = 'QA after-backup entry'"))[0][0].n;
check("change is in the books", Number(await count()) === 1);
r = await call(admin, "POST", `/api/backups/${encodeURIComponent(b1name)}/restore`, { confirm: "yes" });
check("restore needs the word RESTORE", r.status === 400 && /RESTORE/.test(r.body?.error?.message), r.body?.error?.message);
r = await call(admin, "POST", `/api/backups/${encodeURIComponent("../../x.sql")}/restore`, { confirm: "RESTORE" });
check("restore refuses unknown files", r.status === 400 || r.status === 404, `status=${r.status}`);
r = await call(admin, "POST", `/api/backups/${encodeURIComponent(b1name)}/restore`, { confirm: "RESTORE" });
check("restore works", r.status === 200 && /before-restore\.sql$/.test(r.body?.data?.safetyCopy || ""), JSON.stringify(r.body));
check("change is gone after restore", Number(await count()) === 0);
check("still logged in after restore", (await get(admin, "/admin")).status === 200);
const safety = r.body?.data?.safetyCopy;
check("safety copy has the change", safety && fs.readFileSync(path.join(BACKUPS, safety), "utf8").includes("QA after-backup entry"));
const [[audit]] = await adb.query("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'backup.%'");
check("restore is in the audit log", Number(audit.n) >= 1, `n=${audit.n}`);
r = await call(admin, "DELETE", `/api/backups/${encodeURIComponent(b1name)}`);
check("backup deleted", r.status === 200 && !fs.existsSync(b1file));

// ---- Export buttons, payroll summary, payslip, sidebar
const tb = await (await get(admin, "/admin/accounting/reports/trial-balance")).text();
check("reports keep Print (Export is added beside it)", tb.includes("data-print"));
for (const [label, url] of [["journal", "/admin/accounting/journal-entries"], ["invoices", "/admin/sales/invoices"], ["accounts", "/admin/accounting/accounts"], ["customers", "/admin/sales/customers"], ["audit", "/admin/audit-log"], ["payroll", "/admin/accounting/payroll"]]) {
  const html = await (await get(admin, url)).text();
  check(`Export button on ${label}`, html.includes("data-export-csv"));
}
const js = await (await fetch(`${A}/js/admin.js`)).text();
check("exporter in admin.js", js.includes("XF.exportCsv") && js.includes("fromCharCode(0xfeff)"));
const rep = await get(admin, "/admin/accounting/payroll/report");
const repHtml = await rep.text();
check("payroll summary opens", rep.status === 200 && repHtml.includes("Payroll Summary") && repHtml.includes("Total ("), `status=${rep.status}`);
const [[paid]] = await (await mysql.createConnection({ host: "localhost", user: "root", password: env.DB_PASSWORD || "", database: HDB })).query("SELECT id, periodStart, periodEnd FROM hr_payrolls WHERE status = 'Paid' ORDER BY id LIMIT 1");
check("summary lists a paid employee", repHtml.includes(`/admin/accounting/payroll/payslip/`), "");
const slip = await get(admin, `/admin/accounting/payroll/payslip/${paid.id}`);
const slipHtml = await slip.text();
check("payslip opens", slip.status === 200 && slipHtml.includes("Net pay") && slipHtml.includes("Gross pay"), `status=${slip.status}`);
check("payslip for unknown id is 404", (await get(admin, "/admin/accounting/payroll/payslip/999999")).status === 404);
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : String(d)); paid.periodStart = ymd(paid.periodStart); paid.periodEnd = ymd(paid.periodEnd);
const period = `${paid.periodStart}_${paid.periodEnd}`;
check("summary filters by period", (await (await get(admin, `/admin/accounting/payroll/report?period=${period}`)).text()).includes(`${paid.periodStart} to ${paid.periodEnd}`));
const dash = await (await get(admin, "/admin")).text();
// 7 menu sections + the Light/Dark button.
check("sidebar has labels", (dash.match(/class="rail-label"/g) || []).length === 8 && dash.includes("data-theme-toggle"));
const vdash = await (await get(viewer, "/admin")).text();
check("viewer sidebar hides Admin", (vdash.match(/class="rail-label"/g) || []).length === 7 && !vdash.includes(">Admin<"));

const errs = acApp.log.split(/\r?\n/).filter((l) => /error|exception/i.test(l) && !/Database offline/.test(l));
check("no server errors", errs.length === 0, errs.slice(0, 3).join(" | "));

hrApp.kill(); acApp.kill();
await adb.end();
// Remove the test backups this run made (only files that were not there before).
for (const f of fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS) : []) if (!before.has(f) && f.startsWith(ADB)) fs.rmSync(path.join(BACKUPS, f));
execSync(`"${bin}/mysql" -uroot ${pwArg} -e "DROP DATABASE IF EXISTS ${ADB}; DROP DATABASE IF EXISTS ${HDB}"`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(0);
