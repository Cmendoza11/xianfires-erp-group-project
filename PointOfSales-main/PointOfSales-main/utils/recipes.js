import { Op } from 'sequelize';
import { Recipe, Product, Inventory } from '../models/index.js';
import { PosError } from './pos.js';

// Stock uses whole base units: pcs, grams, ml. Recipes never silently convert units.
export async function recipeStock(productIds, transaction) {
  const recipes = await Recipe.findAll({ where: { productId: productIds }, transaction });
  const ingredientIds = [...new Set(recipes.map(row => row.ingredientId))];
  const ingredients = ingredientIds.length ? await Product.findAll({
    where: { id: ingredientIds }, include: [{ model: Inventory, as: 'inventory' }], transaction,
  }) : [];
  const byId = new Map(ingredients.map(row => [row.id, row]));
  const result = new Map();
  for (const recipe of recipes) {
    const item = byId.get(recipe.ingredientId);
    const stock = item?.status === 'active' && item.type === 'Supply' ? Number(item.inventory?.currentStock || 0) : 0;
    const available = Math.floor(stock / Number(recipe.quantity));
    const existing = result.get(recipe.productId);
    result.set(recipe.productId, { available: Math.min(existing?.available ?? Infinity, available), unit: 'servings' });
  }
  return result;
}

export async function stockRequirements(items, transaction) {
  const recipes = await Recipe.findAll({ where: { productId: items.map(item => item.productId) }, transaction });
  const result = new Map();
  for (const item of items) {
    const rows = recipes.filter(row => row.productId === Number(item.productId));
    const requirements = rows.length ? rows.map(row => ({ id: row.ingredientId, quantity: Number(row.quantity) * Number(item.quantity) })) : [{ id: Number(item.productId), quantity: Number(item.quantity) }];
    for (const row of requirements) result.set(row.id, (result.get(row.id) || 0) + row.quantity);
  }
  const ids = [...result.keys()].sort((a, b) => a - b);
  const products = await Product.findAll({ where: { id: { [Op.in]: ids } }, transaction });
  const byId = new Map(products.map(row => [row.id, row]));
  return ids.map(productId => {
    const product = byId.get(productId);
    if (!product || product.status !== 'active') throw new PosError('An ingredient or product is no longer active.');
    return { productId, productName: product.name, quantity: result.get(productId) };
  });
}
