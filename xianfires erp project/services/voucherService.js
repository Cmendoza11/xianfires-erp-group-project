import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryTypes, Transaction } from "sequelize";
import { sequelize, Account, ExpenseVoucher, JournalEntry } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError, toCents } from "./accountTypes.js";
import { parseDate, today } from "./dateUtils.js";
import { postEntry, postReversal, VOUCHER_PREFIX } from "./journalService.js";
import { assertPeriodOpen } from "./periodService.js";
import { formatEntryNumber, getAccountingSettings } from "./settingService.js";
import { assertSafeText, validateUpload } from "./securityService.js";

// Receipts live outside public/, so a file can never be opened or run directly by URL;
// they are only sent through the logged-in receipt route with a fixed content type.
export const RECEIPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "storage", "receipts");

const VOUCHER_SQL = `
  SELECT v.*, DATE_FORMAT(v.voucher_date, '%Y-%m-%d') AS voucher_day,
    ea.code AS expense_code, ea.name AS expense_name,
    pa.code AS payment_code, pa.name AS payment_name,
    je.uuid AS entry_uuid, ve.uuid AS void_entry_uuid,
    u.full_name AS created_by_name, u.email AS created_by_email
  FROM expense_voucher v
  INNER JOIN accounting_account ea ON ea.accounting_account_id = v.expense_account_id
  INNER JOIN accounting_account pa ON pa.accounting_account_id = v.payment_account_id
  LEFT JOIN accounting_journal_entry je ON je.accounting_journal_entry_id = v.journal_entry_id
  LEFT JOIN accounting_journal_entry ve ON ve.accounting_journal_entry_id = v.void_entry_id
  LEFT JOIN admin_user u ON u.admin_user_id = v.created_by
`;

const voucherNumber = (id) => formatEntryNumber(id, VOUCHER_PREFIX);

function toVoucher(row, entryPrefix) {
  return {
    uuid: row.uuid,
    number: voucherNumber(row.expense_voucher_id),
    voucherDate: row.voucher_day,
    payee: row.payee,
    description: row.description,
    expenseAccount: `${row.expense_code} - ${row.expense_name}`,
    paymentAccount: `${row.payment_code} - ${row.payment_name}`,
    amount: Number(row.amount),
    isVoid: row.status === "void",
    voidReason: row.void_reason,
    createdBy: row.created_by_name || row.created_by_email || null,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    entry: row.entry_uuid
      ? { number: formatEntryNumber(row.journal_entry_id, entryPrefix), url: urls.accountingJournalView(row.entry_uuid) }
      : null,
    voidEntry: row.void_entry_uuid
      ? { number: formatEntryNumber(row.void_entry_id, entryPrefix), url: urls.accountingJournalView(row.void_entry_uuid) }
      : null,
    viewUrl: urls.expenseVoucherView(row.uuid),
    voidApi: urls.voidExpenseVoucher(row.uuid),
    updateApi: urls.updateExpenseVoucher(row.uuid),
    receiptApi: urls.expenseVoucherReceiptApi(row.uuid),
    receipt: row.receipt_file
      ? {
          name: row.receipt_name,
          size: Number(row.receipt_size),
          sizeLabel: `${(Number(row.receipt_size) / 1024).toFixed(0)} KB`,
          isImage: String(row.receipt_mime).startsWith("image/"),
          url: urls.expenseVoucherReceipt(row.uuid)
        }
      : null
  };
}

// Choices for the voucher form: active expense accounts, and the cash or bank account it is paid from.
export async function voucherAccountOptions() {
  const rows = await Account.findAll({ where: { status: 1 }, order: [["code", "ASC"]], raw: true });
  const option = (a) => ({ uuid: a.uuid, label: `${a.code} - ${a.name}` });
  return {
    expenseAccounts: rows.filter((a) => a.type === "expense").map(option),
    paymentAccounts: rows.filter((a) => Number(a.is_cash) === 1).map(option)
  };
}

export async function listExpenseVouchers({ keyword } = {}) {
  const replacements = [];
  let where = "";
  if (keyword && keyword.trim()) {
    const like = `%${keyword.trim()}%`;
    replacements.push(like, like);
    where = "WHERE v.payee LIKE ? OR v.description LIKE ?";
  }
  const rows = await sequelize.query(
    `${VOUCHER_SQL} ${where} ORDER BY v.voucher_date DESC, v.expense_voucher_id DESC LIMIT 200`,
    { replacements, type: QueryTypes.SELECT }
  );
  const { entryPrefix } = await getAccountingSettings();
  const items = rows.map((row) => toVoucher(row, entryPrefix));
  const month = today().slice(0, 7);
  const monthTotal = items
    .filter((v) => !v.isVoid && v.voucherDate.startsWith(month))
    .reduce((sum, v) => sum + toCents(v.amount), 0);
  return { items, keyword: keyword ?? "", monthTotal: monthTotal / 100 };
}

export async function getExpenseVoucher(uuid) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  const [row] = await sequelize.query(`${VOUCHER_SQL} WHERE v.uuid = ?`, { replacements: [uuid], type: QueryTypes.SELECT });
  if (!row) return null;
  const { entryPrefix } = await getAccountingSettings();
  return toVoucher(row, entryPrefix);
}

async function activeAccount(uuid, label, check) {
  const account = UUID_PATTERN.test(String(uuid ?? ""))
    ? await Account.findOne({ where: { uuid, status: 1 }, raw: true })
    : null;
  if (!account || !check(account)) throw new AccountingValidationError(`Select ${label}`);
  return account;
}

// Posts Dr expense / Cr cash or bank and saves the voucher in one transaction.
export async function createExpenseVoucher(data, adminUserId) {
  const voucherDate = parseDate(String(data?.voucher_date ?? "").trim());
  if (!voucherDate) throw new AccountingValidationError("A valid voucher date is required");
  const payee = String(data?.payee ?? "").trim();
  if (!payee) throw new AccountingValidationError("Payee is required");
  if (payee.length > 150) throw new AccountingValidationError("Payee must be 150 characters or fewer");
  const description = String(data?.description ?? "").trim();
  if (!description) throw new AccountingValidationError("Describe what was paid for");
  const amountCents = toCents(data?.amount);
  if (Number.isNaN(amountCents) || amountCents <= 0) throw new AccountingValidationError("Amount must be more than zero");
  const expense = await activeAccount(data?.expense_account, "an expense account", (a) => a.type === "expense");
  const payment = await activeAccount(data?.payment_account, "the cash or bank account it was paid from", (a) => Number(a.is_cash) === 1);
  assertSafeText(payee, "Payee");
  assertSafeText(description, "Description");
  if (description.length > 1000) throw new AccountingValidationError("Description must be 1000 characters or fewer");
  // The receipt is checked before anything is posted, so a rejected file stops the whole voucher.
  const receipt = data?.receipt_data ? validateUpload({ name: data.receipt_name, data: data.receipt_data }) : null;
  await assertPeriodOpen(voucherDate);

  const result = await sequelize.transaction(async (transaction) => {
    const entry = await postEntry(
      transaction,
      { entry_date: voucherDate, description: `Expense voucher - ${payee}: ${description}`, created_by: adminUserId ?? null, entry_type: "voucher" },
      [
        { accountId: expense.accounting_account_id, debitCents: amountCents, description },
        { accountId: payment.accounting_account_id, creditCents: amountCents, description: `Paid to ${payee}` }
      ]
    );
    const voucher = await ExpenseVoucher.create(
      {
        voucher_date: voucherDate,
        payee,
        description,
        expense_account_id: expense.accounting_account_id,
        payment_account_id: payment.accounting_account_id,
        amount: (amountCents / 100).toFixed(2),
        journal_entry_id: entry.accounting_journal_entry_id,
        created_by: adminUserId ?? null
      },
      { transaction }
    );
    const number = voucherNumber(voucher.expense_voucher_id);
    // The entry is created first (the voucher needs its id), so the voucher number is added as its reference here.
    await JournalEntry.update({ reference: number }, { where: { accounting_journal_entry_id: entry.accounting_journal_entry_id }, transaction });
    return { uuid: voucher.uuid, number, amount: amountCents / 100, payee, viewUrl: urls.expenseVoucherView(voucher.uuid) };
  });
  if (receipt) await saveReceipt(result.uuid, receipt);
  return { ...result, receipt: Boolean(receipt) };
}

// Cancels a voucher with a reversing entry dated today (or the voucher date, if that is later).
export async function voidExpenseVoucher(uuid, data, adminUserId) {
  const reason = String(data?.reason ?? "").trim();
  if (!reason) throw new AccountingValidationError("Give a reason for voiding the voucher");
  if (!UUID_PATTERN.test(String(uuid ?? ""))) throw new AccountingValidationError("Voucher not found");
  return sequelize.transaction(async (transaction) => {
    const voucher = await ExpenseVoucher.findOne({ where: { uuid }, transaction, lock: Transaction.LOCK.UPDATE });
    if (!voucher) throw new AccountingValidationError("Voucher not found");
    if (voucher.status === "void") throw new AccountingValidationError("This voucher is already void");
    const number = voucherNumber(voucher.expense_voucher_id);
    const now = today();
    const entryDate = voucher.voucher_date > now ? voucher.voucher_date : now;
    const reversal = await postReversal(transaction, {
      originalId: voucher.journal_entry_id,
      entryDate,
      reference: number,
      description: `Void of expense voucher ${number}: ${reason}`,
      createdBy: adminUserId ?? null
    });
    await voucher.update(
      { status: "void", void_entry_id: reversal.accounting_journal_entry_id, void_reason: reason.slice(0, 255) },
      { transaction }
    );
    return { uuid: voucher.uuid, number, amount: Number(voucher.amount), payee: voucher.payee };
  });
}

// Payee and particulars can be corrected; the amount and accounts cannot (void and issue a new voucher).
export async function updateExpenseVoucher(uuid, data) {
  const voucher = UUID_PATTERN.test(String(uuid ?? "")) ? await ExpenseVoucher.findOne({ where: { uuid } }) : null;
  if (!voucher) throw new AccountingValidationError("Voucher not found");
  if (voucher.status === "void") throw new AccountingValidationError("A void voucher cannot be edited");
  const payee = String(data?.payee ?? voucher.payee).trim();
  const description = String(data?.description ?? voucher.description).trim();
  if (!payee || payee.length > 150) throw new AccountingValidationError("Payee must be 1 to 150 characters");
  if (!description || description.length > 1000) throw new AccountingValidationError("Describe what was paid for (up to 1000 characters)");
  assertSafeText(payee, "Payee");
  assertSafeText(description, "Description");
  const before = { payee: voucher.payee, description: voucher.description };
  await voucher.update({ payee, description });
  return { uuid: voucher.uuid, number: voucherNumber(voucher.expense_voucher_id), before, after: { payee, description } };
}

async function saveReceipt(uuid, file) {
  const voucher = await ExpenseVoucher.findOne({ where: { uuid } });
  if (!voucher) throw new AccountingValidationError("Voucher not found");
  await fs.mkdir(RECEIPT_DIR, { recursive: true });
  // A random server-side name: nothing from the uploaded name ever reaches the disk path.
  const stored = `${crypto.randomUUID()}.${file.ext}`;
  await fs.writeFile(path.join(RECEIPT_DIR, stored), file.buffer, { flag: "wx" });
  const old = voucher.receipt_file;
  await voucher.update({ receipt_file: stored, receipt_name: file.originalName, receipt_mime: file.mime, receipt_size: file.size });
  if (old) await fs.rm(path.join(RECEIPT_DIR, path.basename(old)), { force: true });
  return { number: voucherNumber(voucher.expense_voucher_id), name: file.originalName, size: file.size };
}

export async function attachReceipt(uuid, data) {
  const voucher = UUID_PATTERN.test(String(uuid ?? "")) ? await ExpenseVoucher.findOne({ where: { uuid } }) : null;
  if (!voucher) throw new AccountingValidationError("Voucher not found");
  if (voucher.status === "void") throw new AccountingValidationError("A void voucher cannot get a receipt");
  return saveReceipt(uuid, validateUpload({ name: data?.receipt_name, data: data?.receipt_data }));
}

export async function removeReceipt(uuid) {
  const voucher = UUID_PATTERN.test(String(uuid ?? "")) ? await ExpenseVoucher.findOne({ where: { uuid } }) : null;
  if (!voucher || !voucher.receipt_file) throw new AccountingValidationError("This voucher has no receipt");
  const file = voucher.receipt_file;
  await voucher.update({ receipt_file: null, receipt_name: null, receipt_mime: null, receipt_size: null });
  await fs.rm(path.join(RECEIPT_DIR, path.basename(file)), { force: true });
  return { number: voucherNumber(voucher.expense_voucher_id) };
}

export async function getReceiptFile(uuid) {
  const voucher = UUID_PATTERN.test(String(uuid ?? "")) ? await ExpenseVoucher.findOne({ where: { uuid }, raw: true }) : null;
  if (!voucher?.receipt_file) return null;
  return {
    path: path.join(RECEIPT_DIR, path.basename(voucher.receipt_file)),
    mime: voucher.receipt_mime,
    name: voucher.receipt_name
  };
}
