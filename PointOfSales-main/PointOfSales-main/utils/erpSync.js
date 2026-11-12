/*
  Delivers POS sales and voids to the other DJ's ERP modules (see models/integrationOutboxModel.js).

  Accounting (journal entry per sale, posted through the Accounting ERP /api/v1):
    Dr 1000 Cash on Hand (Cash) or 1010 Cash in Bank (GCash, Maya, card)   total paid
    Dr 4200 Sales Discounts                                                discount
        Cr 4000 Sales Revenue                                              subtotal
        Cr 4500 Other Income                                               service charge
        Cr 2200 Output VAT Payable                                         tax
  A void posts the reversing entry. Customer Logs gets a purchase (or refund) log for loyalty.

  Every call carries the sale's own id (external_id POS-<transaction number>, or the transaction
  reference for Customer Logs), so a retry after a timeout never books the same sale twice.
*/
import { Op } from "sequelize";
import { IntegrationOutbox, Payment, Transaction as SaleTransaction } from "../models/index.js";
import { ErpApiError, accounting, peer } from "./erpClient.js";
import { redeemPromo, voidPromo } from "./crm.js";

// Default chart-of-accounts codes of the Accounting ERP; override in the root .env if they differ.
const ACCOUNT = {
  cash: process.env.ERP_ACCOUNT_CASH || "1000",
  bank: process.env.ERP_ACCOUNT_BANK || "1010",
  sales: process.env.ERP_ACCOUNT_SALES || "4000",
  discounts: process.env.ERP_ACCOUNT_SALES_DISCOUNTS || "4200",
  serviceCharge: process.env.ERP_ACCOUNT_SERVICE_CHARGE || "4500",
  outputVat: process.env.ERP_ACCOUNT_OUTPUT_VAT || "2200",
};
const MAX_ATTEMPTS = 10;
const SWEEP_INTERVAL_MS = 60_000;

const cents = (value) => Math.round(Number(value ?? 0) * 100);
const pesos = (c) => Number((c / 100).toFixed(2));
const pad = (n) => String(n).padStart(2, "0");
// The business day in server-local time (the Accounting ERP books by the same clock).
const localDate = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const externalId = (sale) => `POS-${sale.transactionNumber}`;
const backoffMs = (attempts) => Math.min(30_000 * 2 ** (attempts - 1), 15 * 60_000);

/** Queues the messages for a sale or void. Call it inside the same DB transaction. */
export async function queueIntegration(t, sale, event) {
  const targets = ["accounting", ...(sale.customerId ? ["customers"] : [])];
  const ids = [];
  for (const target of targets) {
    const [row] = await IntegrationOutbox.findOrCreate({
      where: { target, event, transactionId: sale.id },
      defaults: { status: "Pending" },
      transaction: t,
    });
    ids.push(row.id);
  }
  return ids;
}

async function saleLines(sale) {
  const payments = await Payment.findAll({ where: { transactionId: sale.id }, order: [["id", "ASC"]] });
  const total = cents(sale.totalAmount);
  const discount = cents(sale.discountAmount);
  const subtotal = cents(sale.subtotal);
  const service = cents(sale.serviceCharge);
  const tax = cents(sale.taxAmount);

  const accountFor = (method) => (method === "Cash" ? ACCOUNT.cash : ACCOUNT.bank);
  const debits = new Map();
  for (const payment of payments) {
    const account = accountFor(payment.method);
    const entry = debits.get(account) || { amount: 0, methods: new Set() };
    entry.amount += cents(payment.amount);
    entry.methods.add(payment.method);
    debits.set(account, entry);
  }
  const paid = [...debits.values()].reduce((sum, d) => sum + d.amount, 0);
  if (paid !== total) {
    // Payment rows should equal the total; if not, the whole total goes to the first method's account.
    const method = payments[0]?.method || "Cash";
    debits.clear();
    debits.set(accountFor(method), { amount: total, methods: new Set([method]) });
  }

  const lines = [];
  for (const [account, d] of debits) {
    if (d.amount) lines.push({ account, debit: pesos(d.amount), description: `${[...d.methods].join(", ")} received` });
  }
  if (discount) lines.push({ account: ACCOUNT.discounts, debit: pesos(discount), description: "Sales discount" });
  if (subtotal) lines.push({ account: ACCOUNT.sales, credit: pesos(subtotal), description: "POS sales" });
  if (service) lines.push({ account: ACCOUNT.serviceCharge, credit: pesos(service), description: "Service charge" });
  if (tax) lines.push({ account: ACCOUNT.outputVat, credit: pesos(tax), description: "Output VAT" });

  if (total + discount !== subtotal + service + tax) {
    throw new ErpApiError(`Sale totals do not balance (debits ${pesos(total + discount)} vs credits ${pesos(subtotal + service + tax)})`, 400);
  }
  return lines;
}

// A void can only be delivered after its sale; this delivers the sale first when needed.
async function ensureDelivered(target, event, sale) {
  const [row] = await IntegrationOutbox.findOrCreate({
    where: { target, event, transactionId: sale.id },
    defaults: { status: "Pending" },
  });
  if (row.status !== "Synced") {
    await deliver(row);
    await row.reload();
  }
  if (row.status === "Synced") return row;
  throw new ErpApiError(
    `The ${event} must reach ${target} first (${row.lastError || "still waiting"})`,
    row.status === "Failed" ? 400 : 0
  );
}

const customerLog = (sale, activityType, when) => peer("CRM", 3004, "POST", "/api/customer-logs", {
  customerId: sale.customerId,
  activityType,
  amount: Number(sale.totalAmount),
  transactionReference: sale.transactionNumber,
  sourceModule: "POS",
  activityAt: when,
  staff: sale.cashierName,
  description: `POS ${activityType} ${sale.transactionNumber}`,
  metadata: { orderNumber: sale.orderNumber },
});

const HANDLERS = {
  "accounting:sale": async (sale) => {
    const lines = await saleLines(sale);
    if (lines.length < 2) return "nothing to post";
    const res = await accounting("POST", "/journal-entries", {
      entry_date: localDate(sale.createdAt),
      reference: sale.transactionNumber,
      description: `POS sale ${sale.transactionNumber}${sale.orderNumber ? ` (order ${sale.orderNumber})` : ""}`,
      external_id: externalId(sale),
      lines,
    });
    return res.data.entryNumber;
  },

  "accounting:void": async (sale) => {
    const saleRow = await ensureDelivered("accounting", "sale", sale);
    if (saleRow.reference === "nothing to post") return "nothing to reverse";
    const path = `/journal-entries/${encodeURIComponent(externalId(sale))}`;
    try {
      const res = await accounting("POST", `${path}/reverse`, {
        entry_date: localDate(sale.voidedAt || new Date()),
        reason: `POS void: ${sale.voidReason || "no reason given"}`,
      });
      return res.data.entryNumber;
    } catch (error) {
      // After a lost response the entry is already reversed; that counts as delivered.
      if (error.status === 400) {
        const entry = await accounting("GET", path);
        if (entry?.data?.reversedBy) return entry.data.reversedBy.number;
      }
      throw error;
    }
  },

  "customers:sale": async (sale) => {
    const res = await customerLog(sale, "purchase", sale.createdAt);
    if (sale.promoCode) {
      await redeemPromo({
        code: sale.promoCode,
        customerId: sale.customerId,
        subtotal: Number(sale.subtotal),
        discountAmount: Number(sale.promoDiscountAmount || 0),
        transactionReference: sale.transactionNumber,
        source: "POS",
      });
    }
    return `log #${res.data.log.id}`;
  },

  "customers:void": async (sale) => {
    await ensureDelivered("customers", "sale", sale);
    const res = await customerLog(sale, "refund", sale.voidedAt || new Date());
    if (sale.promoCode) {
      await voidPromo({
        transactionReference: sale.transactionNumber,
        reason: sale.voidReason || "POS void",
      });
    }
    return `log #${res.data.log.id}`;
  },
};

const inFlight = new Set();

/** Sends one queued message. Never throws: the outcome is stored on the row. */
export async function deliver(rowOrId) {
  const row = typeof rowOrId === "number" ? await IntegrationOutbox.findByPk(rowOrId) : rowOrId;
  if (!row || row.status === "Synced" || inFlight.has(row.id)) return row;
  inFlight.add(row.id);
  try {
    const sale = await SaleTransaction.findByPk(row.transactionId);
    if (!sale) throw new ErpApiError("The POS transaction no longer exists", 404);
    const reference = await HANDLERS[`${row.target}:${row.event}`](sale);
    await row.update({ status: "Synced", attempts: row.attempts + 1, reference: String(reference ?? "").slice(0, 80) || null, lastError: null, nextAttemptAt: null });
  } catch (error) {
    const attempts = row.attempts + 1;
    const retryable = (error instanceof ErpApiError ? error.retryable : true) && attempts < MAX_ATTEMPTS;
    await row.update({
      status: retryable ? "Pending" : "Failed",
      attempts,
      lastError: String(error.message || error).slice(0, 1000),
      nextAttemptAt: retryable ? new Date(Date.now() + backoffMs(attempts)) : null,
    }).catch((e) => console.error("[erp-sync] could not save sync result:", e.message));
  } finally {
    inFlight.delete(row.id);
  }
  return row;
}

/** Delivers right after the sale's DB transaction commits, without making the cashier wait. */
export function deliverSoon(ids = []) {
  if (!ids.length) return;
  setImmediate(async () => {
    for (const id of ids) await deliver(id);
  });
}

/** Retries everything that is due. The worker calls this every minute. */
export async function sweep() {
  const rows = await IntegrationOutbox.findAll({
    where: { status: "Pending", [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: new Date() } }] },
    order: [["id", "ASC"]],
    limit: 25,
  });
  for (const row of rows) await deliver(row);
  return rows.length;
}

export function startSyncWorker() {
  const run = () => sweep().catch((e) => console.error("[erp-sync]", e.message));
  setTimeout(run, 5_000).unref();
  setInterval(run, SWEEP_INTERVAL_MS).unref();
}

/** "Retry sync" on a transaction: re-queues failed messages (and any that were never queued). */
export async function retryTransaction(transactionId) {
  const sale = await SaleTransaction.findByPk(transactionId);
  if (!sale) return [];
  const events = sale.status === "Completed" ? ["sale"] : ["sale", "void"];
  const targets = ["accounting", ...(sale.customerId ? ["customers"] : [])];
  const rows = [];
  for (const event of events) {
    for (const target of targets) {
      const [row] = await IntegrationOutbox.findOrCreate({ where: { target, event, transactionId: sale.id }, defaults: { status: "Pending" } });
      if (row.status !== "Synced") await row.update({ status: "Pending", attempts: 0, nextAttemptAt: null });
      rows.push(row);
    }
  }
  for (const row of rows) await deliver(row);
  return IntegrationOutbox.findAll({ where: { transactionId: sale.id }, order: [["id", "ASC"]] });
}
