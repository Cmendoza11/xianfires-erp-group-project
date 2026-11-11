/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const PurchaseOrder = sequelize.define('PurchaseOrder', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  poNumber: {
    type: DataTypes.STRING(30),
    allowNull: false,
    unique: true
  },
  supplierId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  purchaseRequestId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  departmentId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  orderDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  expectedDeliveryDate: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  approvedBy: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  paymentTerms: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Net 30'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM(
      'Draft',
      'Pending Approval',
      'Approved',
      'Sent to Supplier',
      'Partially Received',
      'Fully Received',
      'Cancelled'
    ),
    allowNull: false,
    defaultValue: 'Draft'
  },
  totalAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0.00
  }
}, {
  timestamps: true,
  paranoid: true,
  tableName: 'scm_purchase_orders'
});

export { sequelize };
