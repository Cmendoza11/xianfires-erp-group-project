/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const SupplierInvoice = sequelize.define('SupplierInvoice', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  invoiceNumber: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  supplierId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  purchaseOrderId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  goodsReceiptId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  invoiceDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  dueDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  invoiceTotal: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  amountPaid: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: "Synced from Financial System"
  },
  outstandingBalance: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  paymentStatus: {
    // 'Voided' = the bill was voided in Accounting.
    type: DataTypes.ENUM('Pending', 'Partially Paid', 'Paid', 'Overdue', 'Disputed', 'Voided'),
    allowNull: false,
    defaultValue: 'Pending',
    comment: "Synced from Financial System"
  },
  financialSyncStatus: {
    type: DataTypes.ENUM('Pending', 'Synced', 'Failed'),
    allowNull: false,
    defaultValue: 'Pending'
  },
  financialReference: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // Why Accounting refused the bill, or could not be reached (shown with a Failed / Pending status).
  financialSyncError: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true,
  paranoid: false,
  tableName: 'scm_supplier_invoices'
});

export { sequelize };
