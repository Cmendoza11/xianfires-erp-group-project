/*
  Posts paid payroll to the Accounting ERP (/api/v1/journal-entries) as one journal entry:
    Dr 6000 Salaries and Wages Expense        basic + allowances + overtime
        Cr 2400 SSS/PhilHealth/Pag-IBIG Payable   deductions
        Cr 1010 Cash in Bank                      net pay
  external_id HR-PAY-<payroll id> makes retries safe: Accounting never books the same payslip twice.
  Once posted, a payroll stays Paid (HR blocks changing or deleting it); corrections are made in Accounting.
*/
import { Op } from "sequelize";
import { Payroll, Employee } from "../models/index.js";
import { ErpApiError, accounting } from "./erpClient.js";

// Default chart-of-accounts codes of the Accounting ERP; override in the root .env if they differ.
const ACCOUNT = {
  salaries: process.env.ERP_ACCOUNT_SALARIES || "6000",
  deductions: process.env.ERP_ACCOUNT_PAYROLL_DEDUCTIONS || "2400",
  bank: process.env.ERP_ACCOUNT_PAYROLL_CASH || "1010"
};
const MAX_ATTEMPTS = 10;
const SWEEP_INTERVAL_MS = 60_000;

const cents = (value) => Math.round(Number(value ?? 0) * 100);
const pesos = (c) => Number((c / 100).toFixed(2));
const pad = (n) => String(n).padStart(2, "0");
const localDate = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const backoffMs = (attempts) => Math.min(30_000 * 2 ** (attempts - 1), 15 * 60_000);

/** True when the payroll is (or is being) booked in Accounting, so Paid must stay final. */
export const isLockedByAccounting = (payroll) => ["Pending", "Synced"].includes(payroll.accountingSyncStatus);

function payrollLines(payroll) {
  const gross = cents(payroll.basicSalary) + cents(payroll.allowances) + cents(payroll.overtime);
  const deductions = cents(payroll.deductions);
  const net = cents(payroll.netSalary);
  if (net < 0) throw new ErpApiError("Net pay is negative; fix the payroll amounts before posting", 400);
  if (gross !== net + deductions) {
    throw new ErpApiError(`Payroll does not add up (gross ${pesos(gross)} vs net ${pesos(net)} + deductions ${pesos(deductions)})`, 400);
  }
  const lines = [{ account: ACCOUNT.salaries, debit: pesos(gross), description: "Gross pay (basic, allowances, overtime)" }];
  if (deductions) lines.push({ account: ACCOUNT.deductions, credit: pesos(deductions), description: "Payroll deductions" });
  if (net) lines.push({ account: ACCOUNT.bank, credit: pesos(net), description: "Net pay released" });
  return lines;
}

const inFlight = new Set();

/** Posts one paid payroll. Never throws: the outcome is stored on the payroll row. */
export async function postPayroll(payrollId) {
  if (inFlight.has(payrollId)) return null;
  inFlight.add(payrollId);
  const payroll = await Payroll.findByPk(payrollId, { include: [{ model: Employee, as: "employee" }] });
  try {
    if (!payroll || payroll.status !== "Paid" || payroll.accountingSyncStatus === "Synced") return payroll;
    const employee = payroll.employee;
    const who = employee ? `${employee.employeeCode} ${employee.firstName} ${employee.lastName}` : `employee #${payroll.employeeId}`;
    const res = await accounting("POST", "/journal-entries", {
      entry_date: localDate(payroll.paidAt || new Date()),
      reference: `PAY-${payroll.id}`,
      description: `Payroll ${who}, ${payroll.periodStart} to ${payroll.periodEnd}`,
      external_id: `HR-PAY-${payroll.id}`,
      lines: payrollLines(payroll)
    });
    await payroll.update({
      accountingSyncStatus: "Synced",
      accountingEntryNumber: res.data.entryNumber,
      accountingSyncError: null,
      accountingSyncAttempts: payroll.accountingSyncAttempts + 1,
      accountingNextAttemptAt: null
    });
  } catch (error) {
    const attempts = (payroll?.accountingSyncAttempts ?? 0) + 1;
    const retryable = (error instanceof ErpApiError ? error.retryable : true) && attempts < MAX_ATTEMPTS;
    await payroll?.update({
      accountingSyncStatus: retryable ? "Pending" : "Failed",
      accountingSyncError: String(error.message || error).slice(0, 1000),
      accountingSyncAttempts: attempts,
      accountingNextAttemptAt: retryable ? new Date(Date.now() + backoffMs(attempts)) : null
    }).catch((e) => console.error("[accounting-sync] could not save sync result:", e.message));
  } finally {
    inFlight.delete(payrollId);
  }
  return payroll;
}

/** Queues a payroll that just became Paid and posts it without making the admin wait. */
export async function queuePayroll(payroll) {
  if (payroll.status !== "Paid" || payroll.accountingSyncStatus === "Synced") return;
  await payroll.update({ accountingSyncStatus: "Pending", accountingSyncAttempts: 0, accountingNextAttemptAt: null, accountingSyncError: null });
  setImmediate(() => postPayroll(payroll.id));
}

export async function sweep() {
  const due = await Payroll.findAll({
    where: {
      status: "Paid",
      accountingSyncStatus: "Pending",
      [Op.or]: [{ accountingNextAttemptAt: null }, { accountingNextAttemptAt: { [Op.lte]: new Date() } }]
    },
    order: [["id", "ASC"]],
    limit: 25
  });
  for (const payroll of due) await postPayroll(payroll.id);
}

export function startAccountingSync() {
  const run = () => sweep().catch((e) => console.error("[accounting-sync]", e.message));
  setTimeout(run, 5_000).unref();
  setInterval(run, SWEEP_INTERVAL_MS).unref();
}
