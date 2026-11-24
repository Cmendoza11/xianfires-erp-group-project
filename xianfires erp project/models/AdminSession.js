import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Login sessions (express-session data), kept in MySQL so a server restart does not log users out.
export const AdminSession = sequelize.define("AdminSession", {
  sid: { type: DataTypes.STRING(128), primaryKey: true },
  data: { type: DataTypes.TEXT("medium"), allowNull: false },
  expires: { type: DataTypes.DATE, allowNull: false }
}, {
  tableName: "admin_session",
  timestamps: false,
  indexes: [{ fields: ["expires"] }]
});
