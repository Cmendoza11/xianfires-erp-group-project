import bcrypt from "bcrypt";
import { Sequelize } from "sequelize";
import { sequelize, User } from "./models/index.js";

async function main() {
  console.log("Setting up local database on localhost:3306...");
  
  // 1. Ensure database exists
  const root = new Sequelize("mysql://root:@localhost:3306/", { logging: false });
  await root.query("CREATE DATABASE IF NOT EXISTS djs_procurement;");
  await root.close();
  console.log("Database 'djs_procurement' is ready.");

  // 2. Sync models
  await sequelize.sync();
  console.log("Models synchronized.");

  // 3. Ensure admin@djs.local exists with Djs-FVaVM-Mvu89
  const email = "admin@djs.local";
  const pass = "Djs-FVaVM-Mvu89";
  const hashed = await bcrypt.hash(pass, 10);

  const existing = await User.findOne({ where: { email }, paranoid: false });
  if (existing) {
    await existing.update({ password: hashed, role: "admin", deletedAt: null });
    console.log(`Updated existing account: ${email}`);
  } else {
    await User.create({
      name: "DJ's System Administrator",
      email,
      password: hashed,
      role: "admin"
    });
    console.log(`Created account: ${email}`);
  }

  console.log("\nSetup complete! You can now log in with:");
  console.log(`Email:    ${email}`);
  console.log(`Password: ${pass}\n`);
}

main().catch((err) => {
  console.error("Error setting up local database:", err.message);
  process.exit(1);
});
