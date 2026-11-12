import { Sequelize } from "sequelize";

// Central DJ's ERP database (shared with the other modules; HR tables use the hr_ prefix).
// DB_PASSWORD is the ERP-wide name; DB_PASS is still accepted for older setups.
export const sequelize = new Sequelize(
  process.env.DB_NAME || "djs_hr",
  process.env.DB_USER || "root",
  process.env.DB_PASSWORD ?? process.env.DB_PASS ?? "",
  {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    dialect: "mysql",
    logging: false
  }
);
