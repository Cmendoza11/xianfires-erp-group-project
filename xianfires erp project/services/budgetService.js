import { Op } from "sequelize";
import { sequelize, Account, Budget } from "../models/index.js";
import { AccountingValidationError, toCents } from "./accountTypes.js";
import { today } from "./dateUtils.js";
import { accountTotals, ledgerUrl } from "./reportService.js";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const pad2 = (n) => String(n).padStart(2, "0");

export function resolveMonth(value) {
  return MONTH_PATTERN.test(String(value ?? "")) ? value : today().slice(0, 7);
}

const monthRange = (month) => {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${pad2(new Date(y, m, 0).getDate())}` };
};
export const monthLabel = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

const pct = (actual, budget) => (budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null);

// Budget vs actual for one month. Amounts are in each account's normal direction, so a higher number
// is good for income accounts and bad for expenses and contra-revenue (returns, discounts).
export async function getBudgetVsActual(month) {
  const { from, to } = monthRange(month);
  const rows = (await accountTotals({ from, to, excludeClosing: true })).filter((r) => r.type === "revenue" || r.type === "expense");
  const active = new Set(
    (await Account.findAll({ where: { status: 1, type: { [Op.in]: ["revenue", "expense"] } }, attributes: ["accounting_account_id"], raw: true }))
      .map((a) => a.accounting_account_id)
  );
  const budgets = new Map(
    (await Budget.findAll({ where: { period: month }, raw: true })).map((b) => [b.account_id, toCents(b.amount)])
  );

  const sections = { revenue: [], expense: [] };
  for (const r of rows) {
    const budget = budgets.get(r.accountingAccountId);
    const actual = r.normalBalance === "debit" ? r.debit - r.credit : r.credit - r.debit;
    if (!active.has(r.accountingAccountId) && budget === undefined && actual === 0) continue;
    const higherIsGood = r.type === "revenue" && r.normalBalance === "credit";
    const variance = actual - (budget ?? 0);
    const sign = (r.type === "revenue") === (r.normalBalance === "credit") ? 1 : -1;
    sections[r.type].push({
      uuid: r.uuid,
      code: r.code,
      name: r.name,
      field: `budget_${r.uuid}`,
      budget: budget === undefined ? "" : (budget / 100).toFixed(2),
      budgetAmount: (budget ?? 0) / 100,
      hasBudget: budget !== undefined,
      actual: actual / 100,
      variance: variance / 100,
      percent: pct(actual, budget ?? 0),
      // Only rows with a budget get a verdict.
      status: budget === undefined ? null : variance === 0 ? "on" : (variance > 0) === higherIsGood ? "good" : "bad",
      statusLabel: budget === undefined ? "" : variance === 0 ? "On budget" : higherIsGood ? (variance > 0 ? "Above target" : "Below target") : (variance > 0 ? "Over budget" : "Under budget"),
      ledgerUrl: ledgerUrl(r.uuid, from, to),
      sign,
      budgetCents: budget ?? 0,
      actualCents: actual
    });
  }

  const total = (list) => {
    const budget = list.reduce((s, a) => s + a.sign * a.budgetCents, 0);
    const actual = list.reduce((s, a) => s + a.sign * a.actualCents, 0);
    return { budget: budget / 100, actual: actual / 100, variance: (actual - budget) / 100, percent: pct(actual, budget), budgetCents: budget, actualCents: actual };
  };
  const revenue = total(sections.revenue);
  const expense = total(sections.expense);
  const net = {
    budget: (revenue.budgetCents - expense.budgetCents) / 100,
    actual: (revenue.actualCents - expense.actualCents) / 100,
    variance: ((revenue.actualCents - expense.actualCents) - (revenue.budgetCents - expense.budgetCents)) / 100
  };
  return {
    month,
    label: monthLabel(month),
    from,
    to,
    revenue: { accounts: sections.revenue, total: revenue },
    expense: { accounts: sections.expense, total: expense },
    net,
    hasBudgets: budgets.size > 0
  };
}

// Saves a month's budgets from fields named budget_<account uuid>; an empty field removes that budget.
// With copy_from=<YYYY-MM>, that month's budgets are copied instead (existing ones are replaced).
export async function saveBudgets(data) {
  const month = String(data?.month ?? "");
  if (!MONTH_PATTERN.test(month)) throw new AccountingValidationError("Choose a month");
  const accounts = await Account.findAll({ where: { type: { [Op.in]: ["revenue", "expense"] } }, raw: true });
  const byUuid = new Map(accounts.map((a) => [a.uuid, a]));

  const copyFrom = String(data?.copy_from ?? "");
  if (copyFrom) {
    if (!MONTH_PATTERN.test(copyFrom) || copyFrom === month) throw new AccountingValidationError("Choose another month to copy from");
    const source = await Budget.findAll({ where: { period: copyFrom }, raw: true });
    if (!source.length) throw new AccountingValidationError(`${monthLabel(copyFrom)} has no budget to copy`);
    await sequelize.transaction(async (transaction) => {
      await Budget.destroy({ where: { period: month }, transaction });
      await Budget.bulkCreate(source.map((b) => ({ account_id: b.account_id, period: month, amount: b.amount })), { transaction });
    });
    return { month, label: monthLabel(month), saved: source.length, copiedFrom: monthLabel(copyFrom) };
  }

  const changes = [];
  for (const [key, raw] of Object.entries(data ?? {})) {
    if (!key.startsWith("budget_")) continue;
    const account = byUuid.get(key.slice(7));
    if (!account) continue;
    const text = String(raw ?? "").trim();
    if (text === "") {
      changes.push({ account, cents: null });
      continue;
    }
    const cents = toCents(text);
    if (Number.isNaN(cents) || cents < 0) {
      throw new AccountingValidationError(`${account.code} - ${account.name}: the budget must be zero or more`);
    }
    changes.push({ account, cents });
  }

  await sequelize.transaction(async (transaction) => {
    for (const { account, cents } of changes) {
      const where = { account_id: account.accounting_account_id, period: month };
      if (cents === null) {
        await Budget.destroy({ where, transaction });
        continue;
      }
      const amount = (cents / 100).toFixed(2);
      const [row, created] = await Budget.findOrCreate({ where, defaults: { ...where, amount }, transaction });
      if (!created) await row.update({ amount }, { transaction });
    }
  });
  return { month, label: monthLabel(month), saved: changes.filter((c) => c.cents !== null).length };
}

export const previousMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
};
