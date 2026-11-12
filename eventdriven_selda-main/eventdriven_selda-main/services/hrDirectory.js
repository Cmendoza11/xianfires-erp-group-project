/*
  Departments are owned by HR, which keeps them in its own database. Procurement keeps
  scm_departments as a mirror with the SAME ids, so purchase requests and orders keep their
  foreign keys, status filters and history. The mirror is refreshed from HR's API
  (GET /api/v1/departments, shared X-ERP-Key) when department, request or order pages are opened
  and by the background worker. When HR is offline the current mirror is simply kept.
*/
import { Op } from "sequelize";
import { sequelize, Department } from "../models/index.js";
import { peer } from "./erpClient.js";

const REFRESH_EVERY_MS = 30_000;
let lastRefresh = 0;

const codeFor = (row) => String(row.code || `DEPT-${row.id}`).trim().toUpperCase().slice(0, 20);

/** Procurement runs as part of DJ's ERP (and not on its own) when the shared key is configured. */
export const connectedToHr = () => Boolean(process.env.ERP_INTERNAL_KEY);

/**
 * Copies HR's departments into scm_departments. Returns how many were mirrored, or null when HR
 * is not connected or not reachable right now (the mirror is left as it is).
 */
export async function syncDepartmentsFromHr() {
  lastRefresh = Date.now();
  if (!connectedToHr()) return null;
  let rows;
  try {
    rows = (await peer("HR", 3002, "GET", "/api/v1/departments"))?.departments;
  } catch (error) {
    console.warn(`[hr-directory] HR not reachable, keeping the current departments: ${error.message}`);
    return null;
  }
  if (!Array.isArray(rows)) return null;
  rows = rows.map((r) => ({ ...r, id: Number(r.id), head: r.head || null }));
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
