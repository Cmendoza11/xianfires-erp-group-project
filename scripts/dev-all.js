// npm run dev [-- --only=pos,hr]: starts every module on its own port with one shared environment.
import os from "node:os";
import { spawn } from "node:child_process";
import { MODULES, moduleDir, moduleEnv, portOf, dbNameOf } from "./erp-env.js";

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7).split(",").map((s) => s.trim()) : null;
const selected = MODULES.filter((m) => !only || only.includes(m.code));
const children = [];
let stopping = false;

function pipe(stream, mod, write) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) write(`\x1b[${mod.color}m[${mod.code}]\x1b[0m ${line}\n`);
  });
}

for (const mod of selected) {
  const env = moduleEnv(mod);
  const child = spawn(process.execPath, ["index.js"], { cwd: moduleDir(mod), env });
  pipe(child.stdout, mod, (s) => process.stdout.write(s));
  pipe(child.stderr, mod, (s) => process.stderr.write(s));
  child.on("exit", (code) => {
    if (!stopping) console.log(`\x1b[${mod.color}m[${mod.code}]\x1b[0m exited with code ${code}`);
  });
  children.push(child);
}

console.log("\nDJ's ERP modules:");
const shared = moduleEnv();
for (const mod of selected) {
  const url = shared[`ERP_URL_${mod.code.toUpperCase()}`] || `http://localhost:${portOf(mod, shared)}`;
  console.log(`  ${mod.name.padEnd(16)} ${url.padEnd(28)} database ${dbNameOf(mod)}${shared.DB_HOST && shared.DB_HOST !== "localhost" ? ` on ${shared.DB_HOST}` : ""}`);
}
// LAN mode: a module started here must be listed at one of this laptop's own addresses, or the other
// modules (and the module switcher) look for it at an old IP, e.g. after moving to the school Wi-Fi.
const ownHosts = new Set(["localhost", "127.0.0.1"]);
for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs || []) ownHosts.add(a.address);
const wrongIp = selected.filter((mod) => {
  const url = shared[`ERP_URL_${mod.code.toUpperCase()}`];
  try {
    return url && !ownHosts.has(new URL(url).hostname);
  } catch {
    return false;
  }
});
if (wrongIp.length) {
  console.log(`\x1b[31m! ${wrongIp.map((m) => m.name).join(", ")}: ERP_URL points to an IP that is not this laptop (did the Wi-Fi change?).\x1b[0m`);
  console.log("  DB host: run  npm run lan -- host  again (or  npm run lan -- reset  for one-laptop mode).");
  console.log("  Member:  ask the DB host for the new lan/member.env.\n");
}
console.log("Press Ctrl+C to stop all.\n");

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
