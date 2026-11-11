/**
 * Safe database setup for DJs HRMS.
 *
 * - Creates the central DJ's ERP database if it does not exist (HR tables use the hr_ prefix).
 * - Creates missing tables (sequelize.sync without force/alter).
 * - Extends users.role and adds users.employeeId when upgrading an older install.
 * - Seeds standard departments and asks for the initial administrator account.
 *
 * Existing rows are never dropped or reset.
 */
import { Sequelize, DataTypes } from "sequelize";
import inquirer from "inquirer";
import bcrypt from "bcrypt";

import { sequelize, User, Employee, Department, syncDatabase } from "./models/index.js";

const DB_NAME = process.env.DB_NAME || "xianfires_erp";
const DB_USER = process.env.DB_USER || "root";
const DB_PASS = process.env.DB_PASSWORD ?? process.env.DB_PASS ?? "";
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || 3306;

const rootSequelize = new Sequelize("", DB_USER, DB_PASS, {
  host: DB_HOST,
  port: Number(DB_PORT),
  dialect: "mysql",
  logging: false
});

const run = async () => {
  await rootSequelize.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
  console.log(`✅ Database "${DB_NAME}" is available`);

  await syncDatabase();
  console.log("✅ Tables are in sync (no existing data was modified)");

  const queryInterface = sequelize.getQueryInterface();
  const tableName = User.getTableName();
  const columns = await queryInterface.describeTable(tableName);

  if (!String(columns.role?.type || "").includes("employee")) {
    await queryInterface.changeColumn(tableName, "role", {
      type: DataTypes.ENUM("admin", "staff", "employee", "visitors"),
      allowNull: false,
      defaultValue: "employee"
    });
    console.log("✅ users.role extended with the employee role");
  }

  if (!columns.employeeId) {
    await queryInterface.addColumn(tableName, "employeeId", {
      type: DataTypes.INTEGER,
      allowNull: true
    });
    try {
      await queryInterface.addConstraint(tableName, {
        fields: ["employeeId"],
        type: "foreign key",
        name: "hr_users_employeeId_fk",
        references: { table: Employee.getTableName(), field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE"
      });
    } catch {
      console.log("ℹ️  users.employeeId added without a foreign-key constraint");
    }
    console.log("✅ users.employeeId added for employee self-service");
  }

  await User.update({ role: "employee" }, { where: { role: "visitors" } });

  // HR owns the ERP's departments; Procurement mirrors this list for purchase requests.
  if ((await Department.count()) === 0) {
    await Department.bulkCreate([
      { name: "Human Resources", code: "HR" },
      { name: "Finance", code: "FIN" },
      { name: "Information Technology", code: "IT" },
      { name: "Operations", code: "OPS" },
      { name: "Sales", code: "SALES" },
      { name: "Kitchen", code: "KIT" },
      { name: "Purchasing", code: "PUR" },
      { name: "Inventory", code: "INV" },
      { name: "Administration", code: "ADM" }
    ]);
    console.log("✅ Default departments seeded");
  }

  if ((await User.count({ where: { role: "admin" } })) === 0) {
    let name = process.env.ADMIN_NAME || "System Administrator";
    let email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    let password = process.env.ADMIN_PASSWORD || "";

    if (!email || !password) {
      const answers = await inquirer.prompt([
        { type: "input", name: "name", message: "Administrator name:", default: name },
        {
          type: "input",
          name: "email",
          message: "Administrator email:",
          validate: (value) =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()) || "Enter a valid email address"
        },
        {
          type: "password",
          name: "password",
          mask: "*",
          message: "Administrator password (min 8 characters):",
          validate: (value) =>
            String(value).length >= 8 || "Password must be at least 8 characters"
        }
      ]);
      name = answers.name;
      email = String(answers.email).trim().toLowerCase();
      password = answers.password;
    }

    if (password.length < 8) {
      console.log("⚠️  Administrator seed skipped: password must be at least 8 characters.");
    } else {
      const existing = await User.findOne({ where: { email }, order: [["id", "ASC"]] });
      if (existing) {
        await existing.update({ role: "admin" });
        console.log(
          `✅ Existing account ${email} promoted to administrator (password left unchanged)`
        );
      } else {
        await User.create({
          name,
          email,
          password: await bcrypt.hash(password, 10),
          role: "admin"
        });
        console.log(`✅ Administrator account created for ${email}`);
      }
    }
  } else {
    console.log("✅ Administrator account already exists");
  }

  console.log("\nDone. Start the app with: npm run xian\n");
};

run()
  .catch((err) => {
    console.error("❌ Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
    await rootSequelize.close().catch(() => {});
  });
