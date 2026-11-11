import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

const Department = sequelize.define("Department", {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  code: {
    type: DataTypes.STRING,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  headId: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, { tableName: "hr_departments" });

export default Department;
