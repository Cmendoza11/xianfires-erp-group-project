/*
  Summary for Accounting's Enterprise Overview. The POS keeps its data in its own database, so the
  other DJ's ERP modules read it only through its APIs (shared X-ERP-Key; browsers never call this).

  GET /api/v1/erp/summary   today's and this month's sales, low stock, and the sync queue
*/
import express from "express";
import { Op, col, fn } from "sequelize";
import { Product, Inventory, Transaction, IntegrationOutbox } from "../models/index.js";
import { requireErpKey } from "../middleware/erpKey.js";

const router = express.Router();
router.use(requireErpKey);

// Day and month in server-local time (the clock the other modules use), as Dates in the stored UTC.
function bounds(now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd, monthStart: new Date(now.getFullYear(), now.getMonth(), 1), monthEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}

async function completedSales(from, to) {
  const [row] = await Transaction.findAll({
    where: { status: "Completed", createdAt: { [Op.gte]: from, [Op.lt]: to } },
    attributes: [[fn("COUNT", col("id")), "n"], [fn("COALESCE", fn("SUM", col("totalAmount")), 0), "total"]],
    raw: true,
  });
  return { count: Number(row?.n || 0), total: Math.round(Number(row?.total || 0) * 100) / 100 };
}

async function queueCounts(target) {
  const rows = await IntegrationOutbox.findAll({
    where: { target },
    attributes: ["status", [fn("COUNT", col("id")), "n"]],
    group: ["status"],
    raw: true,
  });
  const counts = { pending: 0, failed: 0, synced: 0 };
  for (const row of rows) {
    const key = String(row.status).toLowerCase();
    if (key in counts) counts[key] += Number(row.n);
  }
  return counts;
}

router.get("/summary", async (req, res) => {
  try {
    const b = bounds();
    const [today, month, low, accountingSync, customerSync] = await Promise.all([
      completedSales(b.dayStart, b.dayEnd),
      completedSales(b.monthStart, b.monthEnd),
      Inventory.findAll({
        where: { currentStock: { [Op.lte]: col("minStockLevel") } },
        include: [{ model: Product, as: "product", where: { status: "active" }, attributes: ["name"] }],
        order: [["currentStock", "ASC"]],
      }),
      queueCounts("accounting"),
      queueCounts("customers"),
    ]);
    const items = low
      .map((i) => ({ name: i.product?.name, currentStock: Number(i.currentStock), minStockLevel: Number(i.minStockLevel), unit: i.unit }))
      .sort((a, b) => a.currentStock - b.currentStock || String(a.name).localeCompare(String(b.name)));
    res.json({
      todaySales: today.total,
      todayCount: today.count,
      monthSales: month.total,
      monthCount: month.count,
      lowStock: { count: items.length, items: items.slice(0, 5) },
      accountingSync,
      customerSync,
    });
  } catch (error) {
    console.error("[pos-erp-api]", error);
    res.status(500).json({ error: { status: 500, message: "POS could not answer" } });
  }
});

export default router;
