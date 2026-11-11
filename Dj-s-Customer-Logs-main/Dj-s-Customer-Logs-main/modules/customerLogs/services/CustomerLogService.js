/*
    Customer Logs Module - Customer Log Service
    Records customer activity for the web UI and for other ERP modules (POS checkout, refunds).
    The UI and the API share the same tables, so a POS sale shows up on the staff pages at once.
*/

import { Op } from "sequelize";
import { sequelize } from "../../../models/db.js";
import { Customer, CustomerLog, LoyaltyRecord } from "../../../models/customerRelations.js";
import { AuditService } from "../../../core/AuditService.js";
import { MODULES } from "../../../config/constants.js";

// The API used to send uppercase log types; the UI stores lowercase activity types.
const normalizeType = (value) => String(value || "").trim().toLowerCase();

export class CustomerLogError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const tierFor = (netPurchases) => (netPurchases >= 10 ? "Gold" : netPurchases >= 5 ? "Silver" : "Regular");

// Purchases minus refunds: the basis for loyalty points, tiers and promo eligibility.
export async function netPurchaseCount(customerId, transaction) {
  const [purchases, refunds] = await Promise.all([
    CustomerLog.count({ where: { customerId, activityType: "purchase" }, transaction }),
    CustomerLog.count({ where: { customerId, activityType: "refund" }, transaction })
  ]);
  return Math.max(purchases - refunds, 0);
}

export class CustomerLogService {

  /**
   * Records one activity. Idempotent for other modules: the same (sourceModule, activityType,
   * transactionReference) returns the existing log with duplicate = true instead of counting twice.
   */
  static async recordLog(customerId, logData, userId = null, ipAddress = null) {
    const activityType = normalizeType(logData.activityType || logData.logType);
    if (!customerId || !activityType) throw new CustomerLogError("customerId and activityType are required");
    const sourceModule = String(logData.sourceModule || "CRM").trim().toUpperCase().slice(0, 20);
    const transactionReference = logData.transactionReference || logData.referenceId || null;
    const amount = logData.amount === undefined || logData.amount === null || logData.amount === "" ? null : Number(logData.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new CustomerLogError("amount must be a positive number");
    if (activityType === "purchase" && amount === null) throw new CustomerLogError("A purchase needs an amount");
    const activityAt = logData.activityAt ? new Date(logData.activityAt) : new Date();
    if (Number.isNaN(activityAt.getTime())) throw new CustomerLogError("activityAt is not a valid date");

    const result = await sequelize.transaction(async (transaction) => {
      // Locking the customer row serialises concurrent logs for the same customer (POS retries).
      const customer = await Customer.findByPk(customerId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!customer) throw new CustomerLogError("Customer not found", 404);

      if (transactionReference) {
        const existing = await CustomerLog.findOne({
          where: { customerId, sourceModule, activityType, transactionReference },
          transaction
        });
        if (existing) return { log: existing, duplicate: true };
      }

      const log = await CustomerLog.create({
        customerId,
        activityType,
        amount,
        transactionReference,
        activityAt,
        sourceModule,
        description: logData.description || null,
        staff: logData.staff || null,
        metadata: logData.metadata || null,
        recordedByUserId: Number.isInteger(userId) ? userId : null
      }, { transaction });

      if (activityType === "purchase" || activityType === "refund") {
        const sign = activityType === "purchase" ? 1 : -1;
        const totalSpent = Math.max(Number(customer.totalSpent || 0) + sign * (amount || 0), 0);
        await customer.update({
          totalSpent: totalSpent.toFixed(2),
          ...(activityType === "purchase" ? { lastPurchaseDate: activityAt } : {})
        }, { transaction });

        const loyalty = await LoyaltyRecord.findOne({ where: { customerId }, transaction, lock: transaction.LOCK.UPDATE });
        if (loyalty) {
          const net = await netPurchaseCount(customerId, transaction);
          await loyalty.update({
            pointsBalance: Math.max(loyalty.pointsBalance + sign, 0),
            tier: tierFor(net)
          }, { transaction });
        }
      }
      return { log, duplicate: false };
    });

    if (!result.duplicate) {
      await AuditService.logCreate(MODULES.CUSTOMER_LOGS, "CustomerLog", String(result.log.id), {
        userId: Number.isInteger(userId) ? userId : null,
        description: `Recorded ${activityType} from ${sourceModule}${transactionReference ? ` (${transactionReference})` : ""}`,
        ipAddress
      });
    }
    return result;
  }

  static async getCustomerHistory(customerId, limit = 50, offset = 0) {
    const { count, rows } = await CustomerLog.findAndCountAll({
      where: { customerId },
      order: [["activityAt", "DESC"]],
      limit,
      offset
    });
    return { total: count, logs: rows };
  }

  static async getLogsbyType(logType, limit = 50, offset = 0) {
    const { count, rows } = await CustomerLog.findAndCountAll({
      where: { activityType: normalizeType(logType) },
      order: [["activityAt", "DESC"]],
      limit,
      offset
    });
    return { total: count, logs: rows };
  }

  static async getLogsbyModule(sourceModule, limit = 50, offset = 0) {
    const { count, rows } = await CustomerLog.findAndCountAll({
      where: { sourceModule: { [Op.eq]: String(sourceModule).toUpperCase() } },
      order: [["activityAt", "DESC"]],
      limit,
      offset
    });
    return { total: count, logs: rows };
  }

  // Called by other modules to record their activities
  static async recordPurchase(customerId, amount, referenceId, sourceModule, metadata = {}) {
    return this.recordLog(customerId, { activityType: "purchase", sourceModule, amount, referenceId, metadata });
  }

  static async recordPromoRedemption(customerId, referenceId, sourceModule, metadata = {}) {
    return this.recordLog(customerId, { activityType: "promo_redeem", sourceModule, referenceId, metadata });
  }

  static async recordRefund(customerId, amount, referenceId, sourceModule) {
    return this.recordLog(customerId, { activityType: "refund", sourceModule, amount, referenceId });
  }
}
