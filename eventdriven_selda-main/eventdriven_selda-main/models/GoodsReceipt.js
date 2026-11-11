/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const GoodsReceipt = sequelize.define('GoodsReceipt', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  receiptNumber: {
    type: DataTypes.STRING(30),
    allowNull: false,
    unique: true
  },
  purchaseOrderId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  supplierId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  deliveryDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  receivedBy: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  deliveryReference: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  inventorySyncStatus: {
    type: DataTypes.ENUM('Pending', 'Synced', 'Failed', 'Skipped'),
    allowNull: false,
    defaultValue: 'Pending'
  },
  inventorySyncReference: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // Why the POS refused or could not take this delivery (shown with a Failed / Pending status).
  inventorySyncError: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true,
  paranoid: false,
  tableName: 'scm_goods_receipts'
});

export { sequelize };
