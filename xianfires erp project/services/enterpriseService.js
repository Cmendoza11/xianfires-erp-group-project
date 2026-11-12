import { QueryTypes } from "sequelize";
import { sequelize } from "../models/index.js";

// Live figures from the other DJ's ERP modules. Every module keeps its own database, so Accounting
// asks each one through its API with the shared X-ERP-Key (ERP_INTERNAL_KEY from the root .env).
// A module that is not running is reported as not reachable instead of failing the page.

const TIMEOUT_MS = 4000;
const SOURCES = {
  pos: { name: "POS & Inventory", url: "ERP_URL_POS", port: 3001, path: "/api/v1/erp/summary" },
  hr: { name: "HR", url: "ERP_URL_HR", port: 3002, path: "/api/v1/erp/summary" },
  scm: { name: "Procurement", url: "ERP_URL_SCM", port: 3003, path: "/api/v1/erp/summary" },
  crm: { name: "Customer Logs", url: "ERP_URL_CRM", port: 3004, path: "/api/erp/summary" }
};

/** One module's summary: { data } when it answered, { error } (a sentence for the page) when not. */
async function ask(code) {
  const source = SOURCES[code];
  const key = process.env.ERP_INTERNAL_KEY;
  if (!key) return { data: null, error: `${source.name} is not connected: run npm run migrate at the DJ's ERP root.` };
  const base = (process.env[source.url] || `http://localhost:${source.port}`).replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}${source.path}`, {
      headers: { Accept: "application/json", "X-ERP-Key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: `${source.name} answered ${res.status}: ${body?.error?.message || res.statusText}.` };
    return { data: body, error: null };
  } catch (error) {
    const reason = error.name === "TimeoutError" ? "no answer in time" : error.cause?.code || error.message;
    return { data: null, error: `${source.name} is not reachable at ${base} (${reason}). Start it with npm run dev.` };
  }
}

// What each connected module has posted into Accounting through /api/v1 (Accounting's own tables).
async function postingsBySystem() {
  return sequelize.query(
    `SELECT c.system_code AS systemCode, c.name, r.entity_type AS entityType, COUNT(*) AS n, MAX(r.created_at) AS lastAt
     FROM integration_reference r JOIN api_client c ON c.api_client_id = r.api_client_id
     WHERE r.entity_uuid IS NOT NULL
     GROUP BY c.system_code, c.name, r.entity_type
     ORDER BY c.name, r.entity_type`,
    { type: QueryTypes.SELECT }
  );
}

export async function getEnterpriseOverview() {
  const [pos, hr, scm, crm, postings] = await Promise.all([ask("pos"), ask("hr"), ask("scm"), ask("crm"), postingsBySystem()]);
  const syncs = [
    pos.data?.accountingSync && { module: "POS → Accounting", ...pos.data.accountingSync },
    pos.data?.customerSync && { module: "POS → Customer Logs", ...pos.data.customerSync },
    hr.data?.accountingSync && { module: "HR payroll → Accounting", ...hr.data.accountingSync },
    scm.data?.accountingSync && { module: "Procurement bills → Accounting", ...scm.data.accountingSync },
    scm.data?.refundSync && { module: "Procurement refunds → Accounting", ...scm.data.refundSync },
    scm.data?.stockSync && { module: "Procurement receipts → POS stock", ...scm.data.stockSync },
    scm.data?.returnStockSync && { module: "Procurement returns → POS stock", ...scm.data.returnStockSync }
  ].filter(Boolean);
  return {
    pos: pos.data,
    hr: hr.data,
    scm: scm.data,
    crm: crm.data,
    errors: { pos: pos.error, hr: hr.error, scm: scm.error, crm: crm.error },
    postings,
    syncs,
    attention: syncs.reduce((sum, s) => sum + s.pending + s.failed, 0)
  };
}
