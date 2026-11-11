import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

/*
  Messages the POS owes the other DJ's ERP modules (transactional outbox).
  A row is written in the SAME database transaction as the sale or void, so a sale can never be
  saved without its message. utils/erpSync.js then delivers it and retries while the other module
  is offline. One row per (target, event, transaction), so a message is never queued twice.
    target "accounting": sale -> journal entry, void -> reversing entry (Accounting /api/v1)
    target "customers":  sale -> purchase log,  void -> refund log    (Customer Logs /api)
*/
export const IntegrationOutbox = sequelize.define(
  "IntegrationOutbox",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    target: { type: DataTypes.ENUM("accounting", "customers"), allowNull: false },
    event: { type: DataTypes.ENUM("sale", "void"), allowNull: false },
    transactionId: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM("Pending", "Synced", "Failed"), allowNull: false, defaultValue: "Pending" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
    // What the other module answered: the journal entry number, or the customer log id.
    reference: { type: DataTypes.STRING(80), allowNull: true },
    lastError: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    tableName: "pos_integration_outbox",
    indexes: [
      { unique: true, fields: ["target", "event", "transactionId"] },
      { fields: ["status", "nextAttemptAt"] },
    ],
  }
);
