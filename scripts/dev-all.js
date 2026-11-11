// npm run dev [-- --only=pos,hr]: starts every module on its own port with one shared environment.
import { spawn } from "node:child_process";
import { MODULES, moduleDir, moduleEnv, portOf } from "./erp-env.js";

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
for (const mod of selected) console.log(`  ${mod.name.padEnd(16)} http://localhost:${portOf(mod, moduleEnv())}`);
console.log("Press Ctrl+C to stop all.\n");

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
