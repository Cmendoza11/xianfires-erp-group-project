/*
  DJYum — POS terminal. The browser handles the cart for speed, but every
  price, stock check and total is recomputed from the database on submit.
*/
import { Op } from "sequelize";
import { recipeStock, stockRequirements } from '../utils/recipes.js';
import { validQuantity } from "../utils/access.js";
import {
  sequelize,
  Product,
  Category,
  Inventory,
  Discount,
  Order,
  OrderItem,
} from "../models/index.js";
import {
  PosError,
  computeTotals,
  discountAmountFor,
  flashError,
  flashSuccess,
  generateNumber,
  getSettings,
  num,
  round2,
  toInt,
} from "../utils/pos.js";

export const terminalPage = async (req, res, next) => {
  try {
    const [products, categories, discounts, settings] = await Promise.all([
      Product.findAll({
        where: { status: "active", availability: true, type: { [Op.ne]: "Supply" } },
        include: [
          { model: Category, as: "category", attributes: ["id", "name"] },
          { model: Inventory, as: "inventory", required: false },
        ],
        order: [["name", "ASC"]],
      }),
      Category.findAll({
        where: { status: "active" },
        order: [["name", "ASC"]],
      }),
      Discount.findAll({ where: { status: "active" }, order: [["name", "ASC"]] }),
      getSettings(),
    ]);

    const preparedStock = await recipeStock(products.map(product => product.id));
    const catalog = products.map((product) => {
      const record = product.toJSON();
      return {
        id: record.id,
        name: record.name,
        price: num(record.price),
        image: record.image || null,
        categoryId: record.categoryId,
        category: record.category?.name || "Uncategorized",
        stock: preparedStock.get(record.id)?.available ?? Number(record.inventory?.currentStock ?? 0),
        unit: preparedStock.get(record.id)?.unit || record.inventory?.unit || "pcs",
        type: record.type,
      };
    });

    // A category holding only stock "Supply" items (e.g. Kitchen Supplies) has nothing to sell here.
    const sellableCategories = new Set(products.map((product) => product.categoryId));
    const supplyRows = await Product.findAll({
      where: { status: "active", type: "Supply" },
      attributes: ["categoryId"],
      raw: true,
    });
    const supplyOnly = new Set(
      supplyRows.map((row) => row.categoryId).filter((id) => !sellableCategories.has(id))
    );

    return res.render("pos/terminal", {
      title: "POS Terminal",
      active: "terminal",
      catalog,
      categories: categories.filter((category) => !supplyOnly.has(category.id)),
      discounts,
      posSettings: settings,
    });
  } catch (error) {
    return next(error);
  }
};

const parseCart = (raw) => {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new PosError("The cart could not be read. Please add the items again.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new PosError("Add at least one product to the cart before creating an order.");
  }

  const merged = new Map();
  for (const line of parsed) {
    const productId = Number(line?.productId);
    const quantity = Number(line?.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new PosError("The cart contains an invalid product.");
    }
    if (!validQuantity(quantity)) {
      throw new PosError("Every order quantity must be a whole number between 1 and 999.");
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  for (const [productId, quantity] of merged) {
    if (quantity > 999) {
      throw new PosError("A single item quantity cannot exceed 999.");
    }
    merged.set(productId, quantity);
  }

  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
};

/** Validates cart lines against live products, availability and stock. */
export const resolveCart = async ({ rawItems, transaction }) => {
  const lines = parseCart(rawItems);
  const ids = lines.map((line) => line.productId);

  const products = await Product.findAll({
    where: { id: ids, status: "active" },
    include: [{ model: Inventory, as: "inventory", required: false }],
    transaction,
  });
  const preparedStock = await recipeStock(ids, transaction);
  const byId = new Map(products.map((product) => [product.id, product]));

  const items = lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new PosError("One of the selected products is no longer available.");
    if (product.type === "Supply") {
      throw new PosError(`"${product.name}" is a stock supply item and cannot be sold.`);
    }
    if (!product.availability) {
      throw new PosError(`"${product.name}" is currently marked unavailable.`);
    }

    const inventory = product.inventory;
    const stock = preparedStock.get(product.id)?.available ?? Number(inventory?.currentStock ?? 0);
    if (!inventory && !preparedStock.has(product.id)) {
      throw new PosError(`No inventory record exists for "${product.name}".`);
    }
    if (stock < line.quantity) {
      throw new PosError(
        `Insufficient stock for "${product.name}". Only ${stock} ${preparedStock.get(product.id)?.unit || inventory?.unit || "pcs"} left.`
      );
    }

    const unitPrice = round2(product.price);
    return {
      productId: product.id,
      productName: product.name,
      unitPrice,
      quantity: line.quantity,
      subtotal: round2(unitPrice * line.quantity),
    };
  });

  const requirements = await stockRequirements(items, transaction);
  for (const item of requirements) {
    const inventory = await Inventory.findOne({ where: { productId: item.productId }, transaction });
    if (!inventory || Number(inventory.currentStock) < item.quantity) throw new PosError('Insufficient combined ingredient stock for ' + item.productName + '.');
  }
  return { items, lines };
};

export const createOrder = async (req, res, next) => {
  const orderType = ["Dine-In", "Take-Out"].includes(req.body.orderType)
    ? req.body.orderType
    : "Dine-In";
  const note = String(req.body.note || "").trim().slice(0, 500);

  try {
    const settings = await getSettings();
    let orderId;

    await sequelize.transaction(async (t) => {
      const { items } = await resolveCart({ rawItems: req.body.items, transaction: t });
      const subtotal = round2(items.reduce((sum, item) => sum + item.subtotal, 0));
      const totals = computeTotals(subtotal, 0, settings);

      const order = await Order.create(
        {
          orderNumber: generateNumber("ORD"),
          cashierId: req.user.id,
          cashierName: req.user.name,
          orderType,
          subtotal: totals.subtotal,
          discountAmount: 0,
          taxAmount: totals.taxAmount,
          serviceCharge: totals.serviceCharge,
          totalAmount: totals.totalAmount,
          status: "Pending",
          note: note || null,
        },
        { transaction: t }
      );

      await OrderItem.bulkCreate(
        items.map((item) => ({ ...item, orderId: order.id })),
        { transaction: t }
      );

      orderId = order.id;
    });

    const preferences = req.session.orderPaymentMethods || {};
    preferences[orderId] = req.body.paymentMethod === 'GCash' ? 'GCash' : 'Cash';
    req.session.orderPaymentMethods = Object.fromEntries(Object.entries(preferences).slice(-32));
    flashSuccess(req, "Order created. Assign a table (for dine-in) and process payment.");
    return res.redirect(`/pos/checkout/${orderId}`);
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect("/pos/terminal");
    }
    return next(error);
  }
};

/** Used by the checkout screen to preview an authorized discount. */
export const previewDiscount = async (discountId, subtotal) => {
  if (!discountId) return { discount: null, amount: 0 };
  const discount = await Discount.findOne({
    where: { id: discountId, status: "active" },
  });
  return { discount, amount: discountAmountFor(discount, subtotal) };
};
