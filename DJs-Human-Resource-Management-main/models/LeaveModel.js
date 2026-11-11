import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

const Leave = sequelize.define("Leave", {
  employeeId: { type: DataTypes.INTEGER, allowNull: false },
  type: {
    type: DataTypes.ENUM(
      "Vacation",
      "Sick",
      "Maternity",
      "Paternity",
      "Emergency",
      "Unpaid"
    ),
    allowNull: false,
    defaultValue: "Vacation"
  },
  startDate: { type: DataTypes.DATEONLY, allowNull: false },
  endDate: { type: DataTypes.DATEONLY, allowNull: false },
  days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  reason: { type: DataTypes.TEXT, allowNull: true },
  status: {
    type: DataTypes.ENUM("Pending", "Approved", "Rejected"),
    allowNull: false,
    defaultValue: "Pending"
  },
  reviewedBy: { type: DataTypes.INTEGER, allowNull: true },
  reviewedAt: { type: DataTypes.DATE, allowNull: true },
  remarks: { type: DataTypes.STRING, allowNull: true }
}, { tableName: "hr_leaves" });

export default Leave;
