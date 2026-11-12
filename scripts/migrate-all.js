// npm run migrate: builds the five DJ's ERP databases (one per module). Safe to run again: every step only
// creates what is missing, and existing Accounting API keys are kept while they still work.
// DB_SUFFIX=_demo (or the older DB_NAME=xianfires_erp_demo) builds the "_demo" set instead.
import { spawnSync } from "node:child_process";
import { MODULES, moduleDir, moduleEnv, dbNameOf, dbSuffix, keyVarFor, ensureGeneratedSecrets, updateEnvFile } from "./erp-env.js";
import { splitDatabases } from "./split-databases.js";

const STEPS = [
  { code: "erp", args: ["migrate.js", "--yes"], label: "Accounting: chart of accounts, ledger, API" },
  { code: "hr", args: ["migrate.js"], label: "HR: employees, departments, payroll, admin account" },
  { code: "pos", args: ["migrate.js"], label: "POS & Inventory: products, stock, settings, supply items" },
  { code: "scm", args: ["safe-migrate.js"], label: "Procurement: suppliers, requests, orders" },
  { code: "crm", args: ["migrate.js"], label: "Customer Logs: customers, logs, loyalty" },
];

ensureGeneratedSecrets();
const byCode = Object.fromEntries(MODULES.map((m) => [m.code, m]));
const suffix = dbSuffix();

console.log("DJ's ERP databases:");
for (const mod of MODULES) console.log(`  ${mod.name.padEnd(16)} ${dbNameOf(mod)}`);

// Older installs kept every module inside the Accounting database: move those tables out first.
console.log("\n=== Each module gets its own database");
const moved = await splitDatabases({ log: console.log }).catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
if (!moved.length) console.log("  nothing to move");

for (const step of STEPS) {
  const mod = byCode[step.code];
  console.log(`\n=== [${mod.code}] ${step.label} (database ${dbNameOf(mod)})`);
  const result = spawnSync(process.execPath, step.args, { cwd: moduleDir(mod), env: moduleEnv(mod), stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n[${mod.code}] migration failed (exit ${result.status}). Fix the error above and run \`npm run migrate\` again.`);
    process.exit(1);
  }
}

// Issue (or keep) one Accounting API key per module. The script prints JSON only; keys never reach the console.
console.log("\n=== [erp] Accounting API keys for POS, HR and Procurement");
const erp = byCode.erp;
const keys = spawnSync(process.execPath, ["integration-keys.js", "--json"], {
  cwd: moduleDir(erp),
  env: moduleEnv(erp),
  stdio: ["inherit", "pipe", "inherit"],
  encoding: "utf8",
});
if (keys.status !== 0) {
  console.error("[erp] could not issue API keys.");
  process.exit(1);
}
const issued = JSON.parse(keys.stdout.trim() || "{}");
// Each database set keeps its own keys (ERP_API_KEY_POS_DEMO for "_demo"), so switching sets needs no re-migrate.
const named = Object.fromEntries(Object.entries(issued).map(([name, value]) => [keyVarFor(name, suffix), value]));
if (Object.keys(named).length) {
  updateEnvFile(named);
  console.log(`Saved ${Object.keys(named).length} new key(s) to .env: ${Object.keys(named).join(", ")}`);
} else {
  console.log("Existing keys in .env are still valid.");
}

console.log(`\nDone. Start everything with: ${suffix ? `$env:DB_SUFFIX="${suffix}"; ` : ""}npm run dev`);
