import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dbConfig } from "../models/db.js";
import { AccountingValidationError } from "./accountTypes.js";

// Database backups of the Accounting books: mysqldump to storage/backups (outside public/, not in git).
// Restore loads one of those files back with the mysql client, after first saving a safety backup.
// Login sessions (admin_session) are left out, so a restore never logs everyone out or back in.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = path.join(__dirname, "..", "storage", "backups");
const NAME_PATTERN = /^[A-Za-z0-9_]+-\d{8}-\d{6}(-before-restore)?\.sql$/;
const MAX_KEEP = 30; // oldest backups beyond this are removed after a new one is made

// mysqldump / mysql: MYSQL_BIN_DIR in .env, else Laragon's MySQL, else whatever is on PATH.
function mysqlTool(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const dirs = [];
  if (process.env.MYSQL_BIN_DIR) dirs.push(process.env.MYSQL_BIN_DIR);
  const laragon = "C:\\laragon\\bin\\mysql";
  if (process.platform === "win32" && fs.existsSync(laragon)) {
    for (const v of fs.readdirSync(laragon).sort().reverse()) dirs.push(path.join(laragon, v, "bin"));
  }
  for (const dir of dirs) {
    const full = path.join(dir, exe);
    if (fs.existsSync(full)) return full;
  }
  return exe;
}

const connectionArgs = () => [
  `--host=${dbConfig.host}`, `--port=${dbConfig.port}`, `--user=${dbConfig.user}`, "--default-character-set=utf8mb4"
];
// The password goes in the environment, so it never shows in the process list.
const toolEnv = () => ({ ...process.env, MYSQL_PWD: dbConfig.password || "" });

function run(tool, args, { input, output } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(mysqlTool(tool), args, { env: toolEnv(), windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => reject(new AccountingValidationError(e.code === "ENOENT"
      ? `${tool} was not found. Set MYSQL_BIN_DIR in the Accounting .env to MySQL's bin folder.`
      : `${tool} could not start: ${e.message}`)));
    if (output) child.stdout.pipe(output);
    if (input) input.pipe(child.stdin);
    child.on("close", (code) => {
      // mysqldump warns about passwords on stderr even when it succeeds; only the exit code counts.
      if (code === 0) return resolve();
      reject(new AccountingValidationError(`${tool} failed: ${stderr.split(/\r?\n/).filter((l) => !/Using a password/i.test(l)).join(" ").trim().slice(0, 300) || `exit code ${code}`}`));
    });
  });
}

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function safePath(name) {
  if (!NAME_PATTERN.test(String(name || ""))) throw new AccountingValidationError("Backup not found");
  const full = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(full)) throw new AccountingValidationError("Backup not found");
  return full;
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((name) => NAME_PATTERN.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return {
        name,
        size: stat.size,
        sizeLabel: stat.size >= 1048576 ? `${(stat.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(stat.size / 1024))} KB`,
        createdAt: stat.mtime,
        kind: name.endsWith("-before-restore.sql") ? "Safety copy (before restore)" : "Backup"
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createBackup({ suffix = "" } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `${dbConfig.database}-${stamp()}${suffix}.sql`;
  const full = path.join(BACKUP_DIR, name);
  const output = fs.createWriteStream(full);
  try {
    await run("mysqldump", [
      ...connectionArgs(), "--single-transaction", "--routines", "--triggers", "--no-tablespaces",
      `--ignore-table=${dbConfig.database}.admin_session`, dbConfig.database
    ], { output });
    await new Promise((resolve) => (output.writableFinished ? resolve() : output.on("finish", resolve)));
  } catch (e) {
    output.destroy();
    fs.rmSync(full, { force: true });
    throw e;
  }
  if (fs.statSync(full).size < 100) {
    fs.rmSync(full, { force: true });
    throw new AccountingValidationError("The backup came out empty; check the MySQL connection");
  }
  // Keep the folder from growing without limit.
  for (const old of listBackups().slice(MAX_KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
  return listBackups().find((b) => b.name === name);
}

export function backupFile(name) {
  return safePath(name);
}

export function deleteBackup(name) {
  fs.rmSync(safePath(name), { force: true });
}

/** Replaces the Accounting database with a backup. A safety backup of the current data is made first. */
export async function restoreBackup(name, confirmText) {
  const full = safePath(name);
  if (String(confirmText ?? "").trim().toUpperCase() !== "RESTORE") {
    throw new AccountingValidationError('Type RESTORE to confirm');
  }
  const head = fs.readFileSync(full, { encoding: "utf8", flag: "r" }).slice(0, 4000);
  if (!/MySQL dump/i.test(head)) throw new AccountingValidationError("This file is not a MySQL backup made by this system");
  const safety = await createBackup({ suffix: "-before-restore" });
  await run("mysql", [...connectionArgs(), dbConfig.database], { input: fs.createReadStream(full) });
  return { restored: name, safetyCopy: safety?.name };
}
