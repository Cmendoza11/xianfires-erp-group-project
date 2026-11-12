/*
    Customer Logs Module - Promo API for the other DJ's ERP modules (shared X-ERP-Key, checked in index.js)

    GET  /api/promos                active promos that have a code
    POST /api/promos/quote          { code, customerId, subtotal } -> the discount, or 4xx with the reason
    POST /api/promos/redeem         { code, customerId, subtotal, discountAmount, transactionReference, source }
                                    -> 201 new / 200 already recorded for that transaction
    POST /api/promos/void           { transactionReference, source, reason } -> the redemption is voided,
                                    points are given back (200 also when there was nothing to void)
*/
import express from "express";
import { PromoService, describePromo } from "../services/PromoService.js";

const router = express.Router();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("[promo-api]", error);
    res.status(status).json({ success: false, error: { status, message: status === 500 ? "Promo request failed" : error.message } });
  }
};

router.get("/", handle(async (req, res) => {
  res.json({ success: true, data: (await PromoService.activeCodes()).map(describePromo) });
}));

router.post("/quote", handle(async (req, res) => {
  res.json({ success: true, data: await PromoService.quote(req.body || {}) });
}));

router.post("/redeem", handle(async (req, res) => {
  const { redemption, duplicate } = await PromoService.redeem({ ...(req.body || {}), source: req.body?.source || "POS" });
  res.status(duplicate ? 200 : 201).json({ success: true, data: { redemption, duplicate } });
}));

router.post("/void", handle(async (req, res) => {
  const { redemption, voided } = await PromoService.voidRedemption({
    transactionReference: req.body?.transactionReference,
    source: req.body?.source || "POS",
    reason: req.body?.reason
  });
  res.json({ success: true, data: { redemption, voided } });
}));

export default router;
