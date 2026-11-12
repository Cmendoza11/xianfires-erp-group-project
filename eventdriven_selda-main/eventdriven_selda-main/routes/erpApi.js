/*
  Summary for Accounting's Enterprise Overview. Procurement keeps its data in its own database, so
  the other DJ's ERP modules read it only through its APIs (shared X-ERP-Key; browsers never call this).

  GET /api/v1/erp/summary   open requests and orders, unpaid supplier invoices, and the sync queues
*/
import express from "express";
import { Op, col, fn } from "sequelize";
import { PurchaseOrder, PurchaseRequest, SupplierInvoice, SupplierReturn, GoodsReceipt } from "../models/index.js";
import { requireErpKey } from "../middleware/erpKey.js";

const router = express.Router();
router.use(requireErpKey);

const OPEN_ORDER = ["Pending Approval", "Approved", "Sent to Supplier", "Partially Received"];

async function statusCounts(model, column) {
  const rows = await model.findAll({ attributes: [column, [fn("COUNT", col("id")), "n"]], group: [column], raw: true });
  const counts = { pending: 0, failed: 0, synced: 0 };
  for (const row of rows) {
    const key = String(row[column] ?? "").toLowerCase();
    if (key in counts) counts[key] += Number(row.n);
  }
  return counts;
}

async function countAndSum(model, where, column) {
  const [row] = await model.findAll({
    where,
    attributes: [[fn("COUNT", col("id")), "n"], [fn("COALESCE", fn("SUM", col(column)), 0), "total"]],
    raw: true,
  });
  return { count: Number(row?.n || 0), total: Math.round(Number(row?.total || 0) * 100) / 100 };
}

router.get("/summary", async (req, res) => {
  try {
    const [openOrders, pendingRequests, unpaid, accountingSync, refundSync, stockSync, returnStockSync] = await Promise.all([
      countAndSum(PurchaseOrder, { status: { [Op.in]: OPEN_ORDER } }, "totalAmount"),
      PurchaseRequest.count({ where: { status: "Pending" } }),
      countAndSum(SupplierInvoice, { paymentStatus: { [Op.ne]: "Paid" } }, "outstandingBalance"),
      statusCounts(SupplierInvoice, "financialSyncStatus"),
      statusCounts(SupplierReturn, "accountingSyncStatus"),
      statusCounts(GoodsReceipt, "inventorySyncStatus"),
      statusCounts(SupplierReturn, "inventoryAdjustmentStatus"),
    ]);
    res.json({
      openOrders: openOrders.count,
      openOrdersTotal: openOrders.total,
      pendingRequests,
      unpaid,
      accountingSync,
      refundSync,
      stockSync,
      returnStockSync,
    });
  } catch (error) {
    console.error("[procurement-erp-api]", error);
    res.status(500).json({ error: { status: 500, message: "Procurement could not answer" } });
  }
});

export default router;
