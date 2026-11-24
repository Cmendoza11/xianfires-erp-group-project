// Entry file for hosts without a terminal (Hostinger Web Apps): create/upgrade the tables (safe to repeat),
// make the first administrator from ADMIN_EMAIL/ADMIN_PASSWORD if it is missing, then start the server.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const cwd = dirname(fileURLToPath(import.meta.url));
const run = (args) => execFileSync(process.execPath, args, { cwd, stdio: "inherit", env: process.env });

try {
  run(["migrate.js", "--yes"]);
} catch {
  console.error("❌ Could not prepare the database. Check DB_HOST, DB_NAME, DB_USER and DB_PASSWORD.");
  process.exit(1);
}

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  try {
    execFileSync(process.execPath, ["user.js", "create", "--name", ADMIN_NAME || "Administrator", "--email", ADMIN_EMAIL, "--password", ADMIN_PASSWORD], { cwd, stdio: "ignore", env: process.env });
    console.log(`first administrator created: ${ADMIN_EMAIL}`);
  } catch {
    console.log(`administrator ${ADMIN_EMAIL} already exists`);
  }
}

await import("./index.js");
