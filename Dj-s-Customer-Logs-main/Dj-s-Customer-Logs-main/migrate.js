// Safe database setup for Customer Logs: creates the central database if needed and any missing crm_* tables.
// It never drops data (the old `sync({ force: true })` version did, on a database the other modules share).
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import { sequelize, syncDatabase } from "./config/database.js";
import { User } from "./models/userModel.js";

const { database, host, port, username, password } = sequelize.config;

try {
  const connection = await mysql.createConnection({ host, port: port || 3306, user: username, password: password || "" });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.end();
  await sequelize.authenticate();
  await syncDatabase();
  
  // Seed default admin account if it doesn't exist
  const adminEmail = "admin.djs@gmail.com";
  const adminPassword = "admin123";
  
  const existingAdmin = await User.findOne({ where: { email: adminEmail } });
  
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await User.create({
      name: "System Administrator",
      email: adminEmail,
      password: hashedPassword,
      role: "admin",
      status: "active"
    });
    console.log(`✅ Default admin account created: ${adminEmail} / ${adminPassword}`);
  }
  
  console.log(`✅ Customer Logs tables ready in ${database}.`);
  console.log(`📝 Admin Login: ${adminEmail} / ${adminPassword}`);
  console.log(`📝 Staff can register at http://localhost:${process.env.PORT || 3004}/register`);
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sequelize.close().catch(() => {});
}
