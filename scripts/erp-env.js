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

// Environment handed to every module: root .env values, then whatever the shell already set.
export function moduleEnv(mod, extra = {}) {
  const fileValues = readEnvFile();
  const env = { ...fileValues, ...process.env, ...extra };
  for (const m of MODULES) {
    const key = `ERP_URL_${m.code.toUpperCase()}`;
    if (!env[key]) env[key] = `http://localhost:${portOf(m, env)}`;
  }
  if (mod) env.PORT = String(portOf(mod, env));
  return env;
}

export function portOf(mod, env = process.env) {
  return Number(env[`PORT_${mod.code.toUpperCase()}`] || mod.port);
}
