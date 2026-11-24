import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// A cash or bank payment for an everyday expense. Posting: Dr expense account, Cr cash/bank account.
// A voided voucher keeps its row; its entry is cancelled by a reversal in void_entry_id.
export const ExpenseVoucher = sequelize.define("ExpenseVoucher", {
  expense_voucher_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  voucher_date: { type: DataTypes.DATEONLY, allowNull: false },
  payee: { type: DataTypes.STRING(150), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  expense_account_id: { type: DataTypes.INTEGER, allowNull: false },
  payment_account_id: { type: DataTypes.INTEGER, allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  status: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: "posted",
    validate: { isIn: [["posted", "void"]] }
  },
  journal_entry_id: { type: DataTypes.INTEGER, allowNull: false },
  void_entry_id: { type: DataTypes.INTEGER, defaultValue: null },
  void_reason: { type: DataTypes.STRING(255), defaultValue: null },
  // Optional receipt: stored under storage/receipts with a random name; the original name is display only.
  receipt_file: { type: DataTypes.STRING(64), defaultValue: null },
  receipt_name: { type: DataTypes.STRING(120), defaultValue: null },
  receipt_mime: { type: DataTypes.STRING(40), defaultValue: null },
  receipt_size: { type: DataTypes.INTEGER, defaultValue: null },
  created_by: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "expense_voucher",
  underscored: true,
  updatedAt: false
});

export { sequelize };
