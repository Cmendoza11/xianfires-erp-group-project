import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { logAudit } from "../services/auditService.js";
import { today } from "../services/dateUtils.js";
import { getAccountingSettings } from "../services/settingService.js";
import { cashAccountOptions, getPayrollOverview, getPayrollReport, getPayslip, releasePayroll } from "../services/payrollService.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

// HR's payroll as Accounting sees it: HR approves it, Accounting releases the salary here.
export const payrollPage = async (req, res) => {
  res.render("payroll", {
    title: "Payroll",
    activeMenu: "payroll",
    urls,
    overview: await getPayrollOverview(),
    cashAccounts: await cashAccountOptions(),
    defaultDate: today(),
    hrPayrollUrl: `${(process.env.ERP_URL_HR || "http://localhost:3002").replace(/\/+$/, "")}/payroll`
  });
};

export const releasePayrollApi = async (req, res) => {
  try {
    const result = await releasePayroll(req.params.id, req.body, req.adminUser?.admin_user_id);
    if (!result.duplicate) {
      await logAudit(req, {
        action: "payroll.release",
        entityType: "journal_entry",
        entityId: result.entry.uuid,
        summary: `Released salary ${Number(result.netPay).toFixed(2)} to ${result.who} as ${result.entry.entryNumber}`,
        details: { payrollId: Number(req.params.id), entryDate: result.entry.entryDate, hrUpdated: result.hrUpdated }
      });
    }
    res.json({
      data: {
        entryNumber: result.entry.entryNumber,
        entryUuid: result.entry.uuid,
        hrUpdated: result.hrUpdated,
        hrError: result.hrError
      }
    });
  } catch (e) {
    sendError(res, e);
  }
};

// Printable payroll summary for one pay period (paid payslips only).
export const payrollReportPage = async (req, res) => {
  res.render("reportPayroll", {
    title: "Payroll Summary",
    activeMenu: "payrollReport",
    urls,
    company: await companyHeader(),
    report: await getPayrollReport(typeof req.query.period === "string" ? req.query.period : "")
  });
};

// One employee's payslip as Accounting released it (printable).
export const payrollPayslipPage = async (req, res, next) => {
  let payslip;
  try {
    payslip = await getPayslip(req.params.id);
  } catch (e) {
    if (!(e instanceof AccountingValidationError)) throw e;
    return res.status(503).render("error", { title: "HR unavailable", heading: "HR cannot be reached", message: e.message, retry: true, urls });
  }
  if (!payslip) return next();
  res.render("payrollPayslip", { title: `Payslip #${payslip.id}`, activeMenu: "payroll", urls, payslip, company: await companyHeader() });
};

async function companyHeader() {
  const s = await getAccountingSettings();
  return { name: s.companyName, tin: s.companyTin, address: s.companyAddress, currency: s.currency };
}
