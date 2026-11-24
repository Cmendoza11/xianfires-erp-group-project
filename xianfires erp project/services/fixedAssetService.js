import { QueryTypes, Transaction } from "sequelize";
import { sequelize, Account, FixedAsset, FixedAssetDepreciation, JournalEntry } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError, toCents } from "./accountTypes.js";
import { assertSafeText } from "./securityService.js";
import { parseDate, today } from "./dateUtils.js";
import { postEntry, postReversal } from "./journalService.js";
import { assertPeriodOpen } from "./periodService.js";
import { formatEntryNumber, getAccountingSettings } from "./settingService.js";

// The default chart's accounts: the equipment itself, its contra account, and the monthly expense.
const ASSET_ACCOUNT = "1500";
const ACCUMULATED_ACCOUNT = "1510";
const EXPENSE_ACCOUNT = "6500";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const pad2 = (n) => String(n).padStart(2, "0");
const monthEnd = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad2(new Date(y, m, 0).getDate())}`;
};
const monthLabel = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const nextMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
};

async function accountByCode(code) {
  const account = await Account.findOne({ where: { code, status: 1 }, raw: true });
  if (!account) throw new AccountingValidationError(`Account ${code} is missing or inactive in the Chart of Accounts`);
  return account;
}

// Straight-line monthly charge in cents.
const monthlyCents = (asset) =>
  Math.round((toCents(asset.cost) - toCents(asset.salvage_value)) / Number(asset.useful_life_months));

export async function listFixedAssets() {
  const rows = await sequelize.query(
    `SELECT a.*, DATE_FORMAT(a.acquisition_date, '%Y-%m-%d') AS acquired,
       COALESCE((SELECT SUM(d.amount) FROM fixed_asset_depreciation d WHERE d.fixed_asset_id = a.fixed_asset_id), 0) AS accumulated,
       (SELECT COUNT(*) FROM fixed_asset_depreciation d WHERE d.fixed_asset_id = a.fixed_asset_id) AS months_done,
       e.uuid AS entry_uuid
     FROM fixed_asset a
     LEFT JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = a.journal_entry_id
     WHERE a.deleted_at IS NULL
     ORDER BY a.acquisition_date DESC, a.fixed_asset_id DESC`,
    { type: QueryTypes.SELECT }
  );
  const { entryPrefix } = await getAccountingSettings();
  const items = rows.map((r) => {
    const cost = toCents(r.cost);
    const accumulated = toCents(r.accumulated);
    const depreciable = cost - toCents(r.salvage_value);
    return {
      uuid: r.uuid,
      name: r.name,
      editable: Number(r.months_done) === 0,
      costLocked: Number(r.months_done) > 0 || Boolean(r.journal_entry_id),
      updateApi: urls.updateFixedAsset(r.uuid),
      editValues: { name: r.name, acquisition_date: r.acquired, cost: Number(r.cost).toFixed(2), salvage_value: Number(r.salvage_value).toFixed(2), useful_life_months: Number(r.useful_life_months) },
      lockedFields: Number(r.months_done) > 0 ? "cost,acquisition_date,salvage_value,useful_life_months" : r.journal_entry_id ? "cost,acquisition_date" : "",
      deleteApi: urls.deleteFixedAsset(r.uuid),
      acquisitionDate: r.acquired,
      cost: cost / 100,
      salvageValue: Number(r.salvage_value),
      usefulLifeMonths: Number(r.useful_life_months),
      monthly: monthlyCents(r) / 100,
      accumulated: accumulated / 100,
      bookValue: (cost - accumulated) / 100,
      monthsDone: Number(r.months_done),
      fullyDepreciated: accumulated >= depreciable,
      entry: r.entry_uuid
        ? { number: formatEntryNumber(r.journal_entry_id, entryPrefix), url: urls.accountingJournalView(r.entry_uuid) }
        : null
    };
  });
  const sum = (key) => items.reduce((total, a) => total + toCents(a[key]), 0) / 100;
  return { items, totals: { cost: sum("cost"), accumulated: sum("accumulated"), bookValue: sum("bookValue") } };
}

// One row per depreciated month, newest first, with its journal entry.
export async function listDepreciationRuns() {
  const rows = await sequelize.query(
    `SELECT d.period, d.journal_entry_id, e.uuid AS entry_uuid, SUM(d.amount) AS total, COUNT(*) AS assets
     FROM fixed_asset_depreciation d
     INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = d.journal_entry_id
     GROUP BY d.period, d.journal_entry_id, e.uuid
     ORDER BY d.period DESC, d.journal_entry_id DESC`,
    { type: QueryTypes.SELECT }
  );
  const { entryPrefix } = await getAccountingSettings();
  return rows.map((r, index) => ({
    period: r.period,
    label: monthLabel(r.period),
    total: Number(r.total),
    assets: Number(r.assets),
    isLatest: index === 0,
    entry: { number: formatEntryNumber(r.journal_entry_id, entryPrefix), url: urls.accountingJournalView(r.entry_uuid) }
  }));
}

// The month to suggest in the form: the one after the last run, or the earliest acquisition month.
export async function suggestedDepreciationMonth() {
  const current = today().slice(0, 7);
  const [last] = await sequelize.query("SELECT MAX(period) AS period FROM fixed_asset_depreciation", { type: QueryTypes.SELECT });
  if (last?.period) return last.period >= current ? current : nextMonth(last.period);
  const [first] = await sequelize.query(
    "SELECT DATE_FORMAT(MIN(acquisition_date), '%Y-%m') AS month FROM fixed_asset WHERE deleted_at IS NULL",
    { type: QueryTypes.SELECT }
  );
  return first?.month && first.month < current ? first.month : current;
}

export async function cashAccountOptions() {
  const rows = await Account.findAll({ where: { is_cash: true, status: 1 }, order: [["code", "ASC"]], raw: true });
  return rows.map((a) => ({ uuid: a.uuid, label: `${a.code} - ${a.name}` }));
}

// Adds an asset. With "paid from", it also posts the purchase: Dr 1500 Equipment, Cr cash or bank.
export async function createFixedAsset(data, adminUserId) {
  const name = String(data?.name ?? "").trim();
  if (!name) throw new AccountingValidationError("Asset name is required");
  if (name.length > 150) throw new AccountingValidationError("Asset name must be 150 characters or fewer");
  assertSafeText(name, "Asset name");
  const acquisitionDate = parseDate(String(data?.acquisition_date ?? "").trim());
  if (!acquisitionDate) throw new AccountingValidationError("A valid acquisition date is required");
  const cost = toCents(data?.cost);
  if (Number.isNaN(cost) || cost <= 0) throw new AccountingValidationError("Cost must be more than zero");
  const salvage = toCents(data?.salvage_value || 0);
  if (Number.isNaN(salvage) || salvage < 0) throw new AccountingValidationError("Salvage value cannot be negative");
  if (salvage >= cost) throw new AccountingValidationError("Salvage value must be less than the cost");
  const life = Number(data?.useful_life_months);
  if (!Number.isInteger(life) || life < 1 || life > 600) {
    throw new AccountingValidationError("Useful life must be a whole number of months from 1 to 600");
  }

  const paidFrom = String(data?.paid_from ?? "").trim();
  let cashAccount = null;
  if (paidFrom) {
    cashAccount = UUID_PATTERN.test(paidFrom)
      ? await Account.findOne({ where: { uuid: paidFrom, is_cash: true, status: 1 }, raw: true })
      : null;
    if (!cashAccount) throw new AccountingValidationError("Select the cash or bank account the asset was paid from");
    await assertPeriodOpen(acquisitionDate);
  }
  const assetAccount = await accountByCode(ASSET_ACCOUNT);

  return sequelize.transaction(async (transaction) => {
    const asset = await FixedAsset.create(
      {
        name,
        acquisition_date: acquisitionDate,
        cost: (cost / 100).toFixed(2),
        salvage_value: (salvage / 100).toFixed(2),
        useful_life_months: life,
        created_by: adminUserId ?? null
      },
      { transaction }
    );
    if (cashAccount) {
      const entry = await postEntry(
        transaction,
        {
          entry_date: acquisitionDate,
          reference: `FA-${asset.fixed_asset_id}`,
          description: `Purchase of fixed asset: ${name}`,
          created_by: adminUserId ?? null,
          entry_type: "asset"
        },
        [
          { accountId: assetAccount.accounting_account_id, debitCents: cost, description: name },
          { accountId: cashAccount.accounting_account_id, creditCents: cost, description: `Paid for ${name}` }
        ]
      );
      await asset.update({ journal_entry_id: entry.accounting_journal_entry_id }, { transaction });
    }
    return { uuid: asset.uuid, name, cost: cost / 100, posted: Boolean(cashAccount) };
  });
}

// Charges one month of straight-line depreciation for every asset owned by the end of that month:
// one entry, Dr 6500 per asset, Cr 1510 for the total. The last month takes whatever is left.
export async function runDepreciation(data, adminUserId) {
  const month = String(data?.month ?? "").trim();
  if (!MONTH_PATTERN.test(month)) throw new AccountingValidationError("Choose a month");
  if (month > today().slice(0, 7)) throw new AccountingValidationError("You cannot depreciate a month that has not started yet");
  const entryDate = monthEnd(month);
  await assertPeriodOpen(entryDate);
  const expense = await accountByCode(EXPENSE_ACCOUNT);
  const accumulated = await accountByCode(ACCUMULATED_ACCOUNT);

  return sequelize.transaction(async (transaction) => {
    const assets = await sequelize.query(
      `SELECT a.*, COALESCE((SELECT SUM(d.amount) FROM fixed_asset_depreciation d WHERE d.fixed_asset_id = a.fixed_asset_id), 0) AS accumulated,
         (SELECT COUNT(*) FROM fixed_asset_depreciation d WHERE d.fixed_asset_id = a.fixed_asset_id) AS months_done
       FROM fixed_asset a
       WHERE a.acquisition_date <= ? AND a.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM fixed_asset_depreciation d WHERE d.fixed_asset_id = a.fixed_asset_id AND d.period = ?)
       ORDER BY a.fixed_asset_id
       FOR UPDATE`,
      { replacements: [entryDate, month], type: QueryTypes.SELECT, transaction }
    );
    const charges = [];
    for (const asset of assets) {
      const remaining = toCents(asset.cost) - toCents(asset.salvage_value) - toCents(asset.accumulated);
      if (remaining <= 0) continue;
      const isLast = Number(asset.months_done) + 1 >= Number(asset.useful_life_months);
      const amount = isLast ? remaining : Math.min(monthlyCents(asset), remaining);
      if (amount > 0) charges.push({ asset, amount });
    }
    if (!charges.length) {
      throw new AccountingValidationError(`Nothing to depreciate for ${monthLabel(month)}: it is already done, or no asset was owned then`);
    }
    const total = charges.reduce((sum, c) => sum + c.amount, 0);
    const entry = await postEntry(
      transaction,
      {
        entry_date: entryDate,
        reference: `DEP-${month}`,
        description: `Depreciation for ${monthLabel(month)}`,
        created_by: adminUserId ?? null,
        entry_type: "asset"
      },
      [
        ...charges.map((c) => ({ accountId: expense.accounting_account_id, debitCents: c.amount, description: c.asset.name })),
        { accountId: accumulated.accounting_account_id, creditCents: total, description: `Accumulated depreciation, ${monthLabel(month)}` }
      ]
    );
    await FixedAssetDepreciation.bulkCreate(
      charges.map((c) => ({
        fixed_asset_id: c.asset.fixed_asset_id,
        period: month,
        amount: (c.amount / 100).toFixed(2),
        journal_entry_id: entry.accounting_journal_entry_id
      })),
      { transaction }
    );
    return { month, label: monthLabel(month), total: total / 100, assets: charges.length };
  });
}

// Undoes the latest depreciated month: a reversing entry, then the month can be run again.
export async function undoLatestDepreciation(adminUserId) {
  return sequelize.transaction(async (transaction) => {
    const [latest] = await sequelize.query(
      "SELECT period, journal_entry_id FROM fixed_asset_depreciation ORDER BY period DESC, journal_entry_id DESC LIMIT 1 FOR UPDATE",
      { type: QueryTypes.SELECT, transaction }
    );
    if (!latest) throw new AccountingValidationError("No depreciation has been run yet");
    const original = await JournalEntry.findByPk(latest.journal_entry_id, { raw: true, transaction });
    const reversal = await postReversal(transaction, {
      originalId: latest.journal_entry_id,
      entryDate: original.entry_date,
      reference: `DEP-${latest.period}`,
      description: `Undo depreciation for ${monthLabel(latest.period)}`,
      createdBy: adminUserId ?? null
    });
    await FixedAssetDepreciation.destroy({ where: { journal_entry_id: latest.journal_entry_id }, transaction });
    return { month: latest.period, label: monthLabel(latest.period), reversalId: reversal.accounting_journal_entry_id };
  });
}

async function findAsset(uuid, transaction, paranoid = true) {
  if (!UUID_PATTERN.test(String(uuid ?? ""))) throw new AccountingValidationError("Asset not found");
  const asset = await FixedAsset.findOne({ where: { uuid }, transaction, lock: transaction ? Transaction.LOCK.UPDATE : undefined, paranoid });
  if (!asset) throw new AccountingValidationError("Asset not found");
  return asset;
}

const depreciationCount = (asset, transaction) =>
  FixedAssetDepreciation.count({ where: { fixed_asset_id: asset.fixed_asset_id }, transaction });

// Edit: the name always; salvage value and life until depreciation starts; cost and date only when
// nothing was posted for the asset yet (no purchase entry, no depreciation).
export async function updateFixedAsset(uuid, data) {
  return sequelize.transaction(async (transaction) => {
    const asset = await findAsset(uuid, transaction);
    const changes = {};
    const name = String(data?.name ?? asset.name).trim();
    if (!name || name.length > 150) throw new AccountingValidationError("Asset name must be 1 to 150 characters");
    assertSafeText(name, "Asset name");
    changes.name = name;
    const depreciated = (await depreciationCount(asset, transaction)) > 0;
    const wants = (key) => data?.[key] !== undefined && String(data[key]) !== String(asset[key]);
    const numberChanged = (key) => data?.[key] !== undefined && toCents(data[key]) !== toCents(asset[key]);
    if (depreciated && (numberChanged("cost") || numberChanged("salvage_value") || wants("useful_life_months") || wants("acquisition_date"))) {
      throw new AccountingValidationError("Depreciation was already posted for this asset; only its name can change");
    }
    if (asset.journal_entry_id && (numberChanged("cost") || wants("acquisition_date"))) {
      throw new AccountingValidationError("The purchase of this asset is already posted; its cost and date cannot change");
    }
    const cost = data?.cost !== undefined ? toCents(data.cost) : toCents(asset.cost);
    const salvage = data?.salvage_value !== undefined ? toCents(data.salvage_value || 0) : toCents(asset.salvage_value);
    const life = data?.useful_life_months !== undefined ? Number(data.useful_life_months) : Number(asset.useful_life_months);
    if (Number.isNaN(cost) || cost <= 0) throw new AccountingValidationError("Cost must be more than zero");
    if (Number.isNaN(salvage) || salvage < 0 || salvage >= cost) throw new AccountingValidationError("Salvage value must be zero or more and less than the cost");
    if (!Number.isInteger(life) || life < 1 || life > 600) throw new AccountingValidationError("Useful life must be a whole number of months from 1 to 600");
    const date = data?.acquisition_date !== undefined ? parseDate(String(data.acquisition_date)) : asset.acquisition_date;
    if (!date) throw new AccountingValidationError("A valid acquisition date is required");
    Object.assign(changes, { cost: (cost / 100).toFixed(2), salvage_value: (salvage / 100).toFixed(2), useful_life_months: life, acquisition_date: date });
    await asset.update(changes, { transaction });
    return { uuid: asset.uuid, name };
  });
}

// Soft delete. An asset with depreciation stays (undo the depreciation first). A posted purchase is
// cancelled with a reversing entry, and posted again if the asset is restored.
export async function deleteFixedAsset(uuid, adminUserId) {
  return sequelize.transaction(async (transaction) => {
    const asset = await findAsset(uuid, transaction);
    if ((await depreciationCount(asset, transaction)) > 0) {
      throw new AccountingValidationError(`${asset.name} already has depreciation posted and cannot be deleted`);
    }
    if (asset.journal_entry_id) {
      const now = today();
      await postReversal(transaction, {
        originalId: asset.journal_entry_id,
        entryDate: asset.acquisition_date > now ? asset.acquisition_date : now,
        reference: `FA-${asset.fixed_asset_id}`,
        description: `Deleted fixed asset: ${asset.name}`,
        createdBy: adminUserId ?? null
      });
    }
    await asset.destroy({ transaction });
    return { uuid: asset.uuid, name: asset.name };
  });
}

// Called by the Recycle Bin: brings the asset back and posts its purchase again if it was cancelled.
export async function restoreFixedAsset(uuid, adminUserId) {
  return sequelize.transaction(async (transaction) => {
    const asset = await findAsset(uuid, transaction, false);
    if (!asset.deleted_at) throw new AccountingValidationError("This asset is not deleted");
    await asset.restore({ transaction });
    if (asset.journal_entry_id) {
      const original = await JournalEntry.findByPk(asset.journal_entry_id, { transaction, raw: true });
      const lines = await sequelize.query(
        "SELECT account_id, debit, credit, description FROM accounting_journal_line WHERE journal_entry_id = ? ORDER BY sort_order",
        { replacements: [asset.journal_entry_id], type: QueryTypes.SELECT, transaction }
      );
      const entry = await postEntry(
        transaction,
        { entry_date: today(), reference: original.reference, description: `Restored fixed asset: ${asset.name}`, created_by: adminUserId ?? null, entry_type: "asset" },
        lines.map((l) => ({ accountId: l.account_id, debitCents: toCents(l.debit), creditCents: toCents(l.credit), description: l.description }))
      );
      await asset.update({ journal_entry_id: entry.accounting_journal_entry_id }, { transaction });
    }
    return { uuid: asset.uuid, name: asset.name };
  });
}
