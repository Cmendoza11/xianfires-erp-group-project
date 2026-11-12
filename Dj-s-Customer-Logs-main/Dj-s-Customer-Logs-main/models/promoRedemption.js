import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Who used which promo, when, on which POS transaction, for how much; a redemption can be voided
// (the POS voids it with the sale), which gives the points back.
export const PromoRedemption = sequelize.define("PromoRedemption", {
  promoId: { type: DataTypes.UUID, allowNull: true },
  promoName: { type: DataTypes.STRING, allowNull: false },
  promoCode: { type: DataTypes.STRING(30), allowNull: true },
  recordedByUserId: { type: DataTypes.INTEGER, allowNull: true },
  redemptionDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  source: { type: DataTypes.STRING, allowNull: false, defaultValue: "POS" },
  transactionReference: { type: DataTypes.STRING(60), allowNull: true },
  discountAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  pointsUsed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  status: { type: DataTypes.ENUM("Redeemed", "Voided"), allowNull: false, defaultValue: "Redeemed" },
  voidedAt: { type: DataTypes.DATE, allowNull: true },
  voidReason: { type: DataTypes.STRING, allowNull: true }
}, { tableName: "crm_promo_redemptions" });
