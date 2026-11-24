import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Planned amount for one revenue or expense account in one month (period = YYYY-MM).
export const Budget = sequelize.define("Budget", {
  budget_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  account_id: { type: DataTypes.INTEGER, allowNull: false },
  period: { type: DataTypes.STRING(7), allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false }
}, {
  tableName: "budget",
  underscored: true,
  indexes: [{ name: "UQ_BUDGET_ACCOUNT_PERIOD", unique: true, fields: ["account_id", "period"] }]
});

export { sequelize };
