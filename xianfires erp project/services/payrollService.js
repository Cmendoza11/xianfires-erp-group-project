import { Op } from "sequelize";
import { sequelize, Account, ApiClient, IntegrationReference } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "./accountTypes.js";
import { parseDate } from "./dateUtils.js";
import { createOnce } from "./integrationService.js";
import { getJournalEntry, postEntry } from "./journalService.js";
import { assertSafeText } from "./securityService.js";

// Payroll flow: HR computes payroll from attendance and approves it (status Processed). Accounting
// releases the salary here ("Release salary"), which posts one journal entry with the external id
// HR-PAY-<payroll id> under HR's API client:
//   Dr 6000 Salaries / Cr 2400 SSS, PhilHealth, Pag-IBIG / Cr 1110 cash advances / Cr cash or bank (net pay)
// and then tells HR to mark the payroll Paid (POST /api/v1/payrolls/:id/pay). HR keeps payroll in its
// own database, so it is read and updated only through HR's API (X-ERP-Key).

const TIMEOUT_MS = 6000;
const PAYROLL_ACCOUNTS = { salaries: "6000", government: "2400", advances: "1110", tax: "2300" };
const cents = (value) => Math.round(Number(value ?? 0) * 100);
const pesos = (c) => Number((c / 100).toFixed(2));

const hrBase = () => (process.env.ERP_URL_HR || "http://localhost:3002").replace(/\/+$/, "");

async function hrRequest(method, path, body) {
  const key = process.env.ERP_INTERNAL_KEY;
  if (!key) throw new Error("HR is not connected: run npm run migrate at the DJ's ERP root");
  const base = hrBase();
  let res;
  try {
    res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { Accept: "application/json", "X-ERP-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error.name === "TimeoutError" ? "did not answer in time" : `is not reachable (${error.cause?.code || error.message})`;
    throw new Error(`HR at ${base} ${reason}`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HR answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const hrPayrolls = async () => (await hrRequest("GET", "/payrolls?status=Processed,Paid&limit=200"))?.payrolls || [];

async function hrClient() {
  const client = await ApiClient.findOne({ where: { system_code: "hr" }, raw: true });
  return client ? { apiClientId: client.api_client_id, name: client.name } : null;
}

// The journal entry each payroll was posted as: Map(payroll id -> { uuid, number, date }).
async function postedEntries(ids) {
  const client = await hrClient();
  if (!client || !ids.length) return new Map();
  const refs = await IntegrationReference.findAll({
    where: {
      api_client_id: client.apiClientId,
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

export async function cashAccountOptions() {
  const rows = await Account.findAll({ where: { is_cash: true, status: 1 }, order: [["code", "ASC"]], raw: true });
  return rows.map((a) => ({ uuid: a.uuid, label: `${a.code} - ${a.name}` }));
}

/** HR payroll for the Payroll page: approved (ready to release) and paid. */
export async function getPayrollOverview() {
  let payrolls = [];
  let hrError = null;
  try {
    payrolls = await hrPayrolls();
  } catch (error) {
    hrError = error.message;
  }
  const entries = await postedEntries(payrolls.map((p) => p.id));
  const rows = payrolls.map((p) => ({
    ...p,
    government: pesos(splitDeductions(p).government),
    entry: entries.get(p.id) || null,
    releaseApi: urls.releasePayroll(p.id),
    // Shown (read-only) in the Release salary modal. A release whose HR update failed reuses it for "Retry HR update".
    releaseValues: {
      payee: `${p.employee?.name || `Payroll #${p.id}`}, ${p.periodStart} to ${p.periodEnd}`,
      net: Number(p.netSalary || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
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
      waitingToPost: paid.filter((p) => !p.entry).length,
      waitingForHr: approved.filter((p) => p.entry).length
    }
  };
}

// HR's deductions = SSS/PhilHealth/Pag-IBIG + cash advance (+ withholding tax once HR sends withholdingTax).
// Each part goes to its own account; anything not named is treated as government contributions.
function splitDeductions(payroll) {
  const deductions = cents(payroll.deductions);
  const advance = Math.min(cents(payroll.cashAdvance), deductions);
  const tax = Math.min(cents(payroll.withholdingTax), deductions - advance);
  return { deductions, advance, tax, government: deductions - advance - tax };
}

function payrollLines(payroll, accounts, cashAccount) {
  const gross = cents(payroll.gross);
  const { deductions, advance, tax, government } = splitDeductions(payroll);
  const net = cents(payroll.netSalary);
  if (gross <= 0) throw new AccountingValidationError("This payroll has no gross pay to release");
  if (net < 0) throw new AccountingValidationError("Net pay is negative; HR must correct the payroll first");
  if (gross !== net + deductions) {
    throw new AccountingValidationError(`Payroll does not add up in HR (gross ${pesos(gross)} vs net ${pesos(net)} + deductions ${pesos(deductions)}); HR must correct it first`);
  }
  return [
    { accountId: accounts.salaries.accounting_account_id, debitCents: gross, description: "Gross pay (basic, allowances, overtime)" },
    { accountId: accounts.government.accounting_account_id, creditCents: government, description: "SSS, PhilHealth and Pag-IBIG (employee share)" },
    { accountId: accounts.tax.accounting_account_id, creditCents: tax, description: "Withholding tax (BIR)" },
    { accountId: accounts.advances.accounting_account_id, creditCents: advance, description: "Cash advance repaid" },
    { accountId: cashAccount.accounting_account_id, creditCents: net, description: "Net pay released" }
  ];
}

/**
 * Releases an approved HR payroll: posts the salary entry (once per payroll) and marks it Paid in HR.
 * Safe to repeat: when HR could not be updated the first time, a retry reuses the posted entry.
 */
export async function releasePayroll(payrollId, data, adminUserId) {
  const id = Number.parseInt(payrollId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AccountingValidationError("Payroll not found");
  const paymentDate = parseDate(String(data?.payment_date ?? "").trim());
  if (!paymentDate) throw new AccountingValidationError("A valid payment date is required");
  const reference = String(data?.reference ?? "").trim();
  if (reference.length > 60) throw new AccountingValidationError("Reference must be 60 characters or fewer");
  if (reference) assertSafeText(reference, "Reference");

  const cashAccount = await Account.findOne({ where: { uuid: String(data?.cash_account ?? ""), is_cash: true, status: 1 }, raw: true });
  if (!cashAccount) throw new AccountingValidationError("Select the cash or bank account the salary is paid from");
  const accounts = {};
  for (const [key, code] of Object.entries(PAYROLL_ACCOUNTS)) {
    accounts[key] = await Account.findOne({ where: { code, status: 1 }, raw: true });
    if (!accounts[key]) throw new AccountingValidationError(`Account ${code} is missing or inactive in the chart of accounts`);
  }
  const client = await hrClient();
  if (!client) throw new AccountingValidationError("HR is not set up as an ERP integration yet (run npm run migrate at the DJ's ERP root)");

  let payroll;
  try {
    payroll = (await hrRequest("GET", `/payrolls/${id}`))?.payroll;
  } catch (error) {
    throw new AccountingValidationError(error.status === 404 ? "Payroll not found in HR" : `Cannot read the payroll from HR: ${error.message}`);
  }
  if (!payroll) throw new AccountingValidationError("Payroll not found in HR");
  if (payroll.status === "Paid") throw new AccountingValidationError("This payroll is already paid");
  if (payroll.status !== "Processed") throw new AccountingValidationError(`HR has not approved this payroll yet (status ${payroll.status})`);
  const lines = payrollLines(payroll, accounts, cashAccount);
  const who = payroll.employee ? `${payroll.employee.code} ${payroll.employee.name}` : `employee of payroll #${id}`;

  const { duplicate, uuid } = await createOnce(client, "journal_entry", `HR-PAY-${id}`, () =>
    sequelize.transaction((transaction) =>
      postEntry(transaction, {
        entry_date: paymentDate,
        reference: reference ? `PAY-${id} / ${reference}` : `PAY-${id}`,
        description: `Salary release ${who}, ${payroll.periodStart} to ${payroll.periodEnd}`,
        created_by: adminUserId ?? null
      }, lines)
    )
  );
  const entry = await getJournalEntry(uuid);

  // HR's paid date is the entry date (YYYY-MM-DD): today's form value, or the first release on a retry.
  const d = entry.entryDate;
  const paidAt = d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : (parseDate(String(d ?? "").slice(0, 10)) || paymentDate);
  let hrError = null;
  try {
    await hrRequest("POST", `/payrolls/${id}/pay`, { paid_at: paidAt, entry_number: entry.entryNumber });
  } catch (error) {
    hrError = error.message;
  }
  return { entry, payroll, duplicate, hrUpdated: !hrError, hrError, netPay: payroll.netSalary, who };
}

const sumCents = (list, pick) => pesos(list.reduce((s, p) => s + cents(pick(p)), 0));
const governmentOf = (p) => pesos(splitDeductions(p).government);

/** Paid payroll for one pay period (default: the latest), with totals, for the printable summary. */
export async function getPayrollReport(periodKey) {
  let payrolls = [];
  let hrError = null;
  try {
    payrolls = (await hrPayrolls()).filter((p) => p.status === "Paid");
  } catch (error) {
    hrError = error.message;
  }
  const periods = [];
  for (const p of payrolls) {
    const key = `${p.periodStart}_${p.periodEnd}`;
    if (!periods.some((x) => x.key === key)) periods.push({ key, label: `${p.periodStart} to ${p.periodEnd}`, start: p.periodStart, end: p.periodEnd });
  }
  periods.sort((a, b) => String(b.end).localeCompare(String(a.end)) || String(b.start).localeCompare(String(a.start)));
  const selected = periods.find((x) => x.key === periodKey) || periods[0] || null;
  const inPeriod = selected ? payrolls.filter((p) => `${p.periodStart}_${p.periodEnd}` === selected.key) : [];
  const entries = await postedEntries(inPeriod.map((p) => p.id));
  const rows = inPeriod
    .map((p) => ({ ...p, government: governmentOf(p), entry: entries.get(p.id) || null, payslipUrl: urls.payrollPayslip(p.id) }))
    .sort((a, b) => String(a.employee?.name || "").localeCompare(String(b.employee?.name || "")));
  return {
    hrError,
    periods: periods.map((x) => ({ ...x, selected: x.key === selected?.key })),
    period: selected,
    rows,
    totals: {
      count: rows.length,
      basic: sumCents(rows, (p) => p.basicSalary),
      allowances: sumCents(rows, (p) => p.allowances),
      overtime: sumCents(rows, (p) => p.overtime),
      gross: sumCents(rows, (p) => p.gross),
      sss: sumCents(rows, (p) => p.sssDeduction),
      philhealth: sumCents(rows, (p) => p.philhealthDeduction),
      pagibig: sumCents(rows, (p) => p.pagibigDeduction),
      cashAdvance: sumCents(rows, (p) => Math.min(Number(p.cashAdvance || 0), Number(p.deductions || 0))),
      government: sumCents(rows, (p) => p.government),
      net: sumCents(rows, (p) => p.netSalary)
    }
  };
}

/** One payslip from HR, with the journal entry it was paid with. Null when HR does not have it. */
export async function getPayslip(payrollId) {
  const id = Number.parseInt(payrollId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  let payroll;
  try {
    payroll = (await hrRequest("GET", `/payrolls/${id}`))?.payroll;
  } catch (error) {
    if (error.status === 404) return null;
    throw new AccountingValidationError(`Cannot read the payslip from HR: ${error.message}`);
  }
  if (!payroll) return null;
  const entry = (await postedEntries([id])).get(id) || null;
  return { ...payroll, government: governmentOf(payroll), entry };
}
