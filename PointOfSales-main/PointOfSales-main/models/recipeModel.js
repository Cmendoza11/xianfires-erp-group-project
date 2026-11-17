import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const Recipe = sequelize.define('Recipe', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  productId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'pos_products', key: 'id' } },
  ingredientId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'pos_products', key: 'id' } },
  quantity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
}, { tableName: 'pos_recipes', indexes: [{ unique: true, fields: ['productId', 'ingredientId'] }] });
