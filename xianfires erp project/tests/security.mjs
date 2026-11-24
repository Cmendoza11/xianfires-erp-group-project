// Security end-to-end test on the disposable xianfires_erp_verify DB.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
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
const PORT = 3011;
const BASE = `http://localhost:${PORT}`;
const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN = { email: "qa.admin@verify.local", pass: `Qa-Admin-${rnd()}9!` };
const VIEWER = { email: "qa.viewer@verify.local", pass: `Qa-View-${rnd()}9!` };
const ACCT = { email: "qa.acct@verify.local", pass: `Qa-Acct-${rnd()}9!` };

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + String(extra).slice(0, 220) : ""}`); };

const db = await mysql.createConnection({ host: "localhost", user: "root", password: env.DB_PASSWORD || "", database: DB });
for (const [u, role] of [[ADMIN, "admin"], [VIEWER, "viewer"], [ACCT, "accountant"]]) {
  await db.query("DELETE FROM admin_user WHERE email = ?", [u.email]);
  await db.query("INSERT INTO admin_user (uuid, status, email, password, full_name, role, created_at, updated_at) VALUES (UUID(), 1, ?, ?, 'QA Tester', ?, NOW(), NOW())", [u.email, await bcrypt.hash(u.pass, 10), role]);
}
await db.query("DELETE FROM setting WHERE name LIKE 'security%'");

const app = spawn(process.execPath, ["index.js"], { cwd: APP, env: { ...process.env, ...env, DB_NAME: DB, PORT: String(PORT), DB_HOST: "localhost", DB_USER: "root" } });
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 40; i++) { try { await fetch(BASE + "/admin/login"); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }

function client() {
  let cookie = "";
  return async function call(method, url, body, { raw = false, headers = {} } = {}) {
    const res = await fetch(BASE + url, {
      method, redirect: "manual",
      headers: { cookie, ...(body !== undefined ? { "content-type": "application/json", accept: "application/json" } : {}), ...headers },
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    if (raw) return res;
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json, headers: res.headers, setCookie: set };
  };
}
const login = async (c, u) => c("POST", "/admin/user/login", { email: u.email, password: u.pass });
const acct = async (code) => (await db.query("SELECT uuid FROM accounting_account WHERE code = ?", [code]))[0][0].uuid;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // ---------------- login lockout (3 attempts, 1 minute)
  const anon = client();
  let r = await anon("POST", "/admin/user/login", { email: ACCT.email, password: "wrong-1" });
  check("lockout: 1st wrong -> 401, 2 left", r.status === 401 && r.json?.error?.attemptsLeft === 2, r.json?.error?.message);
  r = await anon("POST", "/admin/user/login", { email: ACCT.email, password: "wrong-2" });
  check("lockout: 2nd wrong -> 401, 1 left", r.status === 401 && r.json?.error?.attemptsLeft === 1, r.json?.error?.message);
  r = await anon("POST", "/admin/user/login", { email: ACCT.email, password: "wrong-3" });
  check("lockout: 3rd wrong -> 429 locked ~60s", r.status === 429 && r.json?.error?.retryAfter >= 55 && r.headers.get("retry-after"), r.json?.error?.message);
  r = await anon("POST", "/admin/user/login", { email: ACCT.email, password: ACCT.pass });
  check("lockout: even the right password is refused while locked", r.status === 429, r.json?.error?.message);
  const lockedAt = Date.now();

  // ---------------- admin session and security headers
  const admin = client();
  r = await login(admin, ADMIN);
  check("admin login", r.status === 200);
  r = await admin("GET", "/admin");
  check("security headers", r.headers.get("x-content-type-options") === "nosniff" && r.headers.get("x-frame-options") === "SAMEORIGIN" && !r.headers.get("x-powered-by"));
  check("session cookie has idle expiry + HttpOnly", /Expires=/i.test(r.setCookie || "") && /HttpOnly/i.test(r.setCookie || ""), r.setCookie);

  // ---------------- settings (admin changes the lockout rules)
  r = await admin("POST", "/api/settings", { securityLoginMaxAttempts: "11" });
  check("settings: attempts 11 -> 400", r.status === 400, r.json?.error?.message);
  r = await admin("POST", "/api/settings", { securitySessionMinutes: "2" });
  check("settings: session 2 min -> 400", r.status === 400);
  r = await admin("POST", "/api/settings", { securityLoginMaxAttempts: "3", securityLockoutMinutes: "1", securitySessionMinutes: "30" });
  check("settings: save security values", r.status === 200);
  r = await admin("GET", "/admin/setting/accounting");
  check("settings page shows Security section", r.status === 200 && r.text.includes("Failed logins before lock"));

  // ---------------- strong password + formats
  r = await admin("POST", "/api/users", { full_name: "Weak Pass", email: "weak@verify.local", role: "viewer", password: "password" });
  check("password: weak -> 400 listing rules", r.status === 400 && /uppercase|number|symbol/i.test(r.json?.error?.message), r.json?.error?.message);
  r = await admin("POST", "/api/users", { full_name: "No Space", email: "space@verify.local", role: "viewer", password: "Abc 123!x" });
  check("password: with space -> 400", r.status === 400);
  r = await admin("POST", "/api/users", { full_name: "Juan Dela Cruz", email: "juan@verify.local", role: "viewer", password: "juan@Pass1" });
  check("password: containing email name -> 400", r.status === 400, r.json?.error?.message);
  r = await admin("POST", "/api/users", { full_name: "R2D2 <b>", email: "x@verify.local", role: "viewer", password: "Strong#Pass9" });
  check("format: name with digits/< > -> 400", r.status === 400, r.json?.error?.message);
  r = await admin("POST", "/api/users", { full_name: "Bad Email", email: "bad@email", role: "viewer", password: "Strong#Pass9" });
  check("format: invalid email -> 400", r.status === 400);
  r = await admin("POST", "/api/users", { full_name: "Maria Santos", email: "maria.qa@verify.local", role: "accountant", password: "Strong#Pass9" });
  check("password: strong -> user created", r.status === 200, r.json?.error?.message);
  const maria = r.json?.data;
  r = await admin("POST", "/api/contacts", { type: "customer", name: "Test Customer", tin: "12-34", phone: "" });
  check("format: bad TIN -> 400", r.status === 400, r.json?.error?.message);
  r = await admin("POST", "/api/contacts", { type: "customer", name: "Test Customer", phone: "call me" });
  check("format: bad phone -> 400", r.status === 400);
  r = await admin("POST", "/api/contacts", { type: "customer", name: "<script>alert(1)</script>" });
  check("format: script in name -> 400", r.status === 400);
  r = await admin("POST", "/api/accounting/accounts", { code: "ABC", name: "Test", type: "expense" });
  check("format: account code letters -> 400", r.status === 400, r.json?.error?.message);

  // ---------------- soft delete + recycle bin
  r = await admin("POST", "/api/contacts", { type: "customer", name: "Soft Delete Customer", tin: "123-456-789-000", phone: "0917 123 4567", email: "soft@verify.local" });
  check("contact: create valid", r.status === 200, r.json?.error?.message);
  const contactUuid = r.json?.data?.uuid;
  r = await admin("DELETE", `/api/contacts/${contactUuid}`);
  check("contact: delete -> soft", r.status === 200);
  const [[c1]] = await db.query("SELECT deleted_at FROM contact WHERE uuid = ?", [contactUuid]);
  check("contact: row kept with deleted_at", c1 && c1.deleted_at !== null);
  r = await admin("GET", "/admin/sales/customers");
  check("contact: hidden from list", !r.text.includes("Soft Delete Customer"));
  r = await admin("GET", "/admin/recycle-bin");
  check("recycle bin lists it", r.status === 200 && r.text.includes("Soft Delete Customer"));
  r = await admin("POST", `/api/recycle-bin/contact/${contactUuid}/restore`, {});
  check("recycle bin: restore contact", r.status === 200);
  r = await admin("GET", "/admin/sales/customers");
  check("contact: back in list", r.text.includes("Soft Delete Customer"));

  r = await admin("POST", "/api/accounting/accounts", { code: "6990", name: "Test Soft Account", type: "expense" });
  const acctUuid = r.json?.data?.uuid;
  check("account: create", r.status === 200 && acctUuid, r.json?.error?.message);
  r = await admin("DELETE", `/api/accounting/accounts/${acctUuid}`);
  check("account: soft delete", r.status === 200);
  r = await admin("POST", "/api/accounting/accounts", { code: "6990", name: "Again", type: "expense" });
  check("account: same code -> points to Recycle Bin", r.status === 400 && /Recycle Bin/.test(r.json?.error?.message), r.json?.error?.message);
  r = await admin("POST", `/api/recycle-bin/account/${acctUuid}/restore`, {});
  check("account: restore", r.status === 200);

  r = await admin("DELETE", `/api/users/${maria.uuid}`);
  check("user: soft delete", r.status === 200);
  const mariaClient = client();
  r = await mariaClient("POST", "/admin/user/login", { email: "maria.qa@verify.local", password: "Strong#Pass9" });
  check("user: deleted user cannot log in", r.status === 401);
  r = await admin("POST", `/api/recycle-bin/user/${maria.uuid}/restore`, {});
  check("user: restore", r.status === 200);
  r = await mariaClient("POST", "/admin/user/login", { email: "maria.qa@verify.local", password: "Strong#Pass9" });
  check("user: restored user can log in", r.status === 200);
  const [[me]] = await db.query("SELECT uuid FROM admin_user WHERE email = ?", [ADMIN.email]);
  r = await admin("DELETE", `/api/users/${me.uuid}`);
  check("user: cannot delete yourself", r.status === 400, r.json?.error?.message);

  // ---------------- fixed asset edit/delete/restore keeps the ledger balanced
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  r = await admin("POST", "/api/fixed-assets", { name: "QA Oven", acquisition_date: today, cost: "15000", salvage_value: "0", useful_life_months: "12", paid_from: await acct("1000") });
  const ovenUuid = r.json?.data?.uuid;
  check("asset: create with purchase", r.status === 200);
  r = await admin("PATCH", `/api/fixed-assets/${ovenUuid}`, { name: "QA Oven (Kitchen)" });
  check("asset: edit name", r.status === 200);
  r = await admin("PATCH", `/api/fixed-assets/${ovenUuid}`, { cost: "99999" });
  check("asset: cost locked after posting -> 400", r.status === 400, r.json?.error?.message);
  r = await admin("DELETE", `/api/fixed-assets/${ovenUuid}`);
  check("asset: delete reverses purchase", r.status === 200);
  r = await admin("POST", `/api/recycle-bin/asset/${ovenUuid}/restore`, {});
  check("asset: restore re-posts purchase", r.status === 200, r.json?.error?.message);
  const [[tb]] = await db.query("SELECT SUM(debit) d, SUM(credit) c FROM accounting_journal_line");
  check("ledger balanced after delete/restore", Number(tb.d).toFixed(2) === Number(tb.c).toFixed(2), `${tb.d} / ${tb.c}`);
  const [[fa]] = await db.query("SELECT COALESCE(SUM(l.debit - l.credit),0) n FROM accounting_journal_line l JOIN accounting_account a ON a.accounting_account_id = l.account_id JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id WHERE a.code = '1500' AND e.description LIKE '%QA Oven%'");
  check("equipment 1500 shows the oven once (15000)", Number(fa.n) === 15000, fa.n);

  // ---------------- journal entries are reversal-only
  r = await admin("POST", "/api/accounting/journal-entries", { entry_date: today, description: "QA manual", lines: [{ account: await acct("6600"), debit: "10" }, { account: await acct("1000"), credit: "10" }] });
  const jeUuid = r.json?.data?.uuid;
  r = await admin("DELETE", `/api/accounting/journal-entries/${jeUuid}`);
  check("journal: delete refused (reverse instead)", r.status === 400 && /never deleted/.test(r.json?.error?.message), r.json?.error?.message);

  // ---------------- uploads
  r = await admin("POST", "/api/expense-vouchers", { voucher_date: today, payee: "QA Hardware", amount: "250", expense_account: await acct("6600"), payment_account: await acct("1000"), description: "Bolts" });
  const v = r.json?.data;
  check("voucher: create", r.status === 200);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
  const up = (name, buf) => admin("POST", `/api/expense-vouchers/${v.uuid}/receipt`, { receipt_name: name, receipt_data: buf.toString("base64") });
  r = await up("shell.php", Buffer.from("<?php system($_GET['c']); ?>"));
  check("upload: shell.php -> 400", r.status === 400, r.json?.error?.message);
  r = await up("shell.php.jpg", png);
  check("upload: shell.php.jpg (double ext) -> 400", r.status === 400, r.json?.error?.message);
  r = await up("shell.phtml", png);
  check("upload: .phtml -> 400", r.status === 400);
  r = await up("fake.jpg", Buffer.from("<?php echo shell_exec($_GET['cmd']); ?>"));
  check("upload: PHP renamed .jpg (bad magic bytes) -> 400", r.status === 400, r.json?.error?.message);
  r = await up("polyglot.png", Buffer.concat([png, Buffer.from("<?php system($_GET['c']); ?>")]));
  check("upload: real PNG with PHP inside -> 400", r.status === 400, r.json?.error?.message);
  r = await up("receipt.svg", Buffer.from("<svg onload=alert(1)>"));
  check("upload: svg -> 400", r.status === 400);
  r = await up("big.png", Buffer.concat([png, Buffer.alloc(2.1 * 1024 * 1024)]));
  check("upload: over 2 MB -> 400/413", r.status === 400 || r.status === 413, r.json?.error?.message);
  r = await up("receipt.png", png);
  check("upload: real PNG -> 200", r.status === 200, r.json?.error?.message);
  const [[stored]] = await db.query("SELECT receipt_file, receipt_mime FROM expense_voucher WHERE uuid = ?", [v.uuid]);
  check("upload: stored with random name outside public/", /^[0-9a-f-]{36}\.png$/.test(stored.receipt_file) && fs.existsSync(path.join(APP, "storage", "receipts", stored.receipt_file)) && !fs.existsSync(path.join(APP, "public", stored.receipt_file)));
  const file = await admin("GET", `/admin/purchases/expense-vouchers/receipt/${v.uuid}`, undefined, { raw: true });
  check("upload: served as image/png + nosniff + sandbox", file.status === 200 && file.headers.get("content-type").startsWith("image/png") && file.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(file.headers.get("content-security-policy") || ""));
  r = await anon("GET", `/storage/receipts/${stored.receipt_file}`);
  check("upload: not reachable by direct URL", r.status === 404 || r.status === 302);
  const anonFile = await anon("GET", `/admin/purchases/expense-vouchers/receipt/${v.uuid}`, undefined, { raw: true });
  check("upload: logged-out user cannot open it", anonFile.status === 302);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  r = await up("invoice.pdf", pdf);
  check("upload: real PDF -> 200 (replaces image)", r.status === 200);
  check("upload: old file removed", !fs.existsSync(path.join(APP, "storage", "receipts", stored.receipt_file)));
  const [audit] = await db.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'voucher.receipt_rejected'");
  check("upload: rejected attempts are in the audit log", audit[0].n >= 6, audit[0].n);
  r = await admin("POST", "/api/expense-vouchers", { voucher_date: today, payee: "Shell", amount: "1", expense_account: await acct("6600"), payment_account: await acct("1000"), description: "x", receipt_name: "a.php.png", receipt_data: png.toString("base64") });
  check("upload: bad file in new voucher stops the whole voucher", r.status === 400);

  // ---------------- roles
  const viewer = client();
  await login(viewer, VIEWER);
  r = await viewer("POST", "/api/expense-vouchers", { voucher_date: today, payee: "x", amount: "1", expense_account: await acct("6600"), payment_account: await acct("1000"), description: "x" });
  check("roles: viewer cannot post a voucher (403)", r.status === 403);
  r = await viewer("GET", "/admin/recycle-bin");
  check("roles: viewer cannot open Recycle Bin (403)", r.status === 403);
  r = await viewer("GET", "/admin/purchases/expense-vouchers");
  check("roles: viewer can read vouchers, no New button", r.status === 200 && !r.text.includes('data-modal-target="#voucherModal"'));
  const accountant = client();
  await login(accountant, { email: "maria.qa@verify.local", pass: "Strong#Pass9" });
  r = await accountant("DELETE", `/api/users/${me.uuid}`);
  check("roles: accountant cannot delete users (403)", r.status === 403);
  r = await accountant("POST", "/api/settings", { securityLoginMaxAttempts: "10" });
  check("roles: accountant cannot change security settings (403)", r.status === 403);

  // ---------------- pages render
  for (const [url, needle] of [["/admin/accounting/accounts", "data-modal"], ["/admin/sales/customers", "data-modal"], ["/admin/users", "Delete"], ["/admin/accounting/fixed-assets", "assetModal"], ["/admin/purchases/expense-vouchers", "voucherModal"], [v.viewUrl, "receiptModal"], ["/admin/account/password", "data-password-policy"]]) {
    r = await admin("GET", url);
    check(`page ${url}`, r.status === 200 && r.text.includes(needle), r.status);
  }
  r = await anon("GET", "/admin/login?expired=1");
  check("login page shows session-expired notice", r.text.includes("session expired"));

  // ---------------- API rate limit
  let limited = null;
  for (let i = 0; i < 320; i++) {
    const x = await admin("POST", "/api/budgets", { month: "bad" });
    if (x.status === 429) { limited = i + 1; break; }
  }
  check("rate limit: /api blocks after 300 requests/min", limited !== null && limited <= 301, limited);

  // ---------------- lockout expires after 1 minute
  const wait = 61_000 - (Date.now() - lockedAt);
  if (wait > 0) { console.log(`... waiting ${Math.ceil(wait / 1000)}s for the lockout to end`); await sleep(wait); }
  r = await anon("POST", "/admin/user/login", { email: ACCT.email, password: ACCT.pass });
  check("lockout: after 1 minute the right password works", r.status === 200, r.json?.error?.message);
} catch (e) {
  fail++;
  console.log("ERROR", e);
} finally {
  app.kill();
  await db.end();
  const errors = log.split("\n").filter((l) => /❌|Error/.test(l));
  if (errors.length) console.log("--- app errors ---\n" + errors.slice(0, 15).join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
