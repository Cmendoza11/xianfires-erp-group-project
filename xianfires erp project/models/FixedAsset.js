import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Equipment the restaurant owns. Straight-line depreciation: (cost - salvage value) / useful life in months.
export const FixedAsset = sequelize.define("FixedAsset", {
  fixed_asset_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  name: { type: DataTypes.STRING(150), allowNull: false },
  acquisition_date: { type: DataTypes.DATEONLY, allowNull: false },
  cost: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  salvage_value: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  useful_life_months: { type: DataTypes.INTEGER, allowNull: false },
  // The purchase entry (Dr equipment, Cr cash/bank); null when the asset was already in the books.
  journal_entry_id: { type: DataTypes.INTEGER, defaultValue: null },
  created_by: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "fixed_asset",
  underscored: true,
  updatedAt: false,
  paranoid: true,
  deletedAt: "deleted_at"
});

// One row per asset per depreciated month; the unique key stops a month from being charged twice.
export const FixedAssetDepreciation = sequelize.define("FixedAssetDepreciation", {
  fixed_asset_depreciation_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  fixed_asset_id: { type: DataTypes.INTEGER, allowNull: false },
  period: { type: DataTypes.STRING(7), allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  journal_entry_id: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: "fixed_asset_depreciation",
  underscored: true,
  updatedAt: false,
  indexes: [{ name: "UQ_FIXED_ASSET_DEPRECIATION_PERIOD", unique: true, fields: ["fixed_asset_id", "period"] }]
});

export { sequelize };
