/*
    ERP System - Centralized Database Configuration
    The web UI and the /api modules share ONE connection (models/db.js) on the central DJ's ERP database.
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

// Creates missing crm_* tables only. Never forces: the database is shared with the other ERP modules.
export async function syncDatabase() {
  try {
    await sequelize.sync();
    console.log("✅ Database models synced");
  } catch (error) {
    console.error("❌ Database sync failed:", error);
    throw error;
  }
}
