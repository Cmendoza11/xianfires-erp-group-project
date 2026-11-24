import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Server errors are kept in storage/logs/errors-YYYY-MM.log (one file per month, outside public/ and git),
// so a problem seen during a demo can be looked up later: when, which page, which user, and the error.
export const LOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "storage", "logs");

export function logError(err, req, kind = "error") {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const now = new Date();
    const file = path.join(LOG_DIR, `errors-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.log`);
    const who = req?.adminUser?.email || "-";
    const where = req ? `${req.method} ${req.originalUrl}` : "-";
    const detail = String(err?.stack || err?.message || err).split("\n").slice(0, 8).join("\n    ");
    fs.appendFileSync(file, `[${now.toISOString()}] ${kind.toUpperCase()} ${where} user=${who}\n    ${detail}\n`);
  } catch {
    // Logging must never break the response.
  }
}
