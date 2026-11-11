import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Optional per-customer points balance. Without a row, points = net purchases (see the loyalty page).
export const LoyaltyRecord = sequelize.define("LoyaltyRecord", {
  customerId: { type: DataTypes.UUID, allowNull: false, unique: true },
  pointsBalance: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  tier: { type: DataTypes.STRING, allowNull: false, defaultValue: "Regular" }
}, { tableName: "crm_loyalty_records" });
