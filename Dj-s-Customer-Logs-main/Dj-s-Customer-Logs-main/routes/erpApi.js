/*
  Summary for Accounting's Enterprise Overview. Customer Logs keeps its data in its own database, so
  the other DJ's ERP modules read it only through its APIs (shared X-ERP-Key, checked in index.js).

  GET /api/erp/summary   registered customers and this month's purchases (net of refunds)
*/
import express from "express";
import { Op } from "sequelize";
import { Customer, CustomerLog } from "../models/customerRelations.js";

const router = express.Router();

router.get("/summary", async (req, res) => {
  try {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [customers, logs] = await Promise.all([
      Customer.count(),
      CustomerLog.findAll({
        where: { activityType: { [Op.in]: ["purchase", "refund"] }, activityAt: { [Op.gte]: from, [Op.lt]: to } },
        attributes: ["activityType", "amount", "sourceModule"],
        raw: true,
      }),
    ]);
    // A voided POS sale logs a refund against its purchase, so refunds cancel purchases here.
    let count = 0;
    let total = 0;
    let fromPos = 0;
    for (const log of logs) {
      const sign = log.activityType === "purchase" ? 1 : -1;
      count += sign;
      total += sign * Number(log.amount || 0);
      if (log.sourceModule === "POS") fromPos += sign;
    }
    res.json({
      customers,
      month: { count: Math.max(count, 0), total: Math.max(Math.round(total * 100) / 100, 0), fromPos: Math.max(fromPos, 0) },
    });
  } catch (error) {
    console.error("[customer-logs-erp-api]", error);
    res.status(500).json({ error: { status: 500, message: "Customer Logs could not answer" } });
  }
});

export default router;
