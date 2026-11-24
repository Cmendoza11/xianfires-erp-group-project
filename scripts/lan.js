// npm run lan -- <host|check|reset>: run DJ's ERP across several laptops on one Wi-Fi (LAN mode).
//
// One laptop (the DB host) keeps MySQL with all 5 databases. Every member runs only their own module
// on their own laptop and connects to the DB host by its IP. Modules still talk only through APIs,
// so each module just needs the other modules' addresses in ERP_URL_*.
//
//   npm run lan -- host [--ip=<host ip>] [--pos=<ip>] [--hr=<ip>] [--scm=<ip>] [--crm=<ip>] [--erp-only]
//       DB host only. Creates the LAN MySQL accounts, sets ERP_URL_* and writes lan/member.env
//       (the .env every member copies) plus lan/connect-<module>.txt (one connection sheet per module).
//       A module with no IP given runs on the DB host itself, unless --erp-only (only Accounting runs
//       here; the other four connect from their own laptops).
//   npm run lan -- check          Any laptop. Tests the DB host, the login, the 5 databases and every module URL.
//   npm run lan -- reset          DB host. Back to one-laptop mode (ERP_URL_* empty = localhost).
//   npm run lan -- import <file>  Member laptop. Copies the host's connect-<module>.txt (or member.env) into the
//       root .env and the module's own .env, so the module connects to the host. Then run check.
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { MODULES, ROOT, ENV_FILE, moduleDir, readEnvFile, updateEnvFile, dbNameOf, portOf } from "./erp-env.js";

const LAN_DIR = path.join(ROOT, "lan");
const MEMBER_ENV = path.join(LAN_DIR, "member.env");
const DEFAULT_LAN_USER = "djs_erp";

const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg, fix) => console.log(`  \x1b[31m✗\x1b[0m ${msg}${fix ? `\n      fix: ${fix}` : ""}`);
const info = (msg) => console.log(`    ${msg}`);

function args() {
  const out = { _: [] };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-z-]+)=(.*)$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
    else if (/^--[a-z-]+$/i.test(a)) out[a.slice(2).toLowerCase()] = true;
    else out._.push(a);
  }
  return out;
}

// mysql2 is not installed at the repo root; borrow it from whichever module has node_modules.
function loadMysql() {
  for (const mod of MODULES) {
    try {
      return createRequire(path.join(moduleDir(mod), "package.json"))("mysql2/promise");
    } catch {
      /* try the next module */
    }
  }
  throw new Error("mysql2 not found. Run `npm run setup` (or npm install inside your module) first.");
}

// IPv4 addresses of this laptop, Wi-Fi first. 192.168.56.x is VirtualBox; vEthernet is Hyper-V/WSL.
function localIps() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      if (a.address.startsWith("192.168.56.") || /vethernet|virtualbox|vmware|wsl/i.test(name)) continue;
      const rank = /wi-?fi|wlan|wireless/i.test(name) ? 0 : /ethernet/i.test(name) ? 1 : 2;
      list.push({ name, address: a.address, rank });
    }
  }
  return list.sort((x, y) => x.rank - y.rank);
}

const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s || "");
const urlFor = (ip, mod, env) => `http://${ip}:${portOf(mod, env)}`;

function tcpCheck(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done("timeout"));
    socket.once("connect", () => done("ok"));
    socket.once("error", (e) => done(e.code || e.message));
  });
}

async function httpCheck(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    return { up: true, status: res.status };
  } catch (e) {
    return { up: false, error: e.cause?.code || e.name || e.message };
  }
}

const quoteId = (name) => `\`${name.replace(/`/g, "``")}\``;

// ---------------------------------------------------------------- host
async function host(opts) {
  const env = readEnvFile();
  if (!fs.existsSync(ENV_FILE)) throw new Error("No .env yet. Run `npm run migrate` on this laptop first.");
  if (env.DB_HOST && !["localhost", "127.0.0.1", "::1"].includes(env.DB_HOST)) {
    throw new Error(`This .env points to another DB host (${env.DB_HOST}). Run "host" only on the laptop that has MySQL and the data.`);
  }

  console.log("\nDJ's ERP · LAN mode · DB host setup\n");
  const ips = localIps();
  const hostIp = opts.ip || ips[0]?.address;
  if (!isIp(hostIp)) throw new Error("No Wi-Fi IPv4 address found. Connect to the Wi-Fi (or hotspot) first, or pass --ip=<address>.");
  console.log("This laptop's addresses:");
  for (const i of ips) info(`${i.address.padEnd(16)} ${i.name}${i.address === hostIp ? "   <- DB host IP" : ""}`);

  // 1. MySQL reachable as root, and open to the network.
  const mysql = loadMysql();
  let conn;
  try {
    conn = await mysql.createConnection({
      host: env.DB_HOST || "localhost",
      port: Number(env.DB_PORT || 3306),
      user: env.DB_USER || "root",
      password: env.DB_PASSWORD || "",
    });
  } catch (e) {
    throw new Error(`Cannot log in to MySQL on this laptop (${e.code || e.message}). Open Laragon and click Start All.`);
  }
  console.log("\nMySQL:");
  const [[v]] = await conn.query("SELECT VERSION() AS version, @@skip_networking AS skipNet, @@bind_address AS bind");
  ok(`MySQL ${v.version} running`);
  if (Number(v.skipNet)) bad("skip_networking is ON, other laptops cannot connect", "remove skip-networking from my.ini, then Laragon Stop / Start All");
  else ok("network connections allowed");
  if (["127.0.0.1", "localhost", "::1"].includes(String(v.bind))) {
    bad(`bind-address=${v.bind} only accepts this laptop`, "Laragon menu > MySQL > my.ini: change it to bind-address=0.0.0.0, then Stop / Start All");
  } else ok(`listening on ${v.bind}`);

  // 2. The 5 databases exist (and the _demo set, if there is one).
  const [dbRows] = await conn.query("SHOW DATABASES");
  const existing = new Set(dbRows.map((r) => r.Database));
  const sets = [""];
  if (MODULES.every((m) => existing.has(dbNameOf(m, { ...env, DB_SUFFIX: "_demo" })))) sets.push("_demo");
  const dbs = [];
  for (const suffix of sets) for (const m of MODULES) dbs.push(dbNameOf(m, { ...env, DB_SUFFIX: suffix }));
  const missing = dbs.filter((d) => !existing.has(d));
  if (missing.length) throw new Error(`Missing databases: ${missing.join(", ")}. Run \`npm run migrate\` first.`);
  ok(`databases ready: ${dbs.join(", ")}`);

  // 3. One MySQL account for the other laptops, limited to the ERP databases.
  const lanUser = env.LAN_DB_USER || DEFAULT_LAN_USER;
  const lanPass = env.LAN_DB_PASSWORD || crypto.randomBytes(12).toString("base64url");
  for (const where of ["%", "localhost"]) {
    await conn.query("CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?", [lanUser, where, lanPass]);
    await conn.query("ALTER USER ?@? IDENTIFIED BY ?", [lanUser, where, lanPass]);
    for (const db of dbs) await conn.query(`GRANT ALL PRIVILEGES ON ${quoteId(db)}.* TO ?@?`, [lanUser, where]);
  }
  // One account per module, limited to that module's own database (and its _demo twin): a team that
  // connects with its own sheet can never read or change another module's data.
  const moduleAccounts = {};
  for (const mod of MODULES.filter((m) => m.code !== "erp")) {
    const user = `djs_${mod.code}`;
    const passKey = `LAN_DB_PASSWORD_${mod.code.toUpperCase()}`;
    const password = env[passKey] || crypto.randomBytes(12).toString("base64url");
    for (const where of ["%", "localhost"]) {
      await conn.query("CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?", [user, where, password]);
      await conn.query("ALTER USER ?@? IDENTIFIED BY ?", [user, where, password]);
      for (const suffix of sets) {
        await conn.query(`GRANT ALL PRIVILEGES ON ${quoteId(dbNameOf(mod, { ...env, DB_SUFFIX: suffix }))}.* TO ?@?`, [user, where]);
      }
    }
    moduleAccounts[mod.code] = { user, password, passKey };
  }
  await conn.query("FLUSH PRIVILEGES");
  await conn.end();
  ok(`MySQL account "${lanUser}" can open the ERP databases from any laptop (password saved in .env as LAN_DB_PASSWORD)`);
  ok(`per-module accounts: ${Object.values(moduleAccounts).map((a) => a.user).join(", ")} (each opens only its own database)`);

  // 4. Where each module runs. Modules with no IP given run here on the DB host.
  const updates = { LAN_DB_USER: lanUser, LAN_DB_PASSWORD: lanPass, LAN_HOST_IP: hostIp };
  for (const a of Object.values(moduleAccounts)) updates[a.passKey] = a.password;
  const erpOnly = Boolean(opts["erp-only"]);
  const plan = [];
  for (const mod of MODULES) {
    const given = typeof opts[mod.code] === "string" ? opts[mod.code] : "";
    if (given && !isIp(given)) throw new Error(`--${mod.code}=${given} is not an IPv4 address`);
    const elsewhere = mod.code !== "erp" && (given || erpOnly);
    const ip = given || hostIp;
    updates[`ERP_URL_${mod.code.toUpperCase()}`] = urlFor(ip, mod, env);
    plan.push({ mod, ip, onHost: !elsewhere, pending: elsewhere && !given });
  }
  updateEnvFile(updates);
  const after = readEnvFile();

  // 5. The .env every other laptop uses: same keys and secrets, the DB host's IP, the LAN account.
  const member = { ...after, DB_HOST: hostIp, DB_USER: lanUser, DB_PASSWORD: lanPass };
  delete member.ADMIN_PASSWORD;
  delete member.ADMIN_EMAIL;
  delete member.LAN_DB_PASSWORD;
  fs.mkdirSync(LAN_DIR, { recursive: true });
  const lines = [
    "# DJ's ERP - .env for a member laptop in LAN mode. Made by `npm run lan -- host` on the DB host.",
    "# Copy this file to the repo root of your laptop and rename it to .env. Never commit it.",
    `# DB host: ${hostIp}. If the DB host's IP changes, the host runs \`npm run lan -- host\` again and re-sends this file.`,
    ...Object.entries(member).map(([k, val]) => `${k}=${val}`),
  ];
  fs.writeFileSync(MEMBER_ENV, lines.join("\n") + "\n");
  ok(`member .env written to ${path.relative(ROOT, MEMBER_ENV)}`);

  // 6. One connection sheet per module, for teams that run their own copy of their system.
  const erpUrl = after.ERP_URL_ERP;
  for (const mod of MODULES.filter((m) => m.code !== "erp")) {
    const account = moduleAccounts[mod.code];
    const keyVar = `ERP_API_KEY_${mod.code.toUpperCase()}`;
    const sheet = [
      `DJ's ERP - connection sheet for ${mod.name}`,
      `From the Accounting host laptop (${hostIp}). Keep it private: it holds passwords and keys.`,
      "",
      "EASIEST (group repo): save this file, then at the repo root run",
      `    npm run lan -- import "<path to this file>\\connect-${mod.code}.txt"`,
      "    npm run lan -- check",
      `    npm run dev -- --only=${mod.code}`,
      "",
      "Or by hand: put these in your module's .env, then restart your app:",
      "",
      "# Your module's own database, on the host laptop",
      `DB_HOST=${hostIp}`,
      `DB_PORT=${after.DB_PORT || 3306}`,
      `DB_NAME=${dbNameOf(mod, after)}`,
      `DB_USER=${account.user}`,
      `DB_PASSWORD=${account.password}`,
      "",
      "# Accounting (the ERP hub), the other modules, and the shared integration secrets",
      `ERP_URL_ERP=${erpUrl}`,
      // Modules call each other directly too (POS -> Customer Logs, Procurement -> POS and HR).
      ...MODULES.filter((m) => m.code !== "erp" && after[`ERP_URL_${m.code.toUpperCase()}`])
        .map((m) => `ERP_URL_${m.code.toUpperCase()}=${after[`ERP_URL_${m.code.toUpperCase()}`]}`),
      ...(after[keyVar] ? [`${keyVar}=${after[keyVar]}`] : []),
      `ERP_INTERNAL_KEY=${after.ERP_INTERNAL_KEY}`,
      `PORT=${portOf(mod, after)}`,
      "",
      "# Let the other laptops reach your system (once, in PowerShell as Administrator):",
      `New-NetFirewallRule -DisplayName "DJ's ERP ${mod.name}" -Direction Inbound -Protocol TCP -LocalPort ${portOf(mod, after)} -Action Allow -Profile Any -RemoteAddress LocalSubnet`,
      "",
      `# Easiest test: double-click test-${mod.code}.bat (sent with this sheet). Or in PowerShell:`,
      `Test-NetConnection ${hostIp} -Port ${after.DB_PORT || 3306}      # TcpTestSucceeded : True`,
      `Test-NetConnection ${hostIp} -Port ${portOf(MODULES[0], after)}      # TcpTestSucceeded : True`,
      `curl.exe ${erpUrl}/api/v1/health        # {"data":{"status":"ok"}}`,
      "",
      "If a test fails: same Wi-Fi as the host? The host's Wi-Fi must be Private with the firewall rules on",
      "(docs/ACCOUNTING-HOST.md). School Wi-Fi that blocks laptops: everyone joins one phone hotspot.",
      "Using the group repo instead? Copy lan/member.env to the repo root as .env and run: npm run lan -- check"
    ];
    fs.writeFileSync(path.join(LAN_DIR, `connect-${mod.code}.txt`), sheet.join("\n") + "\n");

    // Double-click test for the teammate's laptop: the 3 checks, in plain words.
    const dbPort = after.DB_PORT || 3306;
    const test = [
      "@echo off",
      // cmd treats & ( ) as commands, so "POS & Inventory" must be escaped in a title.
      `title DJ's ERP - connection test ^(${mod.name.replace(/[&()]/g, "^$&")}^)`,
      `echo Testing the connection to the DJ's ERP host ${hostIp} ...`,
      "echo.",
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "$h='${hostIp}'; $ok=$true; ` +
        `foreach ($t in @(@{p=${dbPort};n='Database (MySQL)'}, @{p=${portOf(MODULES[0], after)};n='Accounting'})) { ` +
        `$r = Test-NetConnection $h -Port $t.p -WarningAction SilentlyContinue; ` +
        `if ($r.TcpTestSucceeded) { Write-Host ('  OK    ' + $t.n + ' reachable on port ' + $t.p) -ForegroundColor Green } ` +
        `else { $ok=$false; Write-Host ('  FAIL  ' + $t.n + ' NOT reachable on port ' + $t.p) -ForegroundColor Red } }; ` +
        `try { $b = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 ('http://' + $h + ':${portOf(MODULES[0], after)}/api/v1/health')).Content; ` +
        `if ($b -match 'ok') { Write-Host '  OK    Accounting API answers' -ForegroundColor Green } else { $ok=$false; Write-Host '  FAIL  Accounting API gave an unexpected answer' -ForegroundColor Red } } ` +
        `catch { $ok=$false; Write-Host '  FAIL  Accounting API not answering' -ForegroundColor Red }; ` +
        `Write-Host ''; if ($ok) { Write-Host 'All good. Put the settings from connect-${mod.code}.txt in your .env and start your system.' -ForegroundColor Cyan } ` +
        `else { Write-Host 'Fix: be on the SAME Wi-Fi or hotspot as the host, and ask the host to run DJs-ERP-Host.bat. School Wi-Fi blocking? Everyone joins one phone hotspot.' -ForegroundColor Yellow }"`,
      "echo.",
      "pause"
    ];
    fs.writeFileSync(path.join(LAN_DIR, `test-${mod.code}.bat`), test.join("\r\n") + "\r\n");
  }
  ok(`connection sheets + tests written: ${MODULES.filter((m) => m.code !== "erp").map((m) => `lan/connect-${m.code}.txt + test-${m.code}.bat`).join(", ")}`);

  // 7. Windows settings that block other laptops (read only; the fixes need an administrator).
  console.log("\nThis laptop (network):");
  hostNetworkChecks();

  // 8. Who runs what.
  const hostCodes = plan.filter((p) => p.onHost).map((p) => p.mod.code);
  console.log("\nWho runs what:");
  for (const p of plan) {
    const where = p.onHost ? "this laptop (host)" : p.pending ? "teammate's laptop (IP not set yet: --" + p.mod.code + "=<ip>)" : "teammate's laptop";
    info(`${p.mod.name.padEnd(16)} ${p.pending ? "-".padEnd(28) : urlFor(p.ip, p.mod, after).padEnd(28)} ${where}`);
  }
  console.log("\nNext:");
  info(`On this laptop:   npm run dev -- --only=${hostCodes.join(",") || "erp"}`);
  info("Send each teammate their 2 files (privately): lan/connect-<module>.txt and lan/test-<module>.bat");
  if (plan.some((p) => p.pending)) info("When teammates send their IPs, run this again with --pos=<ip> --hr=<ip> --scm=<ip> --crm=<ip>.");
  console.log("");
}

function powershell(command) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", timeout: 15000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Windows blocks other laptops unless the firewall lets the ports in. `npm run host-network` adds two
// rules for the same network on any Wi-Fi profile; without them a Public Wi-Fi blocks everything.
function hostNetworkChecks() {
  if (process.platform !== "win32") return info("(network checks run on Windows only)");
  // Only our own named rules are read: listing every Windows rule takes close to a minute.
  const rules = powershell(`Get-NetFirewallRule -DisplayName "DJ's ERP*" -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' } | ForEach-Object { ($_ | Get-NetFirewallPortFilter).LocalPort + '|' + $_.Profile }`);
  const entries = (rules ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const [port, profile] = x.split("|");
    return { port, profile };
  });
  const covering = (port) => entries.find((e) => e.port === String(port) || (/^\d+-\d+$/.test(e.port) && Number(e.port.split("-")[0]) <= port && port <= Number(e.port.split("-")[1])));
  let missing = false;
  for (const [port, label] of [[3306, "MySQL 3306"], [3000, "Accounting 3000"]]) {
    const rule = covering(port);
    if (rule) ok(`firewall rule allows ${label} (${rule.profile})`);
    else {
      missing = true;
      bad(`no "DJ's ERP" firewall rule for ${label}`, "run  npm run host-network  (click Yes, then type y)");
    }
  }
  // A Block rule for mysqld/node (left by a Cancel on Windows' "Allow access?" prompt) beats our Allow rules.
  const blocks = powershell(`Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | ForEach-Object { $p = ($_ | Get-NetFirewallApplicationFilter).Program; if ($p -match '\\\\(mysqld|node)\\.exe$') { [IO.Path]::GetFileName($p) + '|' + $_.Profile } }`);
  for (const line of [...new Set((blocks ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean))]) {
    const [program, profile] = line.split("|");
    missing = true;
    bad(`Windows firewall BLOCKS ${program} on ${profile} networks (this beats the ERP rules)`, "run  npm run host-network  (click Yes, then type y)");
  }
  const anyProfile = !missing && entries.every((e) => /Any/i.test(e.profile));
  const profiles = powershell("Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + '|' + $_.NetworkCategory }");
  for (const line of (profiles ?? "").split(/\r?\n/).filter(Boolean)) {
    const [name, category] = line.split("|");
    if (category !== "Public") ok(`${name} is ${category}`);
    else if (anyProfile) ok(`${name} is Public, but the ERP firewall rules work on any network`);
    else bad(`${name} is a Public network: Windows blocks other laptops`, "run  npm run host-network");
  }
}

// ---------------------------------------------------------------- check
async function check() {
  console.log("\nDJ's ERP · LAN check\n");
  if (!fs.existsSync(ENV_FILE)) {
    bad(".env not found", "DB host: npm run migrate. Member: copy lan/member.env from the DB host to the repo root as .env");
    process.exit(1);
  }
  const env = { ...readEnvFile(), ...process.env };
  let failed = 0;

  console.log("1. Settings (.env)");
  const need = ["DB_HOST", "DB_USER", "ERP_INTERNAL_KEY", "SESSION_SECRET", "ERP_API_KEY_POS", "ERP_API_KEY_HR", "ERP_API_KEY_SCM"];
  const empty = need.filter((k) => !env[k]);
  if (empty.length) {
    failed++;
    bad(`missing: ${empty.join(", ")}`, "copy the newest lan/member.env from the DB host");
  } else ok(`DB host ${env.DB_HOST}, user ${env.DB_USER}, keys present`);

  console.log("2. Network to the DB host");
  const port = env.DB_PORT || 3306;
  const tcp = await tcpCheck(env.DB_HOST, port);
  if (tcp === "ok") ok(`${env.DB_HOST}:${port} reachable`);
  else {
    failed++;
    bad(`${env.DB_HOST}:${port} not reachable (${tcp})`,
      "same Wi-Fi as the DB host? DB host IP changed (ipconfig)? DB host: Laragon Start All, firewall rule for 3306, Wi-Fi set to Private. School Wi-Fi blocking laptops: use a phone hotspot");
  }

  console.log("3. MySQL login and the 5 databases");
  if (tcp === "ok") {
    try {
      const mysql = loadMysql();
      const conn = await mysql.createConnection({ host: env.DB_HOST, port: Number(port), user: env.DB_USER, password: env.DB_PASSWORD || "", connectTimeout: 5000 });
      ok(`logged in as ${env.DB_USER}`);
      for (const mod of MODULES) {
        const db = dbNameOf(mod, env);
        try {
          const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?", [db]);
          if (row.n > 0) ok(`${mod.name.padEnd(16)} ${db} (${row.n} tables)`);
          else {
            failed++;
            bad(`${mod.name.padEnd(16)} ${db} not found or no access`, "DB host: npm run lan -- host (grants the LAN account)");
          }
        } catch (e) {
          failed++;
          bad(`${db}: ${e.code || e.message}`);
        }
      }
      await conn.end();
    } catch (e) {
      failed++;
      const hint = e.code === "ER_ACCESS_DENIED_ERROR"
        ? "wrong user/password: copy the newest lan/member.env from the DB host (the host may have re-run `lan -- host`)"
        : e.code === "ER_HOST_NOT_PRIVILEGED"
          ? "DB host: run npm run lan -- host (creates the account for other laptops)"
          : undefined;
      bad(`MySQL login failed (${e.code || e.message})`, hint);
    }
  } else info("skipped (no network)");

  console.log("4. Module URLs (a module that is not started yet shows as down)");
  for (const mod of MODULES) {
    const url = env[`ERP_URL_${mod.code.toUpperCase()}`] || `http://localhost:${portOf(mod, env)}`;
    const r = await httpCheck(url);
    if (r.up) ok(`${mod.name.padEnd(16)} ${url} up`);
    else bad(`${mod.name.padEnd(16)} ${url} down (${r.error})`, "start it on its laptop (npm run dev -- --only=" + mod.code + "); that laptop needs the firewall rule for ports 3000-3004");
  }

  console.log(failed ? `\n${failed} problem(s) with the database connection. Fix the first ✗ and run again.\n` : "\nDatabase connection OK. Modules marked down just need to be started.\n");
  process.exit(failed ? 1 : 0);
}

// ---------------------------------------------------------------- reset
function reset() {
  const updates = {};
  for (const mod of MODULES) updates[`ERP_URL_${mod.code.toUpperCase()}`] = "";
  updateEnvFile(updates);
  console.log("ERP_URL_* cleared: every module link uses http://localhost again (one-laptop mode).");
  console.log("The LAN MySQL account stays; run `npm run lan -- host` to go back to LAN mode.");
}

// ---------------------------------------------------------------- import
// Member laptop. Takes the connection sheet the host sent (lan/connect-<module>.txt) or lan/member.env and
// writes its settings where that module reads them:
//   - the repo root .env, used by `npm run dev -- --only=<module>` from the group repo;
//   - the module's own .env, used when the module is started from its own folder (npm start / npm run dev).
// Only the keys in the sheet change; everything else in those files stays as it is.
const SHEET_KEYS = /^(DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD|ERP_URL_[A-Z]+|ERP_API_KEY_[A-Z_]+|ERP_INTERNAL_KEY|PORT|SESSION_SECRET)$/;
function importSheet(file) {
  if (!file) throw new Error('Give the file the host sent, e.g.  npm run lan -- import "C:\\Users\\you\\Downloads\\connect-hr.txt"');
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
  const values = {};
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && SHEET_KEYS.test(m[1])) values[m[1]] = m[2];
  }
  if (!values.DB_HOST) throw new Error("That file has no DB_HOST line. Use the connect-<module>.txt or member.env the host sent.");

  // Which module: from the file name (connect-hr.txt), the database account (djs_hr) or the port.
  const named = path.basename(full).match(/connect-([a-z]+)/i)?.[1]?.toLowerCase();
  const byUser = String(values.DB_USER || "").match(/^djs_([a-z]+)$/)?.[1];
  const mod = MODULES.find((m) => m.code === named) || MODULES.find((m) => m.code === byUser && m.code !== "erp")
    || MODULES.find((m) => m.code !== "erp" && String(m.port) === String(values.PORT));

  // Root .env: the launcher picks each module's database name and port itself, so those two stay out.
  const rootValues = Object.fromEntries(Object.entries(values).filter(([k]) => k !== "PORT" && k !== "DB_NAME"));
  updateEnvFile(rootValues);
  ok(`root .env updated (${Object.keys(rootValues).length} settings: database host ${values.DB_HOST}, module links, keys)`);

  if (mod) {
    const modEnv = path.join(moduleDir(mod), ".env");
    const lines = fs.existsSync(modEnv) ? fs.readFileSync(modEnv, "utf8").split(/\r?\n/) : [];
    const pending = { ...values };
    const next = lines.map((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m && m[1] in pending) { const v = pending[m[1]]; delete pending[m[1]]; return `${m[1]}=${v}`; }
      return line;
    });
    for (const [k, v] of Object.entries(pending)) next.push(`${k}=${v}`);
    fs.writeFileSync(modEnv, next.join("\n").replace(/\n*$/, "\n"));
    ok(`${mod.name} .env updated (${path.relative(ROOT, modEnv)})`);
    info(`Next: npm run lan -- check   then   npm run dev -- --only=${mod.code}`);
  } else {
    info("Next: npm run lan -- check   then   npm run dev -- --only=<your module: pos, hr, scm or crm>");
  }
  info("Restart your system if it is already running: settings are read when it starts.");
}

const opts = args();
const cmd = opts._[0];
try {
  if (cmd === "host") await host(opts);
  else if (cmd === "check") await check();
  else if (cmd === "reset") reset();
  else if (cmd === "import") importSheet(opts._[1]);
  else {
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\nimport ")[0].replace(/^\/\/ ?/gm, ""));
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`\n\x1b[31m✗ ${e.message}\x1b[0m\n`);
  process.exit(1);
}
