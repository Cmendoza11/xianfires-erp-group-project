import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const User = sequelize.define("User", {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  role: {
    type: DataTypes.ENUM("admin", "staff", "employee", "visitors"),
    allowNull: false,
    defaultValue: "employee"
  },
  // Link to the employee record this account belongs to (employee self-service).
  employeeId: { type: DataTypes.INTEGER, allowNull: true }
}, { tableName: "hr_users" });

export { sequelize };
export default User;
