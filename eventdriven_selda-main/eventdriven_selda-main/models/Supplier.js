/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Supplier = sequelize.define("Supplier", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  supplierCode: {
    type: DataTypes.STRING(30),
    allowNull: true,
    unique: true
  },
  name: { 
    type: DataTypes.STRING(150), 
    allowNull: false 
  },
  contactPerson: { 
    type: DataTypes.STRING(100), 
    allowNull: true 
  },
  phone: { 
    type: DataTypes.STRING(50), 
    allowNull: true 
  },
  email: { 
    type: DataTypes.STRING(150), 
    allowNull: true,
    validate: {
      isEmailOrEmpty(value) {
        if (value && value.trim() !== '') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            throw new Error('Invalid email format');
          }
        }
      }
    }
  },
  address: { 
    type: DataTypes.TEXT, 
    allowNull: true 
  },
  paymentTerms: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: "Net 30"
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM("Active", "Inactive"),
    allowNull: false,
    defaultValue: "Active"
  }
}, {
  timestamps: true,
  paranoid: true,
  tableName: "scm_suppliers"
});

export { sequelize };
