// npm run accounts [-- --email you@x.com --name "Your Name" --suffix _demo]
// Creates or updates ONE administrator login in all five modules, with the same password everywhere.
// The password is typed in the terminal (hidden), never passed on the command line unless --password is given.
// Like `npm run migrate`, this is an owner's admin tool, so it writes each module's user table directly.
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { MODULES, moduleDir, moduleEnv, dbNameOf } from "./erp-env.js";

// The root package has no dependencies; borrow the Accounting module's (bcryptjs hashes work with every module's bcrypt).
const requireFromErp = createRequire(path.join(moduleDir(MODULES[0]), "package.json"));
const mysql = requireFromErp("mysql2/promise");
const bcrypt = requireFromErp("bcryptjs");

const MIN_PASSWORD = 8; // HR requires 8, the strictest of the five modules
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Each module's login table, how it names columns, and the role that can open every page.
const TARGETS = [
  { code: "erp", module: "Accounting", table: "admin_user", name: "full_name", created: "created_at", updated: "updated_at", erp: true },
  { code: "hr", module: "HR", table: "hr_users", name: "name", created: "createdAt", updated: "updatedAt" },
  { code: "pos", module: "POS & Inventory", table: "pos_users", name: "name", created: "createdAt", updated: "updatedAt" },
  { code: "scm", module: "Procurement", table: "scm_users", name: "name", created: "createdAt", updated: "updatedAt", paranoid: true },
  { code: "crm", module: "Customer Logs", table: "crm_users", name: "name", created: "createdAt", updated: "updatedAt" },
];

const { values: args } = parseArgs({
  options: {
    email: { type: "string", short: "e" },
    name: { type: "string", short: "n" },
    password: { type: "string", short: "p" },
    suffix: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`Usage: npm run accounts [-- --email <email>] [--name "<full name>"] [--suffix _demo]
Creates or updates one admin account (same email and password) in all 5 DJ's ERP modules,
each in that module's own database. --suffix picks another database set (same as DB_SUFFIX).
Anything you leave out is asked in the terminal. The password is always typed hidden.`);
  process.exit(0);
}

// Piped input (no terminal): answer the questions from stdin lines, in order. Read only when a question is asked.
const piped = !process.stdin.isTTY;
let pipedLines = null;
function nextPipedLine() {
  if (pipedLines === null) {
    try {
      pipedLines = fs.readFileSync(0, "utf8").split(/\r?\n/);
    } catch {
      pipedLines = [];
    }
  }
  return pipedLines.shift() ?? "";
}

async function askVisible(question) {
  if (piped) return nextPipedLine().trim();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
}

function askHidden(question) {
  if (piped) return Promise.resolve(nextPipedLine());
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let value = "";
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\nCancelled.\n");
          process.exit(130);
        }
        if (ch === "\b" || ch === "\u007f") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue;
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

if (args.suffix !== undefined) process.env.DB_SUFFIX = args.suffix;
const env = moduleEnv();
const byCode = Object.fromEntries(MODULES.map((m) => [m.code, m]));
for (const target of TARGETS) target.db = dbNameOf(byCode[target.code], env);
console.log("\nDJ's ERP: one admin account for all 5 modules");
for (const target of TARGETS) console.log(`  ${target.module.padEnd(16)} database ${target.db}`);
console.log("");

const email = String(args.email || (await askVisible("Email: "))).trim().toLowerCase();
if (!EMAIL_PATTERN.test(email)) fail("Please enter a valid email address.");
const name = String(args.name || (await askVisible("Full name: "))).trim();
if (name.length < 2) fail("Please enter a full name (at least 2 characters).");

let password = args.password;
if (password === undefined) {
  password = await askHidden(`Password (at least ${MIN_PASSWORD} characters): `);
  if (password.length >= MIN_PASSWORD) {
    const confirmation = await askHidden("Type the password again: ");
    if (confirmation !== password) fail("The two passwords do not match. Nothing was changed.");
  }
}
if (password.length < MIN_PASSWORD) fail(`Password must be at least ${MIN_PASSWORD} characters. Nothing was changed.`);

let connection;
try {
  connection = await mysql.createConnection({
    host: env.DB_HOST || "localhost",
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || "root",
    password: env.DB_PASSWORD ?? env.DB_PASS ?? "",
  });
} catch (err) {
  fail(`Cannot connect to MySQL: ${err.message}\n   Is MySQL running in Laragon?`);
}

const hash = await bcrypt.hash(password, 10);
const [tableRows] = await connection.query(
  "SELECT table_schema AS d, table_name AS t FROM information_schema.tables WHERE table_schema IN (?)",
  [TARGETS.map((t) => t.db)]
);
const existingTables = new Set(tableRows.map((row) => `${row.d}.${String(row.t).toLowerCase()}`));

const results = [];
await connection.beginTransaction();
try {
  for (const target of TARGETS) {
    if (!existingTables.has(`${target.db}.${target.table}`)) {
      results.push({ module: target.module, result: "skipped: tables missing (run npm run migrate)" });
      continue;
    }
    const q = (id) => `\`${id}\``;
    const table = `${q(target.db)}.${q(target.table)}`;
    const [found] = await connection.query(
      `SELECT ${target.erp ? "admin_user_id" : "id"} AS id FROM ${table} WHERE LOWER(email) = ? LIMIT 1`,
      [email]
    );
    if (found.length) {
      const sets = [`${q(target.name)} = ?`, "password = ?", "role = 'admin'", `${q(target.updated)} = UTC_TIMESTAMP()`];
      if (target.erp) sets.push("status = 1");
      if (target.paranoid) sets.push("deletedAt = NULL");
      await connection.query(
        `UPDATE ${table} SET ${sets.join(", ")} WHERE ${target.erp ? "admin_user_id" : "id"} = ?`,
        [name, hash, found[0].id]
      );
      results.push({ module: target.module, result: "updated (password changed, role admin)" });
    } else if (target.erp) {
      await connection.query(
        `INSERT INTO ${table} (uuid, status, email, password, full_name, role, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, 'admin', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [crypto.randomUUID(), email, hash, name]
      );
      results.push({ module: target.module, result: "created (role admin)" });
    } else {
      await connection.query(
        `INSERT INTO ${table} (${q(target.name)}, email, password, role, ${q(target.created)}, ${q(target.updated)})
         VALUES (?, ?, ?, 'admin', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [name, email, hash]
      );
      results.push({ module: target.module, result: "created (role admin)" });
    }
  }
  await connection.commit();
} catch (err) {
  await connection.rollback();
  await connection.end();
  fail(`Nothing was changed: ${err.message}`);
}
await connection.end();

console.log("");
for (const row of results) console.log(`  ${row.module.padEnd(16)} ${row.result}`);
console.log(`\n✅ Log in to every module with ${email} and the password you typed.`);
console.log("   Run npm run accounts again any time to change the password.\n");
