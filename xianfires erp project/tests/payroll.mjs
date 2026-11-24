// E2E: HR approves, Accounting releases the salary. Runs on disposable clones of xianfires_erp and
// djs_hr, with test Accounting on 3010 and test HR on 3012. Real databases are never written.
import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const APP = path.join(ROOT, "xianfires erp project");
const HR = path.join(ROOT, "DJs-Human-Resource-Management-main");
const reqA = createRequire(path.join(APP, "package.json"));
const reqH = createRequire(path.join(HR, "package.json"));
const mysql = reqA("mysql2/promise");
const bcryptjs = reqA("bcryptjs");
const bcryptHr = reqH("bcrypt");
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
const hdb = await mysql.createConnection({ host: "localhost", user: "root", password: env.DB_PASSWORD || "", database: HDB });
for (const [email, role] of [["qa.admin@verify.local", "admin"], ["qa.viewer@verify.local", "viewer"]]) {
  await adb.query("INSERT INTO admin_user (uuid, status, email, password, full_name, role, created_at, updated_at) VALUES (UUID(), 1, ?, ?, 'QA', ?, NOW(), NOW())", [email, await bcryptjs.hash(PASS, 10), role]);
}
await hdb.query("INSERT INTO hr_users (name, email, password, role, createdAt, updatedAt) VALUES ('QA HR', 'qa.hr@verify.local', ?, 'admin', NOW(), NOW())", [await bcryptHr.hash(PASS, 10)]);

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

async function aLogin(email) {
  const r = await fetch(`${A}/admin/user/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email, password: PASS }) });
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
const admin = await aLogin("qa.admin@verify.local");
const viewer = await aLogin("qa.viewer@verify.local");
const post = async (cookie, url, body) => {
  const r = await fetch(A + url, { method: "POST", headers: { cookie, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const [[bank]] = await adb.query("SELECT uuid FROM accounting_account WHERE code = '1010'");
const _n = new Date(); const today = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, "0")}-${String(_n.getDate()).padStart(2, "0")}`;
const entriesFor = async (pid) => (await adb.query(
  "SELECT r.entity_uuid FROM integration_reference r JOIN api_client c ON c.api_client_id = r.api_client_id WHERE c.system_code = 'hr' AND r.external_id = ?", [`HR-PAY-${pid}`]))[0];
const hrRow = async (pid) => (await hdb.query("SELECT status, accountingSyncStatus s, accountingEntryNumber n, paidAt FROM hr_payrolls WHERE id = ?", [pid]))[0][0];

// Pick an approved (Processed) payroll and a Draft one from the cloned HR data.
const [[approved]] = await hdb.query("SELECT id, netSalary, basicSalary + allowances + overtime gross, deductions, cashAdvance FROM hr_payrolls WHERE status = 'Processed' ORDER BY id LIMIT 1");
const [[draft]] = await hdb.query("SELECT id FROM hr_payrolls WHERE status = 'Draft' ORDER BY id LIMIT 1");
check("clone has an approved and a draft payroll", approved && draft, `approved #${approved?.id} draft #${draft?.id}`);

const page = await fetch(`${A}/admin/accounting/payroll`, { headers: { cookie: admin } });
const html = await page.text();
check("Payroll page shows Release salary", page.status === 200 && html.includes(`/api/payroll/${approved.id}/release`) && html.includes("releaseModal"));
const vpage = await (await fetch(`${A}/admin/accounting/payroll`, { headers: { cookie: viewer } })).text();
check("Viewer sees no Release button", !vpage.includes("/release\""));

let r = await post(admin, `/api/payroll/${approved.id}/release`, { cash_account: bank.uuid });
check("missing payment date is refused", r.status === 400 && /date/i.test(r.body?.error?.message), r.body?.error?.message);
r = await post(admin, `/api/payroll/${approved.id}/release`, { payment_date: today });
check("missing cash account is refused", r.status === 400 && /cash or bank/i.test(r.body?.error?.message), r.body?.error?.message);
r = await post(admin, `/api/payroll/${draft.id}/release`, { payment_date: today, cash_account: bank.uuid });
check("draft payroll is refused", r.status === 400 && /not approved/i.test(r.body?.error?.message), r.body?.error?.message);
r = await post(viewer, `/api/payroll/${approved.id}/release`, { payment_date: today, cash_account: bank.uuid });
check("viewer cannot release (403)", r.status === 403, `status=${r.status}`);

r = await post(admin, `/api/payroll/${approved.id}/release`, { payment_date: today, cash_account: bank.uuid, reference: "BDO-TRF-TEST" });
check("release posts and updates HR", r.status === 200 && r.body?.data?.hrUpdated === true, JSON.stringify(r.body));
const entryNo = r.body?.data?.entryNumber;
const refs = await entriesFor(approved.id);
check("one HR-PAY reference", refs.length === 1);
const [lines] = await adb.query(
  "SELECT a.code, l.debit, l.credit FROM accounting_journal_line l JOIN accounting_account a ON a.accounting_account_id = l.account_id JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id WHERE e.uuid = ? ORDER BY l.sort_order",
  [refs[0]?.entity_uuid]);
const dr = lines.reduce((s, l) => s + Number(l.debit), 0), cr = lines.reduce((s, l) => s + Number(l.credit), 0);
const line = (code, side) => Number(lines.find((l) => l.code === code)?.[side] || 0);
check("entry balanced", Math.abs(dr - cr) < 0.005 && dr > 0, `dr=${dr} cr=${cr}`);
check("Dr 6000 = gross", Math.abs(line("6000", "debit") - Number(approved.gross)) < 0.005, `${line("6000", "debit")} vs ${approved.gross}`);
check("Cr 1010 = net pay", Math.abs(line("1010", "credit") - Number(approved.netSalary)) < 0.005, `${line("1010", "credit")} vs ${approved.netSalary}`);
let row = await hrRow(approved.id);
check("HR payroll is Paid, Synced, with the entry number", row.status === "Paid" && row.s === "Synced" && row.n === entryNo, JSON.stringify(row));
const pd = new Date(row.paidAt); check("HR paid date = payment date", `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}-${String(pd.getDate()).padStart(2, "0")}` === today, `${row.paidAt} vs ${today}`);

r = await post(admin, `/api/payroll/${approved.id}/release`, { payment_date: today, cash_account: bank.uuid });
check("second release is refused (already paid)", r.status === 400 && /already paid/i.test(r.body?.error?.message), r.body?.error?.message);

// HR not updated case: put the HR row back to Processed, then "Retry HR update" must not post twice.
await hdb.query("UPDATE hr_payrolls SET status = 'Processed', accountingSyncStatus = NULL, accountingEntryNumber = NULL, paidAt = NULL WHERE id = ?", [approved.id]);
const retryPage = await (await fetch(`${A}/admin/accounting/payroll`, { headers: { cookie: admin } })).text();
check("page offers Retry HR update", retryPage.includes("Retry HR update"));
r = await post(admin, `/api/payroll/${approved.id}/release`, { payment_date: today, cash_account: bank.uuid });
check("retry updates HR without a second entry", r.status === 200 && r.body?.data?.hrUpdated && (await entriesFor(approved.id)).length === 1 && r.body?.data?.entryNumber === entryNo, JSON.stringify(r.body));
row = await hrRow(approved.id);
check("HR row Paid again after retry", row.status === "Paid" && row.n === entryNo, JSON.stringify(row));

// HR screens: Paid cannot be set in HR any more; Processed can.
const hl = await fetch(`${H}/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "qa.hr@verify.local", password: PASS }) });
const hrCookie = (hl.headers.getSetCookie?.() || [hl.headers.get("set-cookie")]).map((c) => String(c).split(";")[0]).join("; ");
check("HR login", hl.status === 302 && hrCookie.includes("sid"), `status=${hl.status}`);
await fetch(`${H}/payroll/${draft.id}/status`, { method: "POST", redirect: "manual", headers: { cookie: hrCookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ status: "Paid" }) });
check("HR cannot mark Paid itself", (await hrRow(draft.id)).status === "Draft", JSON.stringify(await hrRow(draft.id)));
const slip = await (await fetch(`${H}/payroll/${draft.id}`, { headers: { cookie: hrCookie } })).text();
check("HR payslip has no Mark as Paid button", slip.includes("Processed (approved)") && !slip.includes(">Mark as Paid<"));
await fetch(`${H}/payroll/${draft.id}/status`, { method: "POST", redirect: "manual", headers: { cookie: hrCookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ status: "Processed" }) });
check("HR can approve (Processed)", (await hrRow(draft.id)).status === "Processed");
r = await post(admin, `/api/payroll/${draft.id}/release`, { payment_date: today, cash_account: bank.uuid });
check("newly approved payroll can be released", r.status === 200 && r.body?.data?.hrUpdated, JSON.stringify(r.body));
const created = await fetch(`${H}/payroll/create`, { method: "POST", redirect: "manual", headers: { cookie: hrCookie, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ employeeId: "1", periodStart: "2026-12-01", periodEnd: "2026-12-15", basicSalary: "1000", allowances: "0", overtime: "0", status: "Paid" }) });
const [[newRow]] = await hdb.query("SELECT status FROM hr_payrolls WHERE periodStart = '2026-12-01' ORDER BY id DESC LIMIT 1");
check("HR create cannot start as Paid", !newRow || newRow.status !== "Paid", `create=${created.status} row=${JSON.stringify(newRow)}`);

// Audit, ledger, page
const [[audit]] = await adb.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'payroll.release'");
check("audit log has the releases", Number(audit.n) === 2, `n=${audit.n}`);
const [[tb]] = await adb.query("SELECT SUM(debit) d, SUM(credit) c FROM accounting_journal_line");
check("trial balance still balanced", Math.abs(Number(tb.d) - Number(tb.c)) < 0.005, `${tb.d} / ${tb.c}`);
const after = await (await fetch(`${A}/admin/accounting/payroll`, { headers: { cookie: admin } })).text();
check("paid list shows the new entry", after.includes(entryNo));
const errs = (acApp.log + hrApp.log).split(/\r?\n/).filter((l) => /error|exception/i.test(l) && !/accounting-sync/.test(l));
check("no server errors", errs.length === 0, errs.slice(0, 3).join(" | "));

hrApp.kill(); acApp.kill();
await adb.end(); await hdb.end();
execSync(`"${bin}/mysql" -uroot ${pwArg} -e "DROP DATABASE IF EXISTS ${ADB}; DROP DATABASE IF EXISTS ${HDB}"`);
console.log(`${pass} passed, ${fail} failed`);
