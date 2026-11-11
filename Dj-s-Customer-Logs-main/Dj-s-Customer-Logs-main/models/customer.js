import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// The one customer master for the whole ERP (POS looks customers up here at checkout).
export const Customer = sequelize.define("Customer", {
  customerId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: { type: DataTypes.STRING, allowNull: false },
  contactNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
  email: { type: DataTypes.STRING, allowNull: true, unique: true },
  address: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.ENUM("ACTIVE", "INACTIVE", "BLOCKED"), allowNull: false, defaultValue: "ACTIVE" },
  // Net amount spent (purchases minus refunds), kept up to date by CustomerLogService.recordLog.
  totalSpent: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  lastPurchaseDate: { type: DataTypes.DATE, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: "crm_customers",
  indexes: [{ fields: ["status"] }]
});
