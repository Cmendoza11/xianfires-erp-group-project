// npm run migrate: builds the central database for all 5 modules. Safe to run again: every step only
// creates what is missing, and existing Accounting API keys are kept while they still work.
import { spawnSync } from "node:child_process";
import { MODULES, moduleDir, moduleEnv, ensureGeneratedSecrets, updateEnvFile } from "./erp-env.js";

const STEPS = [
  { code: "erp", args: ["migrate.js", "--yes"], label: "Accounting schema, chart of accounts, central database" },
  { code: "hr", args: ["migrate.js"], label: "HR tables (hr_*), departments, admin account" },
  { code: "pos", args: ["migrate.js"], label: "POS & Inventory tables (pos_*), settings, supply items" },
  { code: "scm", args: ["safe-migrate.js"], label: "Procurement tables (scm_*), seed suppliers, HR departments" },
  { code: "crm", args: ["migrate.js"], label: "Customer Logs tables (crm_*)" },
];

ensureGeneratedSecrets();
const byCode = Object.fromEntries(MODULES.map((m) => [m.code, m]));

for (const step of STEPS) {
  const mod = byCode[step.code];
  console.log(`\n=== [${mod.code}] ${mod.name}: ${step.label}`);
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
if (Object.keys(issued).length) {
  updateEnvFile(issued);
  console.log(`Saved ${Object.keys(issued).length} new key(s) to .env: ${Object.keys(issued).join(", ")}`);
} else {
  console.log("Existing keys in .env are still valid.");
}

console.log("\nDone. Start everything with: npm run dev");
