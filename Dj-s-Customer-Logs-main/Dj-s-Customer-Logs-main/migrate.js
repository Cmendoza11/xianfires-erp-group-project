// Safe database setup for Customer Logs: creates the central database if needed and any missing crm_* tables.
// It never drops data (the old `sync({ force: true })` version did, on a database the other modules share).
import mysql from "mysql2/promise";
import { sequelize, syncDatabase } from "./config/database.js";

const { database, host, port, username, password } = sequelize.config;

try {
  const connection = await mysql.createConnection({ host, port: port || 3306, user: username, password: password || "" });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.end();
  await sequelize.authenticate();
  await syncDatabase();
  console.log(`✅ Customer Logs tables ready in ${database}. The first account registered at /register can log in as staff.`);
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sequelize.close().catch(() => {});
}
