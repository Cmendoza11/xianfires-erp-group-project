import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Product = sequelize.define(
  "Product",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(160), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    categoryId: { type: DataTypes.INTEGER, allowNull: false },
    image: { type: DataTypes.TEXT("long"), allowNull: true },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    type: {
      // "Supply" = stock-only item received from Procurement (ingredients, packaging); not sold.
      type: DataTypes.ENUM("Food", "Beverage", "Dessert", "Combo", "Other", "Supply"),
      allowNull: false,
      defaultValue: "Food",
    },
    availability: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    status: {
      type: DataTypes.ENUM("active", "archived"),
      allowNull: false,
      defaultValue: "active",
    },
  },
  {
    tableName: "pos_products",
    indexes: [
      { fields: ["categoryId"] },
      { fields: ["status"] },
      { fields: ["name"] },
    ],
  }
);
