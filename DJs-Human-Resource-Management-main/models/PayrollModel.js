import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

const Payroll = sequelize.define("Payroll", {
  employeeId: { type: DataTypes.INTEGER, allowNull: false },
  periodStart: { type: DataTypes.DATEONLY, allowNull: false },
  periodEnd: { type: DataTypes.DATEONLY, allowNull: false },
  basicSalary: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  allowances: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  overtime: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  // Total deductions = SSS + PhilHealth + Pag-IBIG + cash advance (older rows only have the total).
  deductions: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  netSalary: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  // From attendance (DTR): days paid (Half Day = 0.5, approved paid leave = 1) and overtime hours.
  daysWorked: { type: DataTypes.DECIMAL(5, 1), allowNull: false, defaultValue: 0 },
  overtimeHours: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 0 },
  // Employee share of the government contributions and the cash advance repaid this payroll.
  sssDeduction: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  philhealthDeduction: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  pagibigDeduction: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  cashAdvance: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  status: {
    type: DataTypes.ENUM("Draft", "Processed", "Paid"),
    allowNull: false,
    defaultValue: "Draft"
  },
  processedBy: { type: DataTypes.INTEGER, allowNull: true },
  paidAt: { type: DataTypes.DATE, allowNull: true },
  // Posting to the Accounting ERP once the payroll is Paid (services/accountingSync.js).
  // null = nothing to post, Pending = queued / retrying, Synced = posted, Failed = needs attention.
  accountingSyncStatus: { type: DataTypes.ENUM("Pending", "Synced", "Failed"), allowNull: true },
  accountingEntryNumber: { type: DataTypes.STRING(40), allowNull: true },
  accountingSyncError: { type: DataTypes.TEXT, allowNull: true },
  accountingSyncAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  accountingNextAttemptAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: "hr_payrolls" });

export default Payroll;
