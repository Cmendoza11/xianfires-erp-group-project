import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// "Forgot password" requests. There is no mail server, so the HR administrator resets the password
// (User Accounts) and gives the user a temporary one. One Pending request per account at a time.
const PasswordRequest = sequelize.define("PasswordRequest", {
  userId: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false }, // the name the person typed (to verify identity)
  note: { type: DataTypes.STRING(255), allowNull: true },
  status: {
    type: DataTypes.ENUM("Pending", "Done", "Dismissed"),
    allowNull: false,
    defaultValue: "Pending"
  },
  handledBy: { type: DataTypes.INTEGER, allowNull: true },
  handledAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: "hr_password_requests" });

export default PasswordRequest;
