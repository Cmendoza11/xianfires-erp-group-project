/*
  Background retries for Procurement's links to the other DJ's ERP modules. Every minute it
  re-sends what is still Pending (the other module was offline) and reads payment status from
  Accounting for invoices that are not fully paid yet. Failed items (refused with a reason) are
  left for a person to fix; they are not retried automatically.
*/
import { Op } from "sequelize";
import { GoodsReceipt, SupplierInvoice, SupplierReturn } from "../models/index.js";
import { inventoryService } from "./inventoryService.js";
import { financialService } from "./financialService.js";

const SWEEP_INTERVAL_MS = 60_000;
const BATCH = 25;
let running = false;
let lastPaymentRefresh = 0;

export async function sweep() {
  if (running) return;
  running = true;
  try {
    for (const r of await GoodsReceipt.findAll({ where: { inventorySyncStatus: "Pending" }, limit: BATCH, order: [["id", "ASC"]] })) {
      await inventoryService.syncStockIn(r.id);
    }
    for (const r of await SupplierReturn.findAll({ where: { inventoryAdjustmentStatus: "Pending" }, limit: BATCH, order: [["id", "ASC"]] })) {
      await inventoryService.syncReturnStockAdjustment(r.id);
    }
    for (const inv of await SupplierInvoice.findAll({ where: { financialSyncStatus: "Pending" }, limit: BATCH, order: [["id", "ASC"]] })) {
      await financialService.dispatchPayable(inv.id);
    }
    for (const r of await SupplierReturn.findAll({ where: { accountingSyncStatus: "Pending" }, limit: BATCH, order: [["id", "ASC"]] })) {
      await financialService.dispatchCreditMemo(r.id);
    }
    await refreshOpenPayments();
  } finally {
    running = false;
  }
}

/** Reads the latest payment status from Accounting for invoices that are still open. */
export async function refreshOpenPayments({ force = false } = {}) {
  if (!force && Date.now() - lastPaymentRefresh < 15_000) return;
  lastPaymentRefresh = Date.now();
  const open = await SupplierInvoice.findAll({
    where: { financialSyncStatus: "Synced", paymentStatus: { [Op.notIn]: ["Paid", "Voided"] } },
    limit: BATCH,
    order: [["dueDate", "ASC"]]
  });
  for (const inv of open) await financialService.refreshPayment(inv.id);
}

/** Middleware for the invoice pages: show payment status as Accounting has it right now. */
export function refreshPaymentsBeforePage(req, res, next) {
  if (req.method !== "GET") return next();
  refreshOpenPayments()
    .catch((e) => console.error("[integration-worker] payment refresh failed:", e.message))
    .finally(() => next());
}

export function startIntegrationWorker() {
  const run = () => sweep().catch((e) => console.error("[integration-worker]", e.message));
  setTimeout(run, 5_000).unref();
  setInterval(run, SWEEP_INTERVAL_MS).unref();
}
