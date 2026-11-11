// Safe database setup for the POS module: creates missing pos_* tables and seed rows.
// It never drops or resets data (the old `sync({ force: true })` version did, on a shared database).
import { initializeDatabase } from "./utils/bootstrap.js";
import { sequelize } from "./models/index.js";

try {
  await initializeDatabase();
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sequelize.close().catch(() => {});
}
