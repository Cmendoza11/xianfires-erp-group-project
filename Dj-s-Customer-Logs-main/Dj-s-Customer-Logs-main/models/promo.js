import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Promo = sequelize.define("Promo", {
  promoId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  mechanics: { type: DataTypes.TEXT, allowNull: false },
  minimumPurchases: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  startDate: { type: DataTypes.DATEONLY, allowNull: false },
  endDate: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.ENUM("active", "inactive"), allowNull: false, defaultValue: "active" }
}, { tableName: "crm_promos" });
