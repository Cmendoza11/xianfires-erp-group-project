/*
  Loads DJs-Human-Resource-Management-main/.env into process.env.

  - LAN mode (HR on its own laptop): HR reads its own .env, where DB_HOST and ERP_URL_ERP
    point to the Accounting laptop (the host).
  - Started from the ERP root (`npm run dev`): the root already passes every setting, and those
    win, because a value that is already set is never overwritten here.

  Import this file FIRST (before models/), so the database settings are ready when db.js runs.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `npm run dev:solo` (node index.js --solo) uses .env.solo: this laptop's own database, for working
// while the host is offline. Plain `npm run dev` uses .env (LAN mode, the host's database).
export const SOLO = process.argv.includes("--solo");
export const HR_ENV_FILE = path.join(HR_ROOT, SOLO ? ".env.solo" : ".env");

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, ""); // allow "DB_HOST=192.168.1.10   # comment"
    values[match[1]] = value;
  }
  return values;
}

export const hrEnvLoaded = fs.existsSync(HR_ENV_FILE);

if (hrEnvLoaded) {
  const values = parseEnv(fs.readFileSync(HR_ENV_FILE, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
