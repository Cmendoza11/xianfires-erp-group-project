/*
  Inventory API for the other DJ's ERP modules (Procurement). The POS owns products and stock;
  Procurement reads the catalog, registers new supply items, and reports deliveries and returns.
  Every route needs the shared X-ERP-Key. Stock changes write the same Inventory Movements the
  POS screens use, so they show up in Inventory > Movements and the inventory reports.

  GET  /api/v1/inventory/products          catalog with stock (all active items, incl. Supply)
  POST /api/v1/inventory/products          { name, unit } -> existing item with that name, or a new Supply item
  GET  /api/v1/inventory/low-stock-alerts  items at or below their minimum stock
  POST /api/v1/inventory/stock-in          goods receipt: { receiptNumber, items:[{ productId, acceptedQuantity }] }
  POST /api/v1/inventory/stock-adjust      supplier return: { returnNumber, items:[{ productId, quantityReturned }] }
  Stock-in and stock-adjust are idempotent on their receipt / return number.
*/
import express from "express";
import { Op } from "sequelize";
import { sequelize, Product, Category, Inventory, InventoryMovement } from "../models/index.js";
import { requireErpKey } from "../middleware/erpKey.js";
import { ensureSupplyItem } from "../utils/bootstrap.js";

const router = express.Router();
router.use(requireErpKey);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("[inventory-api]", error);
    res.status(status).json({ error: { status, message: status === 500 ? "Inventory update failed" : error.message } });
  }
};

const toCatalogItem = (product) => {
  const inventory = product.inventory;
  const currentStock = Number(inventory?.currentStock ?? 0);
  const minStock = Number(inventory?.minStockLevel ?? 0);
  return {
    id: product.id,
    name: product.name,
    sku: `POS-${String(product.id).padStart(4, "0")}`,
    type: product.type,
    category: product.category?.name || null,
    unit: inventory?.unit || "pcs",
    price: Number(product.price),
    currentStock,
    minStock,
    lowStock: inventory ? currentStock <= minStock : false,
  };
};

const loadCatalog = (where = {}) =>
  Product.findAll({
    where: { status: "active", ...where },
    include: [
      { model: Category, as: "category", attributes: ["name"] },
      { model: Inventory, as: "inventory", required: false },
    ],
    order: [["name", "ASC"]],
  });

// Stock is counted in whole units in the POS; a fractional delivery must be fixed at the source.
const wholeQuantity = (value, label) => {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) throw new ApiError(400, `${label}: quantity must be a positive number`);
  if (!Number.isInteger(quantity)) {
    throw new ApiError(400, `${label}: POS stock is counted in whole units, so ${quantity} cannot be received. Record a whole quantity.`);
  }
  return quantity;
};

router.get("/products", wrap(async (req, res) => {
  const products = await loadCatalog();
  res.json({ products: products.map(toCatalogItem) });
}));

router.post("/products", wrap(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) throw new ApiError(400, "name is required");
  const product = await sequelize.transaction(async (t) => ensureSupplyItem({ name: name.slice(0, 160), unit: req.body?.unit }, t));
  const [loaded] = await loadCatalog({ id: product.id });
  res.status(201).json({ product: toCatalogItem(loaded) });
}));

router.get("/low-stock-alerts", wrap(async (req, res) => {
  const products = await loadCatalog();
  const alerts = products.map(toCatalogItem).filter((item) => item.lowStock).map((item) => ({
    productId: item.id,
    productName: item.name,
    category: item.category,
    currentStock: item.currentStock,
    minStock: item.minStock,
    unit: item.unit,
    severity: item.currentStock === 0 ? "Critical" : "Warning",
  }));
  res.json({ alerts });
}));

// Applies quantity changes for one document (receipt or return) exactly once, in one DB transaction.
async function applyMovements({ reference, type, lines, reasonFor, performedByName, direction }) {
  return sequelize.transaction(async (t) => {
    // Lock the inventory rows first, then check for an earlier run, so two retries cannot both apply.
    const ids = [...new Set(lines.map((l) => l.productId))];
    const inventories = await Inventory.findAll({ where: { productId: { [Op.in]: ids } }, transaction: t, lock: t.LOCK.UPDATE });
    const already = await InventoryMovement.count({ where: { referenceNumber: reference, type }, transaction: t });
    if (already) return { duplicate: true, movements: already };

    const products = await Product.findAll({ where: { id: { [Op.in]: ids } }, transaction: t });
    const byProduct = new Map(inventories.map((i) => [i.productId, i]));
    let count = 0;
    for (const line of lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) throw new ApiError(400, `Product #${line.productId} (${line.productName || "unnamed"}) does not exist in POS inventory`);
      let inventory = byProduct.get(product.id);
      if (!inventory) {
        inventory = await Inventory.create({ productId: product.id, currentStock: 0, unit: line.unit || "pcs" }, { transaction: t });
        byProduct.set(product.id, inventory);
      }
      if (!line.quantity) continue;
      const previousStock = Number(inventory.currentStock);
      const newStock = previousStock + direction * line.quantity;
      if (newStock < 0) {
        throw new ApiError(409, `Not enough stock of "${product.name}" to return ${line.quantity} (only ${previousStock} on hand)`);
      }
      await inventory.update({ currentStock: newStock, lastUpdated: new Date() }, { transaction: t });
      await InventoryMovement.create({
        productId: product.id,
        productName: product.name,
        type,
        quantity: line.quantity,
        previousStock,
        newStock,
        referenceNumber: reference,
        reason: reasonFor(product),
        performedBy: null,
        performedByName,
      }, { transaction: t });
      count += 1;
    }
    return { duplicate: false, movements: count };
  });
}

router.post("/stock-in", wrap(async (req, res) => {
  const receiptNumber = String(req.body?.receiptNumber || "").trim();
  if (!receiptNumber) throw new ApiError(400, "receiptNumber is required");
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const lines = items.map((item, i) => ({
    productId: Number(item.productId),
    productName: item.productName,
    unit: item.unit,
    quantity: wholeQuantity(item.acceptedQuantity, `Line ${i + 1} (${item.productName || item.productId})`),
  }));
  const supplier = req.body?.supplierName ? ` from ${req.body.supplierName}` : "";
  const po = req.body?.purchaseOrderNumber ? ` (PO ${req.body.purchaseOrderNumber})` : "";
  const result = await applyMovements({
    reference: receiptNumber,
    type: "Stock In",
    lines,
    direction: 1,
    performedByName: "Procurement",
    reasonFor: () => `Goods receipt ${receiptNumber}${supplier}${po}`,
  });
  res.status(result.duplicate ? 200 : 201).json({ stockInReference: receiptNumber, ...result });
}));

router.post("/stock-adjust", wrap(async (req, res) => {
  const returnNumber = String(req.body?.returnNumber || "").trim();
  if (!returnNumber) throw new ApiError(400, "returnNumber is required");
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const lines = items.map((item, i) => ({
    productId: Number(item.productId),
    productName: item.productName,
    unit: item.unit,
    quantity: wholeQuantity(item.quantityReturned, `Line ${i + 1} (${item.productName || item.productId})`),
  }));
  const supplier = req.body?.supplierName ? ` to ${req.body.supplierName}` : "";
  const result = await applyMovements({
    reference: returnNumber,
    type: "Stock Out",
    lines,
    direction: -1,
    performedByName: "Procurement",
    reasonFor: () => `Supplier return ${returnNumber}${supplier}${req.body?.reason ? `: ${req.body.reason}` : ""}`,
  });
  res.status(result.duplicate ? 200 : 201).json({ adjustmentReference: returnNumber, ...result });
}));

export default router;
