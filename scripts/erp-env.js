// Shared settings for the root ERP scripts: where each module lives, its port, and the root .env.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_FILE = path.join(ROOT, ".env");
export const ENV_EXAMPLE = path.join(ROOT, ".env.example");

// Order matters: Accounting runs its migration first because it creates the central database.
export const MODULES = [
  { code: "erp", name: "Accounting", dir: "xianfires erp project", port: 3000, color: 36 },
  { code: "hr", name: "HR", dir: "DJs-Human-Resource-Management-main", port: 3002, color: 35 },
  { code: "pos", name: "POS & Inventory", dir: "PointOfSales-main/PointOfSales-main", port: 3001, color: 33 },
  { code: "scm", name: "Procurement", dir: "eventdriven_selda-main/eventdriven_selda-main", port: 3003, color: 32 },
  { code: "crm", name: "Customers", dir: "Dj-s-Customer-Logs-main/Dj-s-Customer-Logs-main", port: 3004, color: 34 },
];

export const moduleDir = (mod) => path.join(ROOT, mod.dir);

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export function readEnvFile() {
  return fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, "utf8")) : {};
}

// Creates .env from .env.example on first run; keeps comments and order on later updates.
export function updateEnvFile(updates) {
  if (!fs.existsSync(ENV_FILE)) fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
  const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  const pending = { ...updates };
  const next = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && match[1] in pending) {
      const value = pending[match[1]];
      delete pending[match[1]];
      return `${match[1]}=${value}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(pending)) next.push(`${key}=${value}`);
  fs.writeFileSync(ENV_FILE, next.join("\n").replace(/\n*$/, "\n"));
}

// Fills in generated secrets so a fresh clone works after one `npm run migrate`.
export function ensureGeneratedSecrets() {
  const current = readEnvFile();
  const updates = {};
  if (!current.ERP_INTERNAL_KEY) updates.ERP_INTERNAL_KEY = crypto.randomBytes(24).toString("base64url");
  if (!current.SESSION_SECRET) updates.SESSION_SECRET = crypto.randomBytes(32).toString("base64url");
  if (Object.keys(updates).length || !fs.existsSync(ENV_FILE)) updateEnvFile(updates);
}

// Every module has its OWN database; modules reach each other's data only through their APIs.
export const DEFAULT_DB = {
  erp: "xianfires_erp",
  hr: "djs_hr",
  pos: "djs_pos",
  scm: "djs_procurement",
  crm: "djs_customer_logs",
};
const LEGACY_PREFIX = "xianfires_erp";

// DB_SUFFIX picks another set of the five databases (e.g. "_demo" -> xianfires_erp_demo, djs_hr_demo, ...).
// The older one-database instructions set DB_NAME=xianfires_erp_demo in the shell; that still picks "_demo".
export function dbSuffix(env = { ...readEnvFile(), ...process.env }) {
  let suffix = env.DB_SUFFIX || "";
  const legacy = process.env.DB_NAME;
  if (!suffix && legacy && legacy !== LEGACY_PREFIX) {
    if (!legacy.startsWith(LEGACY_PREFIX)) {
      throw new Error(`DB_NAME=${legacy} is no longer used: each module has its own database now. Use DB_SUFFIX (for example DB_SUFFIX=_demo).`);
    }
    suffix = legacy.slice(LEGACY_PREFIX.length);
  }
  if (!/^[A-Za-z0-9_]*$/.test(suffix)) throw new Error(`DB_SUFFIX may only contain letters, digits and _ (got "${suffix}")`);
  return suffix;
}

export function dbNameOf(mod, env = { ...readEnvFile(), ...process.env }) {
  const name = `${env[`DB_NAME_${mod.code.toUpperCase()}`] || DEFAULT_DB[mod.code]}${dbSuffix(env)}`;
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Invalid database name "${name}" for ${mod.name}`);
  return name;
}

// Accounting API keys belong to one Accounting database, so each database set keeps its own
// (ERP_API_KEY_POS for the main set, ERP_API_KEY_POS_DEMO for DB_SUFFIX=_demo, ...).
export const API_KEY_VARS = ["ERP_API_KEY_POS", "ERP_API_KEY_HR", "ERP_API_KEY_SCM"];
export const keyVarFor = (base, suffix) => (suffix ? `${base}${suffix.toUpperCase()}` : base);

// Environment handed to every module: root .env values, then whatever the shell already set.
export function moduleEnv(mod, extra = {}) {
  const fileValues = readEnvFile();
  const env = { ...fileValues, ...process.env, ...extra };
  for (const m of MODULES) {
    const key = `ERP_URL_${m.code.toUpperCase()}`;
    if (!env[key]) env[key] = `http://localhost:${portOf(m, env)}`;
  }
  const suffix = dbSuffix(env);
  for (const base of API_KEY_VARS) {
    const own = env[keyVarFor(base, suffix)];
    if (suffix && own) env[base] = own;
  }
  if (mod) {
    env.PORT = String(portOf(mod, env));
    env.DB_NAME = dbNameOf(mod, env);
  }
  return env;
}

export function portOf(mod, env = process.env) {
  return Number(env[`PORT_${mod.code.toUpperCase()}`] || mod.port);
}
