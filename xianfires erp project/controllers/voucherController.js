import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { logAudit } from "../services/auditService.js";
import { today } from "../services/dateUtils.js";
import {
  attachReceipt as attachRecord,
  createExpenseVoucher as createRecord,
  getExpenseVoucher,
  getReceiptFile,
  listExpenseVouchers,
  removeReceipt as removeRecord,
  updateExpenseVoucher as updateRecord,
  voidExpenseVoucher as voidRecord,
  voucherAccountOptions
} from "../services/voucherService.js";
import { getAccountingSettings } from "../services/settingService.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

const peso = (n) => Number(n).toFixed(2);

export const expenseVoucherGrid = async (req, res) => {
  const keyword = typeof req.query.q === "string" ? req.query.q : "";
  res.render("expenseVoucherGrid", {
    title: "Expense Vouchers",
    activeMenu: "expenseVouchers",
    urls,
    list: await listExpenseVouchers({ keyword }),
    ...(await voucherAccountOptions()),
    today: today()
  });
};

export const expenseVoucherView = async (req, res, next) => {
  const voucher = await getExpenseVoucher(req.params.id);
  if (!voucher) return next();
  const settings = await getAccountingSettings();
  res.render("expenseVoucherView", {
    title: `Expense Voucher ${voucher.number}`,
    activeMenu: "expenseVouchers",
    urls,
    voucher,
    company: { name: settings.companyName, address: settings.companyAddress, tin: settings.companyTin }
  });
};

export const createExpenseVoucher = async (req, res) => {
  try {
    const voucher = await createRecord(req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "voucher.create",
      entityType: "expense_voucher",
      entityId: voucher.uuid,
      summary: `Issued expense voucher ${voucher.number} to ${voucher.payee} (${peso(voucher.amount)})${voucher.receipt ? " with receipt" : ""}`
    });
    res.json({ data: voucher });
  } catch (e) {
    if (e instanceof AccountingValidationError && req.body?.receipt_data) {
      await logAudit(req, { action: "voucher.receipt_rejected", entityType: "expense_voucher", summary: `Voucher not saved: ${e.message}` });
    }
    sendError(res, e);
  }
};

export const voidExpenseVoucher = async (req, res) => {
  try {
    const voucher = await voidRecord(req.params.id, req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "voucher.void",
      entityType: "expense_voucher",
      entityId: voucher.uuid,
      summary: `Voided expense voucher ${voucher.number} to ${voucher.payee} (${peso(voucher.amount)})`,
      details: { reason: req.body?.reason }
    });
    res.json({ data: voucher });
  } catch (e) {
    sendError(res, e);
  }
};

export const updateExpenseVoucher = async (req, res) => {
  try {
    const result = await updateRecord(req.params.id, req.body);
    await logAudit(req, {
      action: "voucher.update",
      entityType: "expense_voucher",
      entityId: result.uuid,
      summary: `Edited expense voucher ${result.number}`,
      details: { before: result.before, after: result.after }
    });
    res.json({ data: result });
  } catch (e) {
    sendError(res, e);
  }
};

export const attachReceipt = async (req, res) => {
  try {
    const result = await attachRecord(req.params.id, req.body);
    await logAudit(req, {
      action: "voucher.receipt",
      entityType: "expense_voucher",
      entityId: req.params.id,
      summary: `Attached receipt ${result.name} (${Math.ceil(result.size / 1024)} KB) to ${result.number}`
    });
    res.json({ data: result });
  } catch (e) {
    if (e instanceof AccountingValidationError) {
      // Rejected uploads are kept in the audit log: they may be attack attempts.
      await logAudit(req, {
        action: "voucher.receipt_rejected",
        entityType: "expense_voucher",
        entityId: req.params.id,
        summary: `Rejected upload "${String(req.body?.receipt_name ?? "").slice(0, 120)}": ${e.message}`
      });
    }
    sendError(res, e);
  }
};

export const removeReceipt = async (req, res) => {
  try {
    const result = await removeRecord(req.params.id);
    await logAudit(req, { action: "voucher.receipt_remove", entityType: "expense_voucher", entityId: req.params.id, summary: `Removed the receipt of ${result.number}` });
    res.json({ data: result });
  } catch (e) {
    sendError(res, e);
  }
};

// Sends a stored receipt with a fixed type; the browser is told never to guess or run it.
export const downloadReceipt = async (req, res, next) => {
  const file = await getReceiptFile(req.params.id);
  if (!file) return next();
  res.setHeader("Content-Type", file.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  const safeName = String(file.name).replace(/[^A-Za-z0-9._-]/g, "_");
  if (file.mime.startsWith("image/")) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  } else {
    // PDFs are downloaded, not opened inside the app.
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(file.path, (err) => err && next(err));
};
