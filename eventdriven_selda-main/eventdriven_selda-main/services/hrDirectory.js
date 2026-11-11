/*
  Departments are owned by HR (hr_departments). Procurement keeps scm_departments as a mirror
  with the SAME ids, so purchase requests and orders keep their foreign keys, status filters and
  history. The mirror is refreshed from HR at start-up, by `npm run migrate` and when department,
  request or order pages are opened. HR's table is only read (raw SELECT, never a model), so a
  Procurement sync can never change HR data.
*/
import { Op, QueryTypes } from "sequelize";
import { sequelize, Department } from "../models/index.js";

const REFRESH_EVERY_MS = 30_000;
let lastRefresh = 0;

const codeFor = (row) => String(row.code || `DEPT-${row.id}`).trim().toUpperCase().slice(0, 20);

async function hrInstalled() {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('hr_departments', 'hr_employees')`,
    { type: QueryTypes.SELECT }
  );
  return Number(row.n) === 2;
}

/** Copies HR's departments into scm_departments. Returns how many were mirrored, or null without HR. */
export async function syncDepartmentsFromHr() {
  lastRefresh = Date.now();
  if (!(await hrInstalled())) return null;
  const rows = await sequelize.query(
    `SELECT d.id, d.name, d.code, d.description,
            NULLIF(TRIM(CONCAT(COALESCE(e.firstName, ''), ' ', COALESCE(e.lastName, ''))), '') AS head
     FROM hr_departments d LEFT JOIN hr_employees e ON e.id = d.headId
     ORDER BY d.id`,
    { type: QueryTypes.SELECT }
  );
  const hrIds = rows.map((r) => r.id);
  const hrCodes = new Set(rows.map(codeFor));

  await sequelize.transaction(async (transaction) => {
    const existing = await Department.findAll({ paranoid: false, transaction });
    // Old Procurement-only departments keep their history but give up a code HR now uses.
    for (const dept of existing) {
      if (!hrIds.includes(dept.id) && hrCodes.has(dept.code)) {
        await dept.update({ code: `${dept.code}-${dept.id}`.slice(0, 20), status: "Inactive" }, { transaction });
      }
    }
    // Two steps so codes can move between rows without tripping the unique index.
    await Department.update(
      { code: sequelize.fn("CONCAT", "~", sequelize.col("id")) },
      { where: { id: { [Op.in]: hrIds.length ? hrIds : [0] } }, paranoid: false, transaction }
    );
    for (const row of rows) {
      const data = { code: codeFor(row), name: row.name, departmentHead: row.head, description: row.description, status: "Active" };
      const dept = existing.find((d) => d.id === row.id);
      if (dept) {
        if (dept.deletedAt) await dept.restore({ transaction });
        // A static update writes every field. dept.update() would skip the code, because the
        // instance still holds the code from before the temporary "~id" rename above.
        await Department.update(data, { where: { id: row.id }, transaction });
      } else {
        await Department.create({ id: row.id, ...data }, { transaction });
      }
    }
    // Removed in HR: kept for history, but no longer offered for new requests.
    await Department.update(
      { status: "Inactive" },
      { where: { id: { [Op.notIn]: hrIds.length ? hrIds : [0] } }, transaction }
    );
  });
  return rows.length;
}

/** Express middleware: refreshes the mirror at most every 30 s before department-related pages. */
export function refreshDepartmentsFromHr(req, res, next) {
  if (req.method !== "GET" || Date.now() - lastRefresh < REFRESH_EVERY_MS) return next();
  syncDepartmentsFromHr()
    .catch((error) => console.error("[hr-directory] department sync failed:", error.message))
    .finally(() => next());
}

export const hrDepartmentsUrl = () => `${(process.env.ERP_URL_HR || "http://localhost:3002").replace(/\/+$/, "")}/departments`;
