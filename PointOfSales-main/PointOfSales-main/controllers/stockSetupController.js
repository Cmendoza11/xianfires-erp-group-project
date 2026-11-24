import { sequelize, Product, Category, Inventory, Recipe } from '../models/index.js';
import { Op } from 'sequelize';
import { flashError, flashSuccess } from '../utils/pos.js';

export const setupPage = async (req, res, next) => {
  try {
    const products = await Product.findAll({ where: { type: { [Op.ne]: 'Supply' }, status: 'active' }, order: [['name', 'ASC']] });
    const ingredients = await Product.findAll({ where: { type: 'Supply', status: 'active' }, include: [{ model: Inventory, as: 'inventory' }], order: [['name', 'ASC']] });
    const selected = products.find(item => item.id === Number(req.query.product)) || products[0];
    const recipe = selected ? await Recipe.findAll({ where: { productId: selected.id } }) : [];
    res.render('pos/inventory/setup', { title: 'Ingredients & Recipes', active: 'inventory', products, selectedProduct: selected?.toJSON(), ingredients: ingredients.map(row => ({ ...row.toJSON(), recipeQuantity: recipe.find(item => item.ingredientId === row.id)?.quantity || '' })), hasRecipe: recipe.length > 0 });
  } catch (error) { next(error); }
};

export const addIngredient = async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const unit = String(req.body.unit || '');
    const minimum = Number(req.body.minStockLevel || 0);
    if (name.length < 2 || name.length > 160 || !['pcs', 'grams', 'ml'].includes(unit) || !Number.isSafeInteger(minimum) || minimum < 0) {
      flashError(req, 'Enter an ingredient name, base unit and nonnegative whole minimum stock.');
      return res.redirect('/pos/inventory/setup');
    }
    await sequelize.transaction(async t => {
      const existing = await Product.findOne({ where: { name }, transaction: t });
      if (existing) throw new Error('An item with this name already exists.');
      const [category] = await Category.findOrCreate({ where: { name: 'Ingredients / Raw Materials' }, defaults: { status: 'active' }, transaction: t });
      const ingredient = await Product.create({ name, type: 'Supply', categoryId: category.id, price: 0, availability: false }, { transaction: t });
      await Inventory.create({ productId: ingredient.id, currentStock: 0, minStockLevel: minimum, unit }, { transaction: t });
    });
    flashSuccess(req, 'Ingredient created with zero stock. Record a Stock In for actual received quantities.');
    res.redirect('/pos/inventory');
  } catch (error) {
    if (error.message === 'An item with this name already exists.') { flashError(req, error.message); return res.redirect('/pos/inventory/setup'); }
    next(error);
  }
};

export const saveRecipe = async (req, res, next) => {
  const productId = Number(req.body.productId);
  try {
    const product = await Product.findByPk(productId);
    if (!product || product.type === 'Supply' || product.status !== 'active') throw new Error('Select an active menu product.');
    const ingredients = await Product.findAll({ where: { type: 'Supply', status: 'active' } });
    const rows = [];
    for (const ingredient of ingredients) {
      const value = req.body[`ingredient_${ingredient.id}`];
      if (value === '' || value == null || Number(value) === 0) continue;
      const quantity = Number(value);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) throw new Error('Recipe quantities must be whole base units from 1 to 100000.');
      rows.push({ productId, ingredientId: ingredient.id, quantity });
    }
    if (!rows.length) throw new Error('Enter at least one ingredient quantity per serving.');
    await sequelize.transaction(async t => {
      await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE });
      await Recipe.destroy({ where: { productId }, transaction: t });
      await Recipe.bulkCreate(rows, { transaction: t });
    });
    flashSuccess(req, 'Recipe saved. Availability and sale deductions now use these ingredients.');
  } catch (error) {
    if (['Select an active menu product.', 'Recipe quantities must be whole base units from 1 to 100000.', 'Enter at least one ingredient quantity per serving.'].includes(error.message)) flashError(req, error.message);
    else return next(error);
  }
  res.redirect(`/pos/inventory/setup?product=${productId}`);
};
