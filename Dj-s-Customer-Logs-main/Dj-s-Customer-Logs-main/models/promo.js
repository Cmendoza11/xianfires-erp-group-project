import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// A promo / voucher. With a code, the POS can apply it at checkout (through the Customer Logs API):
// a percent or fixed peso discount, valid between the dates, for a minimum spend and, optionally,
// a number of loyalty points the customer spends to use it.
export const Promo = sequelize.define("Promo", {
  promoId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  mechanics: { type: DataTypes.TEXT, allowNull: false },
  code: { type: DataTypes.STRING(30), allowNull: true, unique: true },
  discountType: { type: DataTypes.ENUM("percent", "fixed"), allowNull: false, defaultValue: "percent" },
  discountValue: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  minimumSpend: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  pointsCost: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  minimumPurchases: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  startDate: { type: DataTypes.DATEONLY, allowNull: false },
  endDate: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.ENUM("active", "inactive"), allowNull: false, defaultValue: "active" }
}, { tableName: "crm_promos" });
