// End-to-end test of expense vouchers, fixed assets and budgets on the disposable xianfires_erp_verify DB.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2]; // repo root
const APP = path.join(ROOT, "xianfires erp project");
const req = createRequire(path.join(APP, "package.json"));
const mysql = req("mysql2/promise");
const bcrypt = req("bcryptjs");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const DB = "xianfires_erp_verify";
const PORT = 3010;
const BASE = `http://localhost:${PORT}`;
const EMAIL = "qa.tester@verify.local";
const PASS = "Verify-" + Math.random().toString(36).slice(2, 10);

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); };

const db = await mysql.createConnection({ host: "localhost", user: "root", password: env.DB_PASSWORD || "", database: DB });
await db.query("DELETE FROM admin_user WHERE email = ?", [EMAIL]);
await db.query("INSERT INTO admin_user (uuid, status, email, password, full_name, role, created_at, updated_at) VALUES (UUID(), 1, ?, ?, 'QA Tester', 'admin', NOW(), NOW())", [EMAIL, await bcrypt.hash(PASS, 10)]);
const acct = async (code) => (await db.query("SELECT uuid, accounting_account_id id FROM accounting_account WHERE code = ?", [code]))[0][0];

const app = spawn(process.execPath, ["index.js"], { cwd: APP, env: { ...process.env, ...env, DB_NAME: DB, PORT: String(PORT), DB_HOST: "localhost", DB_USER: "root" } });
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 40; i++) { try { await fetch(BASE + "/admin/login"); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }

let cookie = "";
async function call(method, url, body) {
  const res = await fetch(BASE + url, {
    method, redirect: "manual",
    headers: { cookie, ...(body ? { "content-type": "application/json", accept: "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

try {
  let r = await call("POST", "/admin/user/login", { email: EMAIL, password: PASS });
  check("login", r.status === 200, String(r.status));

  for (const [url, needle] of [
    ["/admin/purchases/expense-vouchers", "New expense voucher"],
    ["/admin/accounting/fixed-assets", "Asset register"],
    ["/admin/accounting/reports/budget-vs-actual", "Budget vs Actual"],
    ["/admin/accounting/journal-entries", "Journal"],
    ["/admin/audit-log", "Expense vouchers"]
  ]) {
    r = await call("GET", url);
    check(`GET ${url}`, r.status === 200 && r.text.includes(needle), String(r.status));
  }
  r = await call("GET", "/admin");
  check("menu has the 3 new links", ["Expense Vouchers", "Fixed Assets", "Budget vs Actual"].every((t) => r.text.includes(t)));

  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const cash = await acct("1000"), supplies = await acct("6600"), sales = await acct("4000"), util = await acct("6200");

  // --- Expense voucher
  r = await call("POST", "/api/expense-vouchers", { voucher_date: today, payee: "", amount: "100", expense_account: supplies.uuid, payment_account: cash.uuid, description: "x" });
  check("voucher: payee required -> 400", r.status === 400, r.json?.error?.message);
  r = await call("POST", "/api/expense-vouchers", { voucher_date: today, payee: "Market", amount: "100", expense_account: cash.uuid, payment_account: cash.uuid, description: "x" });
  check("voucher: non-expense account -> 400", r.status === 400, r.json?.error?.message);
  r = await call("POST", "/api/expense-vouchers", { voucher_date: today, payee: "Calapan Public Market", amount: "1250.50", expense_account: supplies.uuid, payment_account: cash.uuid, description: "Kitchen supplies" });
  check("voucher: create", r.status === 200 && r.json?.data?.number?.startsWith("EV-"), JSON.stringify(r.json?.data ?? r.json));
  const v = r.json?.data;
  const [[ve]] = await db.query("SELECT v.status, e.entry_type, e.reference, (SELECT SUM(debit) FROM accounting_journal_line WHERE journal_entry_id=e.accounting_journal_entry_id) d, (SELECT SUM(credit) FROM accounting_journal_line WHERE journal_entry_id=e.accounting_journal_entry_id) c, e.uuid euuid FROM expense_voucher v JOIN accounting_journal_entry e ON e.accounting_journal_entry_id=v.journal_entry_id WHERE v.uuid=?", [v.uuid]);
  check("voucher: entry Dr=Cr=1250.50, type voucher, ref EV-", ve.entry_type === "voucher" && Number(ve.d) === 1250.5 && Number(ve.c) === 1250.5 && ve.reference === v.number);
  r = await call("GET", v.viewUrl);
  check("voucher: view page", r.status === 200 && r.text.includes("EXPENSE VOUCHER") && r.text.includes("Calapan Public Market"));
  r = await call("GET", `/admin/accounting/journal-entries/view/${ve.euuid}`);
  check("journal view links back to voucher", r.status === 200 && r.text.includes(v.number), "");
  r = await call("DELETE", `/api/accounting/journal-entries/${ve.euuid}`);
  check("journal: cannot delete voucher entry", r.status === 400, r.json?.error?.message);
  r = await call("POST", `/api/expense-vouchers/${v.uuid}/void`, { reason: "" });
  check("void: reason required -> 400", r.status === 400);
  r = await call("POST", `/api/expense-vouchers/${v.uuid}/void`, { reason: "Wrong amount" });
  check("void: ok", r.status === 200, JSON.stringify(r.json));
  r = await call("POST", `/api/expense-vouchers/${v.uuid}/void`, { reason: "again" });
  check("void: twice -> 400", r.status === 400);
  r = await call("GET", "/admin/purchases/expense-vouchers");
  check("voucher grid shows Void", r.text.includes("badge-danger"));

  // --- Fixed assets
  r = await call("POST", "/api/fixed-assets", { name: "Bad", acquisition_date: today, cost: "1000", salvage_value: "1000", useful_life_months: "12" });
  check("asset: salvage >= cost -> 400", r.status === 400);
  r = await call("POST", "/api/fixed-assets", { name: "Commercial refrigerator", acquisition_date: today, cost: "60000", salvage_value: "6000", useful_life_months: "60", paid_from: cash.uuid });
  check("asset: create with purchase entry", r.status === 200 && r.json?.data?.posted === true, JSON.stringify(r.json));
  r = await call("POST", "/api/fixed-assets", { name: "Old stove", acquisition_date: "2026-01-15", cost: "12000", salvage_value: "0", useful_life_months: "3" });
  check("asset: create already in books", r.status === 200 && r.json?.data?.posted === false);
  r = await call("POST", "/api/fixed-assets/depreciation", { month: "2099-01" });
  check("depreciation: future month -> 400", r.status === 400);
  const runs = [];
  for (const m of ["2026-01", "2026-02", "2026-03", "2026-04"]) {
    r = await call("POST", "/api/fixed-assets/depreciation", { month: m });
    runs.push([m, r.status, r.json?.data?.total ?? r.json?.error?.message]);
  }
  // Old stove: 12000 / 3 months = 4000 x3, then nothing left in month 4 -> 400.
  check("depreciation: stove 4000 x3 then fully depreciated", runs[0][2] === 4000 && runs[1][2] === 4000 && runs[2][2] === 4000 && runs[3][1] === 400, JSON.stringify(runs));
  r = await call("POST", "/api/fixed-assets/depreciation", { month });
  check("depreciation: this month = 900 (54000/60)", r.status === 200 && r.json?.data?.total === 900, JSON.stringify(r.json));
  r = await call("POST", "/api/fixed-assets/depreciation", { month });
  check("depreciation: same month twice -> 400", r.status === 400, r.json?.error?.message);
  r = await call("POST", "/api/fixed-assets/depreciation/undo", {});
  check("depreciation: undo latest", r.status === 200, JSON.stringify(r.json));
  r = await call("POST", "/api/fixed-assets/depreciation", { month });
  check("depreciation: rerun after undo", r.status === 200 && r.json?.data?.total === 900);
  r = await call("GET", "/admin/accounting/fixed-assets");
  check("asset page shows book values", r.status === 200 && r.text.includes("Commercial refrigerator") && r.text.includes("Fully depreciated"));

  // --- Budget
  r = await call("POST", "/api/budgets", { month, [`budget_${sales.uuid}`]: "50000", [`budget_${util.uuid}`]: "3000", [`budget_${supplies.uuid}`]: "500" });
  check("budget: save", r.status === 200 && r.json?.data?.saved === 3, JSON.stringify(r.json));
  r = await call("POST", "/api/budgets", { month, [`budget_${util.uuid}`]: "-5" });
  check("budget: negative -> 400", r.status === 400);
  r = await call("POST", "/api/budgets", { month: "2026-12", copy_from: "2026-10" });
  check("budget: copy from empty month -> 400", r.status === 400);
  r = await call("POST", "/api/budgets", { month: "2026-12", copy_from: month });
  check("budget: copy to next month", r.status === 200 && r.json?.data?.saved === 3);
  r = await call("GET", `/admin/accounting/reports/budget-vs-actual?month=${month}`);
  check("budget report renders with statuses", r.status === 200 && r.text.includes("50000.00") && (r.text.includes("Below target") || r.text.includes("Above target")), "");
  r = await call("GET", `/admin/accounting/reports/budget-vs-actual?month=bogus`);
  check("budget report: bad month falls back", r.status === 200);

  // --- Ledger stays balanced, audit written
  const [[tb]] = await db.query("SELECT SUM(debit) d, SUM(credit) c FROM accounting_journal_line");
  check("trial balance balanced", Number(tb.d).toFixed(2) === Number(tb.c).toFixed(2), `${tb.d} / ${tb.c}`);
  const [audit] = await db.query("SELECT action, COUNT(*) n FROM audit_log WHERE action LIKE 'voucher.%' OR action LIKE 'asset.%' OR action LIKE 'budget.%' GROUP BY action");
  check("audit actions recorded", audit.length >= 6, JSON.stringify(audit));
  r = await call("GET", "/admin/accounting/reports/trial-balance");
  check("trial balance page", r.status === 200);
} catch (e) {
  fail++;
  console.log("ERROR", e);
} finally {
  app.kill();
  await db.query("DELETE FROM admin_user WHERE email = ?", [EMAIL]);
  await db.end();
  if (/Error|error/.test(log)) console.log("--- app log ---\n" + log.split("\n").filter((l) => /rror/.test(l)).slice(0, 15).join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
