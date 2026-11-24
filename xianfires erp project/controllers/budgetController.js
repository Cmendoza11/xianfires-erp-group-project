import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { logAudit } from "../services/auditService.js";
import { getBudgetVsActual, previousMonth, resolveMonth, saveBudgets as saveRecords } from "../services/budgetService.js";
import { getAccountingSettings } from "../services/settingService.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const budgetReport = async (req, res) => {
  const settings = await getAccountingSettings();
  const month = resolveMonth(req.query.month);
  res.render("reportBudget", {
    title: "Budget vs Actual",
    activeMenu: "budget",
    urls,
    company: { name: settings.companyName, tin: settings.companyTin, address: settings.companyAddress, currency: settings.currency },
    month,
    previousMonth: previousMonth(month),
    report: await getBudgetVsActual(month)
  });
};

export const saveBudgets = async (req, res) => {
  try {
    const result = await saveRecords(req.body);
    await logAudit(req, {
      action: "budget.save",
      entityType: "budget",
      entityId: result.month,
      summary: result.copiedFrom
        ? `Copied the ${result.copiedFrom} budget to ${result.label}`
        : `Saved the ${result.label} budget (${result.saved} account(s))`
    });
    res.json({ data: result });
  } catch (e) {
    sendError(res, e);
  }
};
