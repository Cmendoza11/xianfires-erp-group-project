import { Op } from "sequelize";
import { ApiClient, IntegrationReference } from "../models/index.js";
import { getJournalEntry } from "./journalService.js";

// Payroll is computed, approved and marked Paid in HR ("Mark as Paid"); HR then posts it here as a
// journal entry with its external id HR-PAY-<payroll id>:
//   Dr 6000 Salaries / Cr 2400 SSS, PhilHealth, Pag-IBIG / Cr 1110 cash advances / Cr 1010 net pay.
// HR keeps payroll in its own database, so this page reads it only through HR's API (X-ERP-Key).

const TIMEOUT_MS = 6000;
const cents = (value) => Math.round(Number(value ?? 0) * 100);
const pesos = (c) => Number((c / 100).toFixed(2));

async function hrPayrolls() {
  const key = process.env.ERP_INTERNAL_KEY;
  if (!key) throw new Error("HR is not connected: run npm run migrate at the DJ's ERP root");
  const base = (process.env.ERP_URL_HR || "http://localhost:3002").replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${base}/api/v1/payrolls?status=Processed,Paid&limit=200`, {
      headers: { Accept: "application/json", "X-ERP-Key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error.name === "TimeoutError" ? "did not answer in time" : `is not reachable (${error.cause?.code || error.message})`;
    throw new Error(`HR at ${base} ${reason}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || `HR answered ${res.status}`);
  return body?.payrolls || [];
}

// The journal entry each paid payroll was posted as: Map(payroll id -> { uuid, number, date }).
async function postedEntries(ids) {
  const client = await ApiClient.findOne({ where: { system_code: "hr" }, raw: true });
  if (!client || !ids.length) return new Map();
  const refs = await IntegrationReference.findAll({
    where: {
      api_client_id: client.api_client_id,
      entity_type: "journal_entry",
      external_id: { [Op.in]: ids.map((id) => `HR-PAY-${id}`) },
      entity_uuid: { [Op.ne]: null }
    },
    raw: true
  });
  const entries = new Map();
  for (const ref of refs) {
    const entry = await getJournalEntry(ref.entity_uuid);
    if (entry) entries.set(Number(String(ref.external_id).replace("HR-PAY-", "")), { uuid: entry.uuid, number: entry.entryNumber, date: entry.entryDate });
  }
  return entries;
}

/** HR payroll for the Payroll page: approved (waiting for HR to mark it Paid) and paid. */
export async function getPayrollOverview() {
  let payrolls = [];
  let hrError = null;
  try {
    payrolls = await hrPayrolls();
  } catch (error) {
    hrError = error.message;
  }
  const entries = await postedEntries(payrolls.filter((p) => p.status === "Paid").map((p) => p.id));
  const rows = payrolls.map((p) => ({
    ...p,
    government: pesos(cents(p.deductions) - cents(p.cashAdvance)),
    entry: entries.get(p.id) || null
  }));
  const approved = rows.filter((p) => p.status === "Processed");
  const paid = rows.filter((p) => p.status === "Paid");
  const sum = (list, field) => pesos(list.reduce((s, p) => s + cents(p[field]), 0));
  return {
    hrError,
    approved,
    paid,
    totals: {
      approved: sum(approved, "netSalary"),
      approvedCount: approved.length,
      paidGross: sum(paid, "gross"),
      paidGovernment: sum(paid, "government"),
      paidNet: sum(paid, "netSalary"),
      paidCount: paid.length,
      waitingToPost: paid.filter((p) => !p.entry).length
    }
  };
}
