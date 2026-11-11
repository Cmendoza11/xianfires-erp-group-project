/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import bcrypt from "bcrypt";
import { sequelize, User, Department } from "./models/index.js";
import { ownTables } from "./models/ownTables.js";
import { syncDepartmentsFromHr } from "./services/hrDirectory.js";

console.log("===============================================================");
console.log("🧹 RESETTING & CLEARING DATABASE FOR DJYUM SUPPLIER SYSTEM");
console.log("===============================================================\n");

try {
  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database.\n");

  // 1. Temporarily disable foreign key checks for clean truncation
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0;");

  // Only Procurement's own scm_* tables: the database is shared with the other ERP modules.
  const tablesToTruncate = ownTables(sequelize);

  for (const table of tablesToTruncate) {
    try {
      await sequelize.query(`TRUNCATE TABLE \`${table}\`;`);
      console.log(`  🗑️  Cleared table: ${table}`);
    } catch (err) {
      console.warn(`  ⚠️  Table ${table} could not be truncated directly: ${err.message}`);
    }
  }

  // 2. Re-enable foreign key checks
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 1;");
  console.log("\n✅ All transaction and operational data cleared to 0 records!");

  // 3. Re-seed default Administrator Account
  console.log("\n--- Seeding Default Admin Account ---");
  const hashedPassword = await bcrypt.hash("admin123", 10);
  const admin = await User.create({
    name: "DJ's System Administrator",
    email: "admin@gmail.com",
    password: hashedPassword,
    role: "admin"
  });
  console.log(`  👤 Admin User created: ${admin.email} (Password: admin123)`);

  // 4. Re-seed Standard Restaurant Departments
  console.log("\n--- Seeding Standard Restaurant Departments ---");
  const mirrored = await syncDepartmentsFromHr();
  if (mirrored === null) {
    await Department.bulkCreate([
      { code: "KIT", name: "Kitchen", status: "Active" },
      { code: "PUR", name: "Purchasing", status: "Active" },
      { code: "INV", name: "Inventory", status: "Active" },
      { code: "FIN", name: "Finance", status: "Active" },
      { code: "ADM", name: "Administration", status: "Active" }
    ]);
  }
  console.log("  🏢 Seeded 5 standard departments: Kitchen (KIT), Purchasing (PUR), Inventory (INV), Finance (FIN), Administration (ADM).");

  console.log("\n===============================================================");
  console.log("🎉 DATABASE IS NOW FRESH & READY FOR MANUAL TESTING!");
  console.log("   - Suppliers: 0 (Fresh)");
  console.log("   - Products: 0 (Fresh)");
  console.log("   - Purchase Requests: 0 (Fresh)");
  console.log("   - Purchase Orders: 0 (Fresh)");
  console.log("   - Goods Receipts: 0 (Fresh)");
  console.log("   - Returns: 0 (Fresh)");
  console.log("   - Invoices: 0 (Fresh)");
  console.log("===============================================================\n");

} catch (error) {
  console.error("❌ Reset encountered an error:", error);
} finally {
  process.exit(0);
}
