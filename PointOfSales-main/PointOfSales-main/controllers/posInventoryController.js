/*
  DJYum — inventory management.
  Stock quantities can only change through a validated movement (Stock In,
  Stock Out, Adjustment, Sales Deduction, Void/Reversal), inside a DB
  transaction with a row lock, and every change is recorded.
*/
import { Op, QueryTypes } from "sequelize";
import {
  sequelize,
  Inventory,
  InventoryMovement,
  Product,
  Category,
} from "../models/index.js";
import {
  PosError,
  flashError,
  flashSuccess,
  generateNumber,
  num,
  round2,
  stockStatus,
  toInt,
} from "../utils/pos.js";

const MOVEMENT_TYPES = [
  "Stock In",
  "Stock Out",
  "Sales Deduction",
  "Adjustment",
  "Void/Reversal",
];

const loadProductOptions = () =>
  Product.findAll({
    where: { status: "active", type: "Supply" },
    include: [
      { model: Inventory, as: "inventory", required: false },
      { model: Category, as: "category", attributes: ["id", "name"] },
    ],
    order: [["name", "ASC"]],
  });

const stockRows = async () => {
  const rows = await sequelize.query(
    `SELECT p.id AS productId, p.name, p.price, p.image, p.type,
            c.id AS categoryId, c.name AS categoryName,
            i.id AS inventoryId, i.currentStock, i.minStockLevel, i.unit, i.lastUpdated
     FROM pos_products p
     LEFT JOIN pos_categories c ON c.id = p.categoryId
     LEFT JOIN pos_inventory i ON i.productId = p.id
     WHERE p.status = 'active' AND p.type = 'Supply'
     ORDER BY p.name ASC`,
    { type: QueryTypes.SELECT }
  );

  return rows.map((row) => ({
    ...row,
    currentStock: Number(row.currentStock ?? 0),
    minStockLevel: Number(row.minStockLevel ?? 0),
    price: round2(row.price),
    stockStatus: stockStatus(row.currentStock, row.minStockLevel),
  }));
};

const summarize = (rows) => ({
  totalProducts: rows.length,
  totalUnits: rows.reduce((sum, row) => sum + row.currentStock, 0),
  lowStock: rows.filter((row) => row.stockStatus === "Low Stock").length,
  outOfStock: rows.filter((row) => row.stockStatus === "Out of Stock").length,
  stockValue: round2(
    rows.reduce((sum, row) => sum + row.currentStock * row.price, 0)
  ),
});

const matchesFilters = (row, { q, categoryId, status }) => {
  if (q) {
    const needle = q.toLowerCase();
    if (
      !row.name.toLowerCase().includes(needle) &&
      !(row.categoryName || "").toLowerCase().includes(needle)
    ) {
      return false;
    }
  }
  if (categoryId && Number(row.categoryId) !== Number(categoryId)) return false;
  if (status === "in" && row.stockStatus !== "In Stock") return false;
  if (status === "low" && row.stockStatus !== "Low Stock") return false;
  if (status === "out" && row.stockStatus !== "Out of Stock") return false;
  return true;
};

const readFilters = (query) => ({
  q: String(query.q || "").trim(),
  categoryId: toInt(query.category) || null,
  status: String(query.status || "").trim(),
});

const findInventoryForUpdate = async (productId, t) => {
  const inventory = await Inventory.findOne({
    where: { productId },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  return inventory;
};

export const inventoryOverview = async (req, res, next) => {
  try {
    const filters = readFilters(req.query);
    const allRows = await stockRows();
    const rows = allRows.filter((row) => matchesFilters(row, filters));

    return res.render("pos/inventory/index", {
      title: "Stock Management",
      active: "inventory",
      rows,
      summary: summarize(allRows),
      filters,
      categories: await Category.findAll({
        where: { status: "active" },
        order: [["name", "ASC"]],
      }),
    });
  } catch (error) {
    return next(error);
  }
};

export const lowStockPage = async (req, res, next) => {
  try {
    const rows = (await stockRows()).filter(
      (row) => row.stockStatus === "Low Stock"
    );
    return res.render("pos/inventory/alert", {
      title: "Low Stock Ingredients",
      active: "inventory",
      rows,
      mode: "low",
      summary: summarize(rows),
    });
  } catch (error) {
    return next(error);
  }
};

export const outOfStockPage = async (req, res, next) => {
  try {
    const rows = (await stockRows()).filter(
      (row) => row.stockStatus === "Out of Stock"
    );
    return res.render("pos/inventory/alert", {
      title: "Out of Stock Ingredients",
      active: "inventory",
      rows,
      mode: "out",
      summary: summarize(rows),
    });
  } catch (error) {
    return next(error);
  }
};

export const inventoryDetail = async (req, res, next) => {
  try {
    const productId = toInt(req.params.productId);
    const product = await Product.findByPk(productId, {
      include: [
        { model: Category, as: "category", attributes: ["id", "name"] },
        { model: Inventory, as: "inventory", required: false },
      ],
    });
    if (!product || product.type !== "Supply") {
      flashError(req, "Product not found.");
      return res.redirect("/pos/inventory");
    }

    const movements = await InventoryMovement.findAll({
      where: { productId },
      order: [["createdAt", "DESC"]],
      limit: 60,
    });

    const data = product.toJSON();
    const currentStock = Number(data.inventory?.currentStock ?? 0);
    const minStockLevel = Number(data.inventory?.minStockLevel ?? 0);

    return res.render("pos/inventory/detail", {
      title: data.name,
      active: "inventory",
      product: data,
      inventory: {
        ...(data.inventory || {}),
        currentStock,
        minStockLevel,
        stockStatus: stockStatus(currentStock, minStockLevel),
      },
      stockValue: round2(currentStock * num(data.price)),
      movements,
    });
  } catch (error) {
    return next(error);
  }
};

const movementFormPage = async (req, res, next, mode) => {
  try {
    const products = await loadProductOptions();
    const selected = toInt(req.query.product) || null;
    const titleByMode = {
      in: "Record Stock In",
      out: "Record Stock Out",
      adjust: "Stock Adjustment",
    };
    return res.render("pos/inventory/form", {
      title: titleByMode[mode],
      active: "inventory",
      mode,
      selected,
      products,
    });
  } catch (error) {
    return next(error);
  }
};

export const stockInPage = (req, res, next) => movementFormPage(req, res, next, "in");
export const stockOutPage = (req, res, next) => movementFormPage(req, res, next, "out");
export const adjustmentPage = (req, res, next) =>
  movementFormPage(req, res, next, "adjust");

const requireProduct = async (productId, transaction) => {
  const product = await Product.findByPk(productId, { transaction });
  if (!product || product.type !== "Supply") throw new PosError("Select an ingredient or raw material.");
  if (product.status !== "active") {
    throw new PosError("Archived products cannot receive stock movements.");
  }
  return product;
};

export const stockIn = async (req, res, next) => {
  const productId = toInt(req.body.productId);
  const quantity = Number(req.body.quantity);
  const reason = String(req.body.reason || "").trim();
  const reference = String(req.body.referenceNumber || "").trim();

  if (!Number.isFinite(productId) || productId <= 0) {
    flashError(req, "Select a product.");
    return res.redirect("/pos/inventory/stock-in");
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    flashError(req, "Quantity must be a positive whole number.");
    return res.redirect(`/pos/inventory/stock-in?product=${productId}`);
  }
  if (quantity > 100000) {
    flashError(req, "Quantity is unrealistically large.");
    return res.redirect(`/pos/inventory/stock-in?product=${productId}`);
  }

  try {
    await sequelize.transaction(async (t) => {
      const product = await requireProduct(productId, t);
      let inventory = await findInventoryForUpdate(productId, t);
      if (!inventory) {
        inventory = await Inventory.create(
          {
            productId,
            currentStock: 0,
            minStockLevel: 5,
            unit: "pcs",
            lastUpdated: new Date(),
          },
          { transaction: t }
        );
      }

      const previousStock = Number(inventory.currentStock);
      const newStock = previousStock + quantity;
      await inventory.update(
        { currentStock: newStock, lastUpdated: new Date() },
        { transaction: t }
      );
      await InventoryMovement.create(
        {
          productId,
          productName: product.name,
          type: "Stock In",
          quantity,
          previousStock,
          newStock,
          referenceNumber: reference || generateNumber("IN"),
          reason: reason || "Stock received.",
          performedBy: req.user.id,
          performedByName: req.user.name,
        },
        { transaction: t }
      );
    });

    flashSuccess(req, "Stock In recorded. Inventory updated.");
    return res.redirect("/pos/inventory");
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/inventory/stock-in?product=${productId}`);
    }
    return next(error);
  }
};

export const stockOut = async (req, res, next) => {
  const productId = toInt(req.body.productId);
  const quantity = toInt(req.body.quantity);
  const reason = String(req.body.reason || "").trim();
  const reference = String(req.body.referenceNumber || "").trim();

  if (!Number.isFinite(productId) || productId <= 0) {
    flashError(req, "Select a product.");
    return res.redirect("/pos/inventory/stock-out");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    flashError(req, "Quantity must be a positive whole number.");
    return res.redirect(`/pos/inventory/stock-out?product=${productId}`);
  }

  try {
    await sequelize.transaction(async (t) => {
      const product = await requireProduct(productId, t);
      const inventory = await findInventoryForUpdate(productId, t);
      if (!inventory) throw new PosError("This product has no inventory record.");

      const previousStock = Number(inventory.currentStock);
      if (previousStock < quantity) {
        throw new PosError(
          `Cannot remove ${quantity} ${inventory.unit}. Only ${previousStock} on hand.`
        );
      }

      const newStock = previousStock - quantity;
      await inventory.update(
        { currentStock: newStock, lastUpdated: new Date() },
        { transaction: t }
      );
      await InventoryMovement.create(
        {
          productId,
          productName: product.name,
          type: "Stock Out",
          quantity,
          previousStock,
          newStock,
          referenceNumber: reference || generateNumber("OUT"),
          reason,
          performedBy: req.user.id,
          performedByName: req.user.name,
        },
        { transaction: t }
      );
    });

    flashSuccess(req, "Stock Out recorded. Inventory updated.");
    return res.redirect("/pos/inventory");
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/inventory/stock-out?product=${productId}`);
    }
    return next(error);
  }
};

export const adjustment = async (req, res, next) => {
  const productId = toInt(req.body.productId);
  const newStock = Number(req.body.newStock);
  const reason = String(req.body.reason || "").trim();

  if (!Number.isFinite(productId) || productId <= 0) {
    flashError(req, "Select a product.");
    return res.redirect("/pos/inventory/adjustment");
  }
  if (!Number.isSafeInteger(newStock) || newStock < 0) {
    flashError(req, "Counted stock must be zero or a positive whole number.");
    return res.redirect(`/pos/inventory/adjustment?product=${productId}`);
  }

  try {
    await sequelize.transaction(async (t) => {
      const product = await requireProduct(productId, t);
      const inventory = await findInventoryForUpdate(productId, t);
      if (!inventory) throw new PosError("This product has no inventory record.");

      const previousStock = Number(inventory.currentStock);
      if (previousStock === newStock) {
        throw new PosError("The counted stock already matches the system stock.");
      }

      await inventory.update(
        { currentStock: newStock, lastUpdated: new Date() },
        { transaction: t }
      );
      await InventoryMovement.create(
        {
          productId,
          productName: product.name,
          type: "Adjustment",
          quantity: Math.abs(newStock - previousStock),
          previousStock,
          newStock,
          referenceNumber: generateNumber("ADJ"),
          reason,
          performedBy: req.user.id,
          performedByName: req.user.name,
        },
        { transaction: t }
      );
    });

    flashSuccess(req, "Stock adjustment recorded and inventory updated.");
    return res.redirect("/pos/inventory");
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/inventory/adjustment?product=${productId}`);
    }
    return next(error);
  }
};

export const updateMinLevel = async (req, res, next) => {
  const productId = toInt(req.params.productId);
  const minStockLevel = Number(req.body.minStockLevel);
  if (!Number.isSafeInteger(minStockLevel) || minStockLevel < 0) {
    flashError(req, "Minimum stock level must be zero or a positive number.");
    return res.redirect("/pos/inventory");
  }

  try {
    const item = await Product.findByPk(productId);
    if (!item || item.type !== "Supply") throw new PosError("Select an ingredient.");
    const inventory = await Inventory.findOne({ where: { productId } });
    if (!inventory) {
      flashError(req, "This product has no inventory record.");
      return res.redirect("/pos/inventory");
    }
    await inventory.update({
      minStockLevel,
      lastUpdated: new Date(),
    });
    flashSuccess(req, "Minimum stock level updated.");
    return res.redirect(`/pos/inventory/${productId}`);
  } catch (error) {
    return next(error);
  }
};

export const movementList = async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || '').trim();
    const scope = ['all', 'ingredients'].includes(req.query.scope) ? req.query.scope : 'products';
    const productId = Number(req.query.product) || null;
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const products = await Product.findAll({
      where: scope === 'all' ? {} : { type: scope === 'ingredients' ? 'Supply' : { [Op.ne]: 'Supply' } },
      attributes: ['id', 'name'], order: [['name', 'ASC']],
    });
    const ids = products.filter(row => !productId || row.id === productId).map(row => row.id);
    const where = { productId: { [Op.in]: ids } };
    if (MOVEMENT_TYPES.includes(type)) where.type = type;
    if (type === 'Inbound') where[Op.and] = sequelize.where(sequelize.col('newStock'), Op.gt, sequelize.col('previousStock'));
    if (type === 'Outbound') where[Op.and] = sequelize.where(sequelize.col('newStock'), Op.lt, sequelize.col('previousStock'));
    if (q) where[Op.or] = ['productName', 'performedByName'].map(field => ({ [field]: { [Op.like]: '%' + q + '%' } }));
    if (from || to) {
      const start = from ? new Date(from + 'T00:00:00') : null;
      const end = to ? new Date(to + 'T23:59:59.999') : null;
      if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && start > end)) {
        flashError(req, 'Choose a valid start and end date.');
        return res.redirect('/pos/reports/inventory');
      }
      where.createdAt = {};
      if (start) where.createdAt[Op.gte] = start;
      if (end) where.createdAt[Op.lte] = end;
    }
    const [rows, total] = await Promise.all([
      InventoryMovement.findAll({ where, include: [{ model: Product, as: 'product', include: [{ model: Inventory, as: 'inventory' }] }], order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 300 }),
      InventoryMovement.count({ where }),
    ]);
    const movements = rows.map(row => {
      const item = row.toJSON();
      const delta = Number(item.newStock) - Number(item.previousStock);
      return { ...item, direction: delta > 0 ? 'Inbound' : delta < 0 ? 'Outbound' : 'No Change', inbound: delta > 0, signedQuantity: Math.abs(delta), unit: item.product?.inventory?.unit || 'pcs' };
    });
    const movementProducts = await Product.findAll({ where: { type: { [Op.ne]: 'Supply' }, status: 'active' }, include: [{ model: Inventory, as: 'inventory' }], order: [['name', 'ASC']] });
    const movementDraft = req.session.movementDraft || {};
    delete req.session.movementDraft;
    return res.render('pos/inventory/movements', { title: 'Inventory Reports', active: 'reports-inventory', movementProducts, movementDraft, openMovement: req.query.add === '1', movements, total, shown: movements.length, types: ['Inbound', 'Outbound', ...MOVEMENT_TYPES], products, filters: { q, type, scope, product: productId || '', from, to } });
  } catch (error) { return next(error); }
};

export const productMovementPage = (req, res) => res.redirect('/pos/reports/inventory?add=1');

export const recordProductMovement = async (req, res, next) => {
  try {
    const id = Number(req.body.productId);
    const quantity = Number(req.body.quantity);
    const direction = req.body.direction;
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000 || !['Inbound', 'Outbound'].includes(direction)) throw new PosError('Select a product, direction, positive whole quantity.');
    await sequelize.transaction(async t => {
      const product = await Product.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!product || product.type === 'Supply' || product.status !== 'active') throw new PosError('Select an active menu product.');
      const { Recipe } = await import('../models/index.js');
      if (await Recipe.count({ where: { productId: id }, transaction: t })) throw new PosError('This product uses ingredient-based stock. Record ingredient stock changes instead.');
      const inventory = await findInventoryForUpdate(id, t);
      if (!inventory) throw new PosError('No inventory record exists for this product.');
      const previousStock = Number(inventory.currentStock);
      const newStock = previousStock + (direction === 'Inbound' ? quantity : -quantity);
      if (newStock < 0) throw new PosError('Insufficient product stock for this outbound movement.');
      await inventory.update({ currentStock: newStock, lastUpdated: new Date() }, { transaction: t });
      await InventoryMovement.create({ productId: id, productName: product.name, type: direction === 'Inbound' ? 'Stock In' : 'Stock Out', quantity, previousStock, newStock, referenceNumber: String(req.body.referenceNumber || '').trim().slice(0, 64) || generateNumber('MOV'), reason, performedBy: req.user.id, performedByName: req.user.name }, { transaction: t });
    });
    flashSuccess(req, 'Product movement recorded with balances, user and timestamp.');
    return res.redirect('/pos/reports/inventory');
  } catch (error) {
    if (error instanceof PosError) { req.session.movementDraft = { productId: String(req.body.productId || ''), direction: req.body.direction === 'Outbound' ? 'Outbound' : 'Inbound', quantity: String(req.body.quantity || '').slice(0, 12) }; flashError(req, error.message); return res.redirect('/pos/reports/inventory?add=1'); }
    return next(error);
  }
};
