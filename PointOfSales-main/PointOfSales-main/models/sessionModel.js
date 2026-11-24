import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const PosSession = sequelize.define("PosSession", {
  id: { type: DataTypes.STRING(128), primaryKey: true },
  data: { type: DataTypes.JSON, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: "pos_sessions",
  timestamps: false,
  indexes: [{ fields: ["expiresAt"] }],
});
