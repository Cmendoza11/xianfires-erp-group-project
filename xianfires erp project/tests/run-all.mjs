// npm test (in "xianfires erp project"): runs every Accounting end-to-end test on DISPOSABLE copies of the
// databases (xianfires_erp_verify, djs_hr_verify). The real books are never written.
//
// Needs: Laragon MySQL running on this laptop, the group repo root .env (DB_PASSWORD for root), and the free
// ports 3010-3012. Each suite starts its own copy of Accounting (and HR where needed) and stops it at the end.
//
//   crawl         opens every admin page as an admin; no errors, no "undefined"
//   features      expense vouchers, fixed assets and depreciation, budget vs actual
//   security      login lockout, passwords, rate limits, roles, uploads, soft delete, recycle bin
//   reliability   sessions survive a restart, database-offline page, health check
//   payroll       HR approves, Accounting releases the salary, HR shows Paid (with a test HR)
//   enhancements  backup/restore, export buttons, payroll summary and payslip, sidebar
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const only = process.argv.slice(2);
const SUITES = ["crawl", "features", "security", "reliability", "payroll", "enhancements"]
  .filter((s) => !only.length || only.includes(s));

const env = Object.fromEntries(fs.readFileSync(path.join(repoRoot, ".env"), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const mysqlBin = fs.existsSync("C:/laragon/bin/mysql")
  ? fs.readdirSync("C:/laragon/bin/mysql").map((d) => `C:/laragon/bin/mysql/${d}/bin/mysql`)[0]
  : "mysql";
const dropClones = () => {
  try {
    execSync(`"${mysqlBin}" -uroot ${env.DB_PASSWORD ? `-p${env.DB_PASSWORD}` : ""} -e "DROP DATABASE IF EXISTS xianfires_erp_verify; DROP DATABASE IF EXISTS djs_hr_verify"`, { stdio: "ignore" });
  } catch { /* nothing to drop */ }
};

const results = [];
for (const suite of SUITES) {
  console.log(`\n=== ${suite}`);
  const started = Date.now();
  const out = await new Promise((resolve) => {
    let text = "";
    const child = spawn(process.execPath, [path.join(here, `${suite}.mjs`), repoRoot], { cwd: repoRoot });
    child.stdout.on("data", (d) => { text += d; process.stdout.write(String(d).split(/\r?\n/).filter((l) => /^(FAIL|login|pages|no page|server log|\d+ passed)/.test(l)).map((l) => `  ${l}\n`).join("")); });
    child.stderr.on("data", (d) => { text += d; });
    child.on("close", (code) => resolve({ text, code }));
  });
  const m = out.text.match(/(\d+) passed, (\d+) failed/);
  const crawlOk = suite === "crawl" && /no page problems/.test(out.text) && /server log issues: none/.test(out.text);
  const passed = m ? Number(m[1]) : crawlOk ? Number(out.text.match(/pages (\d+)/)?.[1] || 1) : 0;
  const failed = m ? Number(m[2]) : crawlOk ? 0 : 1;
  results.push({ suite, passed, failed, seconds: Math.round((Date.now() - started) / 1000) });
}
dropClones();

console.log("\n=== Summary");
for (const r of results) console.log(`  ${r.failed ? "FAIL" : "PASS"}  ${r.suite.padEnd(13)} ${String(r.passed).padStart(4)} passed, ${r.failed} failed  (${r.seconds}s)`);
const failedSuites = results.filter((r) => r.failed).length;
console.log(failedSuites ? `\n${failedSuites} suite(s) failed.` : "\nAll suites passed.");
process.exit(failedSuites ? 1 : 0);
