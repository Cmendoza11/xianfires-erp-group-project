import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

const Attendance = sequelize.define(
  "Attendance",
  {
    employeeId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    checkIn: { type: DataTypes.TIME, allowNull: true },
    checkOut: { type: DataTypes.TIME, allowNull: true },
    status: {
      type: DataTypes.ENUM("Present", "Late", "Absent", "Half Day"),
      allowNull: false,
      defaultValue: "Present"
    },
    lateMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    remarks: { type: DataTypes.STRING, allowNull: true }
  },
  {
    tableName: "hr_attendances",
    indexes: [{ unique: true, fields: ["employeeId", "date"] }]
  }
);

export default Attendance;
