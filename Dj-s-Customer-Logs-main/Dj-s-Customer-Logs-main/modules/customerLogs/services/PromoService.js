/*
    Customer Logs Module - Promo / voucher service
    Used by the staff pages and by the POS (through /api/promos):
      quote   checks a promo code for a customer and a subtotal, and returns the discount
      redeem  records that the promo was used on a sale (once per source + transaction reference)
              and takes the promo's points cost from the customer's loyalty balance
      void    cancels a redemption (the sale was voided) and gives the points back
*/
import { Op } from "sequelize";
import { sequelize } from "../../../models/db.js";
import { Customer, CustomerLog, LoyaltyRecord, Promo, PromoRedemption } from "../../../models/customerRelations.js";
import { CustomerLogError, netPurchaseCount } from "./CustomerLogService.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const normalizeCode = (code) => String(code || "").trim().toUpperCase().slice(0, 30);
const peso = (n) => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The discount a promo gives on a subtotal (never more than the subtotal). */
export function discountFor(promo, subtotal) {
  const amount = promo.discountType === "fixed"
    ? Number(promo.discountValue)
    : (Number(subtotal) * Number(promo.discountValue)) / 100;
  return round2(Math.min(Math.max(amount, 0), Number(subtotal)));
}

export const describePromo = (promo) => ({
  promoId: promo.promoId,
  code: promo.code,
  name: promo.name,
  mechanics: promo.mechanics,
  discountType: promo.discountType,
  discountValue: Number(promo.discountValue),
  minimumSpend: Number(promo.minimumSpend),
  pointsCost: Number(promo.pointsCost),
  minimumPurchases: Number(promo.minimumPurchases),
  startDate: promo.startDate,
  endDate: promo.endDate
});

async function findByCode(code, transaction) {
  const value = normalizeCode(code);
  if (!value) throw new CustomerLogError("Enter a promo code");
  const promo = await Promo.findOne({ where: { code: value }, transaction });
  if (!promo) throw new CustomerLogError(`Promo code ${value} does not exist`, 404);
  return promo;
}

export class PromoService {
  /** Checks a promo code for a customer and subtotal. Throws CustomerLogError with the reason it cannot be used. */
  static async quote({ code, customerId, subtotal }, transaction) {
    const promo = await findByCode(code, transaction);
    const amount = Number(subtotal);
    if (!Number.isFinite(amount) || amount <= 0) throw new CustomerLogError("A subtotal is required");
    if (promo.status !== "active") throw new CustomerLogError(`Promo ${promo.code} is not active`);
    const day = today();
    if (day < promo.startDate || day > promo.endDate) {
      throw new CustomerLogError(`Promo ${promo.code} is valid from ${promo.startDate} to ${promo.endDate}`);
    }
    if (!customerId) throw new CustomerLogError("Choose the customer first: promos belong to registered customers");
    const customer = await Customer.findByPk(customerId, { transaction });
    if (!customer || customer.status !== "ACTIVE") throw new CustomerLogError("The customer is not an active Customer Logs member", 404);
    if (amount < Number(promo.minimumSpend)) {
      throw new CustomerLogError(`Promo ${promo.code} needs a minimum spend of ${peso(promo.minimumSpend)} (this order: ${peso(amount)})`);
    }
    const purchases = await netPurchaseCount(customer.customerId, transaction);
    if (purchases < Number(promo.minimumPurchases)) {
      throw new CustomerLogError(`Promo ${promo.code} needs ${promo.minimumPurchases} earlier purchase(s); ${customer.name} has ${purchases}`);
    }
    const loyalty = await LoyaltyRecord.findOne({ where: { customerId: customer.customerId }, transaction });
    const points = Number(loyalty?.pointsBalance ?? 0);
    if (Number(promo.pointsCost) > points) {
      throw new CustomerLogError(`Promo ${promo.code} costs ${promo.pointsCost} point(s); ${customer.name} has ${points}`);
    }
    return {
      ...describePromo(promo),
      customerId: customer.customerId,
      customerName: customer.name,
      subtotal: round2(amount),
      discountAmount: discountFor(promo, amount),
      pointsBalance: points
    };
  }

  /**
   * Records a redemption. With a transaction reference it is idempotent per source: sending the same
   * POS sale again returns the first redemption (duplicate = true) and takes no more points.
   */
  static async redeem({ code, customerId, subtotal, discountAmount, transactionReference, source = "POS", userId = null }) {
    const reference = transactionReference ? String(transactionReference).trim().slice(0, 60) : null;
    const from = String(source || "POS").trim().slice(0, 60);
    return sequelize.transaction(async (transaction) => {
      if (reference) {
        const existing = await PromoRedemption.findOne({ where: { source: from, transactionReference: reference }, transaction });
        if (existing) return { redemption: existing, duplicate: true };
      }
      // The POS checked the code with quote() before the sale; check it again now that it is final.
      const quote = await PromoService.quote({ code, customerId, subtotal }, transaction);
      const customer = await Customer.findByPk(quote.customerId, { transaction, lock: transaction.LOCK.UPDATE });
      const discount = discountAmount === undefined || discountAmount === null ? quote.discountAmount : round2(discountAmount);
      if (quote.pointsCost) {
        const [loyalty] = await LoyaltyRecord.findOrCreate({
          where: { customerId: customer.customerId },
          defaults: { pointsBalance: 0, tier: "Regular" },
          transaction
        });
        await loyalty.update({ pointsBalance: Math.max(loyalty.pointsBalance - quote.pointsCost, 0) }, { transaction });
      }
      const redemption = await PromoRedemption.create({
        customerId: customer.customerId,
        promoId: quote.promoId,
        promoName: quote.name,
        promoCode: quote.code,
        source: from,
        transactionReference: reference,
        discountAmount: discount,
        pointsUsed: quote.pointsCost,
        recordedByUserId: Number.isInteger(userId) ? userId : null
      }, { transaction });
      await CustomerLog.create({
        customerId: customer.customerId,
        activityType: "promo_redeem",
        amount: discount,
        transactionReference: reference,
        activityAt: new Date(),
        sourceModule: String(from).toUpperCase().slice(0, 20),
        description: `Used promo ${quote.code} (${quote.name}): ${peso(discount)} off${quote.pointsCost ? `, ${quote.pointsCost} point(s) used` : ""}`,
        metadata: { promoId: quote.promoId, pointsUsed: quote.pointsCost },
        recordedByUserId: Number.isInteger(userId) ? userId : null
      }, { transaction });
      return { redemption, duplicate: false };
    });
  }

  /** Voids a redemption (by id, or by source + transaction reference) and gives its points back. */
  static async voidRedemption({ id, transactionReference, source = "POS", reason = null }) {
    return sequelize.transaction(async (transaction) => {
      const where = id ? { id } : { source: String(source || "POS"), transactionReference: String(transactionReference || "") };
      const redemption = await PromoRedemption.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
      if (!redemption) {
        // A sale without a promo, or a redemption that never arrived: nothing to undo.
        if (!id) return { redemption: null, voided: false };
        throw new CustomerLogError("Promo redemption not found", 404);
      }
      if (redemption.status === "Voided") return { redemption, voided: false };
      if (redemption.pointsUsed) {
        const loyalty = await LoyaltyRecord.findOne({ where: { customerId: redemption.customerId }, transaction, lock: transaction.LOCK.UPDATE });
        if (loyalty) await loyalty.update({ pointsBalance: loyalty.pointsBalance + redemption.pointsUsed }, { transaction });
      }
      await redemption.update({ status: "Voided", voidedAt: new Date(), voidReason: reason ? String(reason).slice(0, 255) : null }, { transaction });
      await CustomerLog.create({
        customerId: redemption.customerId,
        activityType: "promo_void",
        amount: redemption.discountAmount,
        transactionReference: redemption.transactionReference,
        activityAt: new Date(),
        sourceModule: String(redemption.source || "CRM").toUpperCase().slice(0, 20),
        description: `Promo ${redemption.promoCode || redemption.promoName} voided${redemption.pointsUsed ? `; ${redemption.pointsUsed} point(s) returned` : ""}${reason ? `: ${reason}` : ""}`
      }, { transaction });
      return { redemption, voided: true };
    });
  }

  static async activeCodes() {
    const day = today();
    return Promo.findAll({
      where: { status: "active", code: { [Op.ne]: null }, startDate: { [Op.lte]: day }, endDate: { [Op.gte]: day } },
      order: [["name", "ASC"]]
    });
  }
}
