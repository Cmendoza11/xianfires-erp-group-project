/*
    ERP System - Database Configuration
    The web UI and the /api modules share ONE connection (models/db.js) on the Customer Logs database
    (djs_customer_logs). Other DJ's ERP modules reach this data only through the /api routes.
*/
import { sequelize } from "../models/db.js";
import "../models/customerRelations.js";
import "../models/AuditLog.js";

export { sequelize };

export async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connection established");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    throw error;
  }
}

// Adds columns that exist on a model but not yet in its table (e.g. promo codes). Never drops or changes.
async function addMissingColumns() {
  const queryInterface = sequelize.getQueryInterface();
  for (const model of Object.values(sequelize.models)) {
    const table = model.getTableName();
    const existing = await queryInterface.describeTable(table);
    for (const [name, attribute] of Object.entries(model.rawAttributes)) {
      const column = attribute.field || name;
      if (existing[column] || attribute.type?.key === "VIRTUAL") continue;
      const { type, allowNull, defaultValue } = attribute;
      // NOT NULL only when a default can fill existing rows; unique indexes are added separately.
      await queryInterface.addColumn(table, column, {
        type,
        allowNull: allowNull !== false || defaultValue === undefined,
        defaultValue
      });
      if (attribute.unique) {
        await queryInterface.addIndex(table, [column], { unique: true, name: `${table}_${column}_unique` });
      }
      console.log(`  ➕ Added ${typeof table === "string" ? table : table.tableName}.${column}`);
    }
  }
}

// Creates missing crm_* tables and columns only. Never forces or alters existing data.
export async function syncDatabase() {
  try {
    await sequelize.sync();
    await addMissingColumns();
    console.log("✅ Database models synced");
  } catch (error) {
    console.error("❌ Database sync failed:", error);
    throw error;
  }
}
