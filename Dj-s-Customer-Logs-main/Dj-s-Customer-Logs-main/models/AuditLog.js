/*
    ERP System - Audit Log Model
    Tracks all actions across modules for compliance & debugging
*/

import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const AuditLog = sequelize.define("AuditLog", {
  auditId: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  module: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: "Which module performed the action (customerLogs, pos, etc)"
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: "CREATE, UPDATE, DELETE, VIEW, REDEEM, etc"
  },
  entityType: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: "Customer, Order, Invoice, etc"
  },
  entityId: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: "ID of the entity being acted upon"
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: "crm_users.id of the user who performed the action (null for other modules)"
  },
  changes: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: "Before/after values for UPDATE actions"
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  ipAddress: {
    type: DataTypes.STRING,
    allowNull: true
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, { tableName: "crm_audit_logs" });

export async function logAudit(auditData) {
  try {
    return await AuditLog.create({
      module: auditData.module,
      action: auditData.action,
      entityType: auditData.entityType,
      entityId: auditData.entityId,
      userId: auditData.userId,
      changes: auditData.changes,
      description: auditData.description,
      ipAddress: auditData.ipAddress
    });
  } catch (error) {
    console.error("❌ Failed to log audit:", error);
  }
}
