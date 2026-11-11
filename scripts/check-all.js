// npm run check: `node --check` on every JavaScript file of every module. Prints only failures.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MODULES, ROOT, moduleDir } from "./erp-env.js";

// route-cache.js is the XianFire scaffold's code generator; it is broken upstream and never loaded at runtime.
const SKIP = new Set(["node_modules", ".git", ".claude", "docs", "route-cache.js"]);

function jsFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsFiles(full));
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

const targets = [{ code: "root", dir: path.join(ROOT, "scripts") }, ...MODULES.map((m) => ({ code: m.code, dir: moduleDir(m) }))];
let checked = 0;
let failed = 0;

for (const target of targets) {
  for (const file of jsFiles(target.dir)) {
    checked += 1;
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      failed += 1;
      console.log(`FAIL [${target.code}] ${path.relative(ROOT, file)}\n${result.stderr.trim()}\n`);
    }
  }
}

console.log(`${checked} files checked, ${failed} failed`);
process.exit(failed ? 1 : 0);
