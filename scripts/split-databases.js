// One-time upgrade, run by `npm run migrate` (or on its own: node scripts/split-databases.js).
// DJ's ERP used to keep all 5 modules in the Accounting database (tables prefixed hr_, pos_, scm_, crm_).
// Now each module has its own database. This moves every module's tables out of the Accounting database
// into that module's database with one RENAME TABLE per module: rows, indexes, auto-increment counters
// and the module's own foreign keys move together. Modules that were already moved are skipped.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES, moduleDir, moduleEnv, dbNameOf } from "./erp-env.js";

const requireFromErp = createRequire(path.join(moduleDir(MODULES[0]), "package.json"));
const mysql = requireFromErp("mysql2/promise");

const PREFIX = { hr: "hr_", pos: "pos_", scm: "scm_", crm: "crm_" };
const q = (id) => `\`${String(id).replace(/`/g, "``")}\``;

export async function splitDatabases({ log = console.log } = {}) {
  const env = moduleEnv();
  const erp = MODULES.find((m) => m.code === "erp");
  const central = dbNameOf(erp, env);
  const connection = await mysql.createConnection({
    host: env.DB_HOST || "localhost",
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || "root",
    password: env.DB_PASSWORD ?? env.DB_PASS ?? "",
  });
  const moved = [];
  try {
    const [[schema]] = await connection.query(
      "SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS co FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      [central]
    );
    if (!schema) return moved; // fresh install: nothing to move

    for (const mod of MODULES.filter((m) => PREFIX[m.code])) {
      const target = dbNameOf(mod, env);
      const [rows] = await connection.query(
        `SELECT TABLE_NAME AS t FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE ?`,
        [central, `${PREFIX[mod.code].replace("_", "\\_")}%`]
      );
      const tables = rows.map((r) => r.t);
      if (!tables.length) continue;

      await connection.query(`CREATE DATABASE IF NOT EXISTS ${q(target)} CHARACTER SET ${schema.cs} COLLATE ${schema.co}`);
      const [existing] = await connection.query(
        "SELECT TABLE_NAME AS t, TABLE_ROWS AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
        [target]
      );
      const clashes = existing.filter((e) => tables.includes(e.t));
      for (const clash of clashes) {
        // A table the module created on its own before this upgrade: drop it only when it is empty.
        const [[{ n }]] = await connection.query(`SELECT COUNT(*) AS n FROM ${q(target)}.${q(clash.t)}`);
        if (n > 0) {
          throw new Error(`${mod.name}: both ${central} and ${target} have rows in ${clash.t}. Move the data by hand, then run npm run migrate again.`);
        }
      }
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const clash of clashes) await connection.query(`DROP TABLE ${q(target)}.${q(clash.t)}`);
      await connection.query(
        `RENAME TABLE ${tables.map((t) => `${q(central)}.${q(t)} TO ${q(target)}.${q(t)}`).join(", ")}`
      );
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      log(`  moved ${tables.length} ${mod.name} table(s): ${central} -> ${target}`);
      moved.push({ module: mod.code, from: central, to: target, tables: tables.length });
    }
  } finally {
    await connection.end();
  }
  return moved;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  splitDatabases()
    .then((moved) => console.log(moved.length ? "Done." : "Nothing to move: every module already has its own database."))
    .catch((error) => {
      console.error(`❌ ${error.message}`);
      process.exitCode = 1;
    });
}
