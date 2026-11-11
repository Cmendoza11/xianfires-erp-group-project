import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const PromoRedemption = sequelize.define("PromoRedemption", {
  promoId: { type: DataTypes.UUID, allowNull: true },
  promoName: { type: DataTypes.STRING, allowNull: false },
  recordedByUserId: { type: DataTypes.INTEGER, allowNull: true },
  redemptionDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  source: { type: DataTypes.STRING, allowNull: false, defaultValue: "POS" }
}, { tableName: "crm_promo_redemptions" });
