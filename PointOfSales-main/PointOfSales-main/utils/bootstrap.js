/*
  DJYum — non-destructive database bootstrap.
  Creates the database/tables when missing (never drops or resets), adds the
  Users.role column to older installations, and seeds configuration rows.
*/
import { DataTypes } from "sequelize";
import mysql from "mysql2/promise";
import {
  sequelize,
  Setting,
  RestaurantTable,
  Discount,
  User,
  Category,
  Product,
  Inventory,
} from "../models/index.js";
import { SETTING_DEFAULTS } from "./pos.js";

const DB_NAME = sequelize.config.database;
const DB_HOST = sequelize.config.host || "localhost";
const DB_USER = sequelize.config.username || "root";
const DB_PASS = sequelize.config.password || "";

// Adds columns that exist on a model but not yet in its table (e.g. the ERP integration fields
// added to pos_orders / pos_transactions). Never drops or changes existing columns.
const addMissingColumns = async () => {
  const queryInterface = sequelize.getQueryInterface();
  for (const model of Object.values(sequelize.models)) {
    const table = model.getTableName();
    const existing = await queryInterface.describeTable(table);
    for (const [name, attribute] of Object.entries(model.rawAttributes)) {
      const column = attribute.field || name;
      if (existing[column] || attribute.type?.key === "VIRTUAL") continue;
      const { type, allowNull, defaultValue } = attribute;
      // NOT NULL only when a default can fill existing rows.
      await queryInterface.addColumn(table, column, {
        type,
        allowNull: allowNull !== false || defaultValue === undefined,
        defaultValue,
      });
      console.log(`  ➕ Added ${table}.${column}`);
    }
  }
};

// sync() never changes an existing ENUM, so a value added to a model (e.g. product type "Supply")
// is added to the column here.
const addMissingEnumValues = async () => {
  const queryInterface = sequelize.getQueryInterface();
  for (const model of Object.values(sequelize.models)) {
    const table = model.getTableName();
    const existing = await queryInterface.describeTable(table);
    for (const [name, attribute] of Object.entries(model.rawAttributes)) {
      const values = attribute.type?.values;
      const column = existing[attribute.field || name];
      if (attribute.type?.key !== "ENUM" || !column) continue;
      if (values.every((v) => column.type.includes(`'${v}'`))) continue;
      await queryInterface.changeColumn(table, attribute.field || name, {
        type: attribute.type,
        allowNull: attribute.allowNull !== false,
        defaultValue: attribute.defaultValue,
      });
      console.log(`  ➕ Extended ${table}.${attribute.field || name} with ${values.join(", ")}`);
    }
  }
};

// Stock items Procurement buys for the kitchen. Procurement links its supplier products to these.
const KITCHEN_SUPPLIES = [
  { name: "Yellow Onions", unit: "kg" },
  { name: "Garlic Bulbs", unit: "kg" },
  { name: "Ripe Tomatoes", unit: "kg" },
  { name: "Ground Pork (70/30)", unit: "kg" },
  { name: "Beef Brisket Cuts", unit: "kg" },
  { name: "Fresh Tiger Prawns", unit: "kg" },
];

export const ensureSupplyItem = async ({ name, unit = "pcs", minStockLevel = 10 }, transaction) => {
  const [category] = await Category.findOrCreate({
    where: { name: "Kitchen Supplies" },
    defaults: { description: "Stock items received from Procurement (not sold at the counter)", status: "active" },
    transaction,
  });
  const existing = await Product.findOne({ where: { name }, transaction });
  if (existing) return existing;
  const product = await Product.create(
    { name, categoryId: category.id, price: 0, type: "Supply", availability: false, status: "active" },
    { transaction }
  );
  await Inventory.create(
    { productId: product.id, currentStock: 0, minStockLevel, unit: String(unit || "pcs").slice(0, 24) },
    { transaction }
  );
  return product;
};

const ensureDatabaseExists = async () => {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    port: sequelize.config.port || 3306,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
};

export const initializeDatabase = async () => {
  await ensureDatabaseExists();
  await sequelize.authenticate();

  // Create any missing tables. No force / alter: existing data is preserved.
  await sequelize.sync();
  await addMissingColumns();
  await addMissingEnumValues();

  // Existing installations created before roles existed: add the column safely.
  const queryInterface = sequelize.getQueryInterface();
  const tableName = User.getTableName();
  const userColumns = await queryInterface.describeTable(tableName);
  if (!userColumns.role) {
    await queryInterface.addColumn(tableName, "role", {
      type: DataTypes.ENUM("admin", "cashier", "inventory", "staff"),
      allowNull: false,
      defaultValue: "cashier",
    });
    console.log("✅ Added users.role column (existing users default to cashier)");
  }

  // Seed default restaurant settings only for keys that are missing.
  const existingSettings = await Setting.findAll({ attributes: ["key"] });
  const existingKeys = new Set(existingSettings.map((row) => row.key));
  const missing = Object.entries(SETTING_DEFAULTS).filter(
    ([key]) => !existingKeys.has(key)
  );
  if (missing.length) {
    await Setting.bulkCreate(
      missing.map(([key, value]) => ({ key, value: String(value) })),
      { ignoreDuplicates: true }
    );
  }

  // Seed the dining floor once, so Table Management is usable immediately.
  const tableCount = await RestaurantTable.count();
  if (tableCount === 0) {
    await RestaurantTable.bulkCreate(
      Array.from({ length: 8 }, (_, index) => ({
        name: `Table ${index + 1}`,
        capacity: index < 4 ? 4 : 6,
        location: index < 4 ? "Main Hall" : "Veranda",
        status: "Available",
      }))
    );
  }

  // Seed a few starter discounts; admins can edit or deactivate them.
  const discountCount = await Discount.count();
  if (discountCount === 0) {
    await Discount.bulkCreate([
      { name: "Senior Citizen (20%)", type: "percent", value: 20, status: "active" },
      { name: "PWD Discount (20%)", type: "percent", value: 20, status: "active" },
      { name: "Employee Meal (10%)", type: "percent", value: 10, status: "active" },
      { name: "Promo ₱50 Off", type: "fixed", value: 50, status: "inactive" },
    ]);
  }

  // Seed the kitchen supply items once, so Procurement deliveries have stock items to land in.
  if ((await Product.count({ where: { type: "Supply" } })) === 0) {
    for (const item of KITCHEN_SUPPLIES) await ensureSupplyItem(item);
    console.log(`✅ Seeded ${KITCHEN_SUPPLIES.length} kitchen supply items for Procurement deliveries`);
  }

  const userCount = await User.count();
  if (userCount === 0) {
    console.log(
      "ℹ️  No users yet — the first account registered at /register becomes the Administrator."
    );
  }

  console.log(`✅ Database ready (${DB_NAME}).`);
  return true;
};
