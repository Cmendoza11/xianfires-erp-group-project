/*
  Checks that HR can reach the Accounting laptop (the host) in LAN mode.
    node check-connection.js        (or: npm run check:lan)
  It changes nothing in the database. It stops at the first ✗ and says how to fix it.
*/
import { hrEnvLoaded, HR_ENV_FILE } from "./config/env.js";
import net from "node:net";
import { Sequelize } from "sequelize";

const env = process.env;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg, fix) => {
  console.log(`  ✗ ${msg}`);
  if (fix) console.log(`    Fix: ${fix}`);
  process.exit(1);
};
const step = (n, title) => console.log(`\n${n}. ${title}`);

const DB_HOST = env.DB_HOST || "localhost";
const DB_PORT = Number(env.DB_PORT || 3306);
const DB_NAME = env.DB_NAME || "djs_hr";
const DB_USER = env.DB_USER || "root";
const DB_PASS = env.DB_PASSWORD ?? env.DB_PASS ?? "";
const ERP_URL = (env.ERP_URL_ERP || "http://localhost:3000").replace(/\/+$/, "");

console.log("DJ's HRMS - LAN connection check");

// 1 ---------------------------------------------------------------
step(1, ".env");
if (!hrEnvLoaded) fail(`${HR_ENV_FILE} not found`, "copy .env.example to .env in the HR folder and fill it in");
for (const key of ["PORT", "DB_HOST", "DB_NAME", "DB_USER", "ERP_URL_ERP", "ERP_API_KEY_HR", "ERP_INTERNAL_KEY", "SESSION_SECRET"]) {
  if (!env[key]) fail(`${key} is empty`, `set ${key} in .env (see .env.example)`);
}
if (/192\.168\.1\.10|change-me/.test(`${DB_HOST} ${DB_PASS} ${env.SESSION_SECRET}`)) {
  console.log("  ! Some values still look like the example. Check DB_HOST, DB_PASSWORD and SESSION_SECRET.");
}
ok(`PORT=${env.PORT}, database ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}, Accounting ${ERP_URL}`);

// 2 ---------------------------------------------------------------
step(2, `Network: can this laptop reach ${DB_HOST}:${DB_PORT}?`);
await new Promise((resolve) => {
  const socket = net.connect({ host: DB_HOST, port: DB_PORT, timeout: 5000 });
  socket.once("connect", () => { socket.destroy(); resolve(); });
  socket.once("timeout", () => fail(`no answer from ${DB_HOST}:${DB_PORT}`,
    "same Wi-Fi? did the host's IP change (ipconfig)? host firewall allows TCP 3306 on Private networks? School Wi-Fi often blocks laptop-to-laptop: use a phone hotspot"));
  socket.once("error", (e) => fail(`cannot connect (${e.code})`,
    e.code === "ECONNREFUSED" ? "host's Laragon MySQL is stopped, or my.ini still has bind-address=127.0.0.1 / skip-networking" : "check DB_HOST"));
});
ok("MySQL port is open");

// 3 ---------------------------------------------------------------
step(3, "MySQL login and HR database");
const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASS, { host: DB_HOST, port: DB_PORT, dialect: "mysql", logging: false });
try {
  await sequelize.authenticate();
  const [rows] = await sequelize.query("SHOW TABLES LIKE 'hr\\_%'");
  if (rows.length === 0) fail(`${DB_NAME} has no hr_ tables`, "on the host run `npm run migrate` at the ERP root (it creates djs_hr)");
  ok(`logged in; ${rows.length} hr_ tables found`);
} catch (e) {
  const msg = e.original?.sqlMessage || e.message;
  if (/Access denied/i.test(msg)) fail(msg, "run the CREATE USER / GRANT lines on the host (LAN-SETUP.md step 1.3) and check DB_PASSWORD");
  if (/Unknown database/i.test(msg)) fail(msg, "on the host run `npm run migrate` at the ERP root");
  if (/not allowed to connect/i.test(msg)) fail(msg, "the host user must be 'djs_hr'@'%' (not only @'localhost')");
  fail(msg);
} finally {
  await sequelize.close().catch(() => {});
}

// 4 ---------------------------------------------------------------
step(4, `Accounting API at ${ERP_URL}`);
try {
  // GET /api/v1/ answers any valid key with the system name and scopes.
  const res = await fetch(`${ERP_URL}/api/v1/`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.ERP_API_KEY_HR}` },
    signal: AbortSignal.timeout(6000)
  });
  if (res.status === 401 || res.status === 403) fail(`Accounting refused HR's key (${res.status})`, "copy ERP_API_KEY_HR from the root .env on the host");
  if (!res.ok) fail(`Accounting answered ${res.status}`, "check that Accounting is running on the host");
  ok("Accounting answers and accepts HR's key (paid payroll can be posted)");
} catch (e) {
  fail(`Accounting is not reachable (${e.cause?.code || e.name})`,
    "start Accounting on the host; host firewall must allow TCP 3000-3004; check ERP_URL_ERP");
}

console.log("\n✓ HR is connected to the host (database + Accounting). Start it with: npm run xian\n");
