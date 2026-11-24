// DJ's ERP connection monitor for the host laptop (double-click DJs-ERP-Monitor.bat).
// For each teammate's module it shows, every few seconds:
//   1. Running      : its port answers on the address in ERP_URL_<CODE>
//   2. Settings     : it accepts the shared ERP_INTERNAL_KEY (so it has the host's .env)
//   3. Host database: while it answers, a connection from its laptop appears on THIS MySQL
//   4. Last call    : when it last called the Accounting API (POS, HR, Procurement)
// Usage: node scripts/lan-monitor.js [--once] [--every=15]
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { MODULES, moduleDir, readEnvFile, dbNameOf } from "./erp-env.js";

const argv = process.argv.slice(2);
const ONCE = argv.includes("--once");
const EVERY = Math.max(5, Number((argv.find((a) => a.startsWith("--every=")) || "").split("=")[1]) || 15);
const SUMMARY_PATH = { hr: "/api/v1/erp/summary", pos: "/api/v1/erp/summary", scm: "/api/v1/erp/summary", crm: "/api/erp/summary" };

const req = createRequire(path.join(moduleDir(MODULES[0]), "package.json"));
const mysql = req("mysql2/promise");

const C = { green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", bold: "\x1b[1m", off: "\x1b[0m" };
const paint = (color, text) => `${C[color]}${text}${C.off}`;
const pad = (text, width) => {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  return text + " ".repeat(Math.max(0, width - visible.length));
};

function portOpen(host, port, ms = 2500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(ms, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function fetchJson(url, headers, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, error: e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message) };
  } finally {
    clearTimeout(timer);
  }
}

function since(date) {
  if (!date) return "never";
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

async function checkOnce(env, db) {
  const erpUrl = (env.ERP_URL_ERP || "http://localhost:3000").replace(/\/+$/, "");
  const health = await fetchJson(`${erpUrl}/api/v1/health`, {}, 4000);
  const mods = MODULES.filter((m) => m.code !== "erp").map((m) => {
    const url = env[`ERP_URL_${m.code.toUpperCase()}`];
    let host = null, port = m.port;
    try { const u = new URL(url); host = u.hostname; port = Number(u.port) || m.port; } catch { /* not set */ }
    return { ...m, url, host, port };
  });

  // Watch this MySQL while the modules answer, so short-lived pool connections are caught too.
  const seen = new Map();
  let watching = true;
  const watch = (async () => {
    while (watching) {
      try {
        const [rows] = await db.query("SELECT user, SUBSTRING_INDEX(host, ':', 1) ip, db FROM information_schema.processlist WHERE user LIKE 'djs%'");
        for (const r of rows) seen.set(r.ip, `${r.user} -> ${r.db ?? "?"}`);
      } catch { /* keep watching */ }
      await new Promise((r) => setTimeout(r, 120));
    }
  })();

  const results = await Promise.all(mods.map(async (m) => {
    if (!m.host) return { m, configured: false };
    const running = await portOpen(m.host, m.port);
    const summary = running ? await fetchJson(`${m.url.replace(/\/+$/, "")}${SUMMARY_PATH[m.code]}`, { "X-ERP-Key": env.ERP_INTERNAL_KEY || "" }) : null;
    return { m, configured: true, running, summary };
  }));
  await new Promise((r) => setTimeout(r, 1200));
  watching = false;
  await watch;

  let lastCalls = {};
  try {
    const [rows] = await db.query(`SELECT system_code, last_used_at FROM \`${dbNameOf(MODULES[0], env)}\`.api_client`);
    lastCalls = Object.fromEntries(rows.map((r) => [r.system_code, r.last_used_at]));
  } catch { /* table missing on an empty database */ }

  return { erpUrl, health, results, seen, lastCalls };
}

function render({ erpUrl, health, results, seen, lastCalls }) {
  const lines = [];
  lines.push(paint("cyan", `${C.bold}DJ's ERP - connection monitor${C.off}`) + paint("dim", `   ${new Date().toLocaleTimeString()}`));
  const hostOk = health.status === 200 && health.body?.data?.database === "online";
  lines.push(`Host (Accounting)  ${erpUrl}   ` + (hostOk ? paint("green", "OK  running, database online") : paint("red", `PROBLEM  ${health.error || "HTTP " + health.status + " " + JSON.stringify(health.body?.data ?? "")}`)));
  lines.push("");
  lines.push(paint("bold", pad("Module", 17) + pad("Address", 27) + pad("1 Running", 12) + pad("2 Settings", 14) + pad("3 Host DB", 12) + pad("4 Last call", 14) + "Status"));

  let connected = 0;
  for (const { m, configured, running, summary } of results) {
    if (!configured) {
      lines.push(pad(m.name, 17) + pad(paint("dim", "(no IP set)"), 27) + paint("yellow", "Host runs: npm run lan -- host --erp-only --" + m.code + "=<ip>"));
      continue;
    }
    const keyOk = summary?.status === 200;
    const keyBad = summary?.status === 401 || summary?.status === 503;
    const dbOk = seen.has(m.host);
    const call = m.code === "crm" ? "n/a" : since(lastCalls[m.code]);
    const c1 = running ? paint("green", "yes") : paint("red", "no");
    const c2 = !running ? paint("dim", "-") : keyOk ? paint("green", "ok") : keyBad ? paint("red", "OLD .env") : paint("yellow", summary?.error || `HTTP ${summary?.status}`);
    const c3 = !running ? paint("dim", "-") : dbOk ? paint("green", "yes") : paint("red", "no");
    let status;
    if (running && keyOk && dbOk) { status = paint("green", "CONNECTED"); connected++; }
    else if (!running) status = paint("red", "NOT RUNNING / unreachable (same Wi-Fi? IP changed? app started? firewall rule?)");
    else if (keyBad) status = paint("yellow", "running on OLD settings: copy the new .env, then restart the app");
    else if (!dbOk) status = paint("yellow", "running, but not using the host database: check DB_HOST in .env, restart");
    else status = paint("yellow", "check its terminal for errors");
    lines.push(pad(m.name, 17) + pad(`${m.host}:${m.port}`, 27) + pad(c1, 12) + pad(c2, 14) + pad(c3, 12) + pad(call, 14) + status);
  }
  lines.push("");
  const total = results.filter((r) => r.configured).length;
  lines.push(connected === total && total > 0
    ? paint("green", `${C.bold}All ${total} modules are connected.${C.off}`)
    : paint("yellow", `${connected} of ${total} connected.`));
  const others = [...seen.entries()].filter(([ip]) => !results.some((r) => r.m.host === ip));
  if (others.length) lines.push(paint("dim", "Other laptops on this database: " + others.map(([ip, v]) => `${ip} (${v})`).join(", ") + "  <- an IP changed? Update it with npm run lan -- host"));
  lines.push(paint("dim", ONCE ? "" : `Refreshing every ${EVERY} s. Ctrl+C to stop.`));
  return lines.join("\n");
}

const env = { ...readEnvFile(), ...process.env };
// timezone "Z": Accounting (Sequelize) saves times in UTC, so read them as UTC too.
const db = await mysql.createConnection({ host: "127.0.0.1", port: Number(env.DB_PORT || 3306), user: "root", password: env.DB_PASSWORD || "", timezone: "Z" })
  .catch((e) => {
    console.error(paint("red", `Cannot open this laptop's MySQL (${e.code || e.message}). Start Laragon or run DJs-ERP-Host.bat first.`));
    process.exit(1);
  });

do {
  const out = render(await checkOnce(env, db));
  if (!ONCE) process.stdout.write("\x1b[2J\x1b[H");
  console.log(out);
  if (!ONCE) await new Promise((r) => setTimeout(r, EVERY * 1000));
} while (!ONCE);
await db.end();
