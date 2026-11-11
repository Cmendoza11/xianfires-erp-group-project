import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// One row per customer activity. activityType is lowercase ("purchase", "refund", "visit", ...).
// sourceModule says who recorded it: "CRM" for staff entries, "POS" for checkout sales.
export const CustomerLog = sequelize.define("CustomerLog", {
  activityType: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  transactionReference: { type: DataTypes.STRING, allowNull: true },
  activityAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  sourceModule: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "CRM" },
  description: { type: DataTypes.TEXT, allowNull: true },
  staff: { type: DataTypes.STRING, allowNull: true },
  metadata: { type: DataTypes.JSON, allowNull: true }
}, {
  tableName: "crm_customer_logs",
  indexes: [
    { fields: ["activityType"] },
    { fields: ["sourceModule", "transactionReference"] },
    { fields: ["activityAt"] }
  ]
});
