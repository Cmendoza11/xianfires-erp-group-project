// npm run setup [-- --force]: installs dependencies in every module (skips ones already installed).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MODULES, moduleDir } from "./erp-env.js";

const force = process.argv.includes("--force");
let failed = 0;

for (const mod of MODULES) {
  const dir = moduleDir(mod);
  if (!force && fs.existsSync(path.join(dir, "node_modules"))) {
    console.log(`[${mod.code}] dependencies already installed`);
    continue;
  }
  console.log(`[${mod.code}] npm install in ${mod.dir}`);
  // npm is a .cmd shim on Windows, so it needs a shell.
  const result = spawnSync("npm", ["install"], { cwd: dir, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    failed += 1;
    console.error(`[${mod.code}] npm install failed`);
  }
}

process.exit(failed ? 1 : 0);
