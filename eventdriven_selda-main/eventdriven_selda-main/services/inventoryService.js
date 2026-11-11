/*
    MIT License

    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
/*
  Procurement <-> POS & Inventory (the DJ's ERP module that owns products and stock).
  - Catalog and low-stock alerts come from the POS inventory API; if the POS app is not running,
    they are read straight from its tables in the shared database (read-only).
  - Deliveries (goods receipts) and supplier returns are sent to the POS API, which records the
    stock movements. Receipt / return numbers make retries safe (the POS applies each once).
  Status on the record: Synced, Pending (POS not reachable; retried by services/integrationWorker.js)
  or Failed (the POS refused it, e.g. an unknown product or a fractional quantity; see the error).
*/
import { QueryTypes } from "sequelize";
import { sequelize, GoodsReceipt, GoodsReceiptItem, PurchaseOrder, Supplier, SupplierReturn, SupplierReturnItem, SupplierActivityLog } from "../models/index.js";
import { ErpApiError, peer } from "./erpClient.js";

const pos = (method, path, body) => peer("POS", 3001, method, path, body);

// Used only when neither the POS API nor its tables exist (e.g. Procurement installed on its own).
const FALLBACK_INVENTORY_CATALOG = [
  { id: 1, name: "Premium Ground Beef Patty (150g)", sku: "INV-BEEF-001", unit: "kg", category: "Meat & Poultry", minStock: 20, currentStock: 45 },
  { id: 2, name: "Brioche Burger Buns", sku: "INV-BUN-002", unit: "pcs", category: "Bakery", minStock: 100, currentStock: 320 },
  { id: 3, name: "Cheddar Cheese Slices", sku: "INV-CHSE-003", unit: "packs", category: "Dairy", minStock: 15, currentStock: 30 },
  { id: 4, name: "Fresh Romaine Lettuce", sku: "INV-VEG-004", unit: "kg", category: "Produce", minStock: 10, currentStock: 25 },
  { id: 5, name: "Cooking Oil 20L Drum", sku: "INV-OIL-005", unit: "drums", category: "Pantry", minStock: 5, currentStock: 2 },
  { id: 6, name: "French Fry Cut Potatoes", sku: "INV-POT-006", unit: "kg", category: "Frozen", minStock: 50, currentStock: 140 },
  { id: 7, name: "Signature BBQ Sauce 5L", sku: "INV-SAU-007", unit: "bottles", category: "Condiments", minStock: 6, currentStock: 4 },
  { id: 8, name: "Food Grade Takeout Boxes", sku: "INV-PKG-008", unit: "boxes", category: "Packaging", minStock: 200, currentStock: 500 }
];

async function posTablesInstalled() {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('pos_products', 'pos_inventory', 'pos_categories')`,
    { type: QueryTypes.SELECT }
  );
  return Number(row.n) === 3;
}

// Read-only view of the POS catalog straight from the shared database.
async function readCatalogFromDatabase() {
  if (!(await posTablesInstalled())) return null;
  const rows = await sequelize.query(
    `SELECT p.id, p.name, p.type, p.price, c.name AS category,
            COALESCE(i.unit, 'pcs') AS unit, COALESCE(i.currentStock, 0) AS currentStock, COALESCE(i.minStockLevel, 0) AS minStock
     FROM pos_products p
     LEFT JOIN pos_categories c ON c.id = p.categoryId
     LEFT JOIN pos_inventory i ON i.productId = p.id
     WHERE p.status = 'active'
     ORDER BY p.name`,
    { type: QueryTypes.SELECT }
  );
  return rows.map((r) => ({
    ...r,
    sku: `POS-${String(r.id).padStart(4, "0")}`,
    price: Number(r.price),
    currentStock: Number(r.currentStock),
    minStock: Number(r.minStock),
    lowStock: Number(r.currentStock) <= Number(r.minStock)
  }));
}

const errorText = (error) => String(error?.message || error).slice(0, 1000);

export const inventoryService = {
  /**
   * 1. Official product catalog from POS & Inventory.
   */
  fetchMasterCatalog: async () => {
    try {
      const data = await pos("GET", "/api/v1/inventory/products");
      return { source: "inventory_live_api", products: data.products || [] };
    } catch {
      const products = await readCatalogFromDatabase().catch(() => null);
      if (products) return { source: "shared_database", products };
    }
    return {
      source: "cached_fallback",
      message: "POS & Inventory is not installed; serving the built-in restaurant catalog.",
      products: FALLBACK_INVENTORY_CATALOG
    };
  },

  /**
   * The POS product id for a supplier product or PO line. Uses the given id when it is a real
   * POS product, else the POS product with the same name, else registers a new stock "Supply"
   * item in the POS. Returns null only when the POS cannot be reached at all.
   */
  resolveProductId: async ({ productId, productName, unit }) => {
    const name = String(productName || "").trim();
    if (await posTablesInstalled()) {
      const id = parseInt(productId, 10);
      if (id) {
        const [byId] = await sequelize.query("SELECT id, name FROM pos_products WHERE id = ?", { replacements: [id], type: QueryTypes.SELECT });
        // The PO / request forms send a placeholder id (101) on new rows, so an id only counts
        // when it belongs to the product the user named.
        if (byId && (!name || byId.name.toLowerCase() === name.toLowerCase())) return byId.id;
      }
      if (name) {
        const [byName] = await sequelize.query("SELECT id FROM pos_products WHERE name = ? ORDER BY id LIMIT 1", { replacements: [name], type: QueryTypes.SELECT });
        if (byName) return byName.id;
      }
    }
    if (!name) return null;
    try {
      const data = await pos("POST", "/api/v1/inventory/products", { name, unit: unit || "kg" });
      return data.product?.id ?? null;
    } catch (error) {
      console.warn(`[InventoryService] Could not register "${name}" in POS: ${error.message}`);
      return null;
    }
  },

  /**
   * 2. Send accepted delivered products to Inventory for stock-in.
   * RULE: Only accepted quantity qualifies (Delivered - Damaged = Accepted). Damaged goods NEVER enter usable stock.
   */
  syncStockIn: async (goodsReceiptId) => {
    const receipt = await GoodsReceipt.findByPk(goodsReceiptId, {
      include: [
        { model: GoodsReceiptItem, as: "Items" },
        { model: PurchaseOrder, as: "PurchaseOrder", include: [{ model: Supplier, as: "Supplier" }] }
      ]
    });
    if (!receipt) return { success: false, error: `Goods receipt #${goodsReceiptId} not found.` };

    const items = (receipt.Items || []).map(item => ({
      goodsReceiptItemId: item.id,
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      deliveredQuantity: parseFloat(item.deliveredQuantity || 0),
      damagedQuantity: parseFloat(item.damagedQuantity || 0),
      acceptedQuantity: parseFloat(item.acceptedQuantity ?? (item.deliveredQuantity - item.damagedQuantity)),
      batchLot: item.batchLotNumber || null,
      expiryDate: item.expiryDate || null
    })).filter(i => i.acceptedQuantity > 0);

    if (!items.length) {
      await receipt.update({ inventorySyncStatus: "Skipped", inventorySyncError: null });
      return { success: true, synced: false, status: "Skipped", itemsCount: 0 };
    }

    let status = "Synced";
    let reference = null;
    let error = null;
    try {
      const res = await pos("POST", "/api/v1/inventory/stock-in", {
        receiptNumber: receipt.receiptNumber,
        purchaseOrderNumber: receipt.PurchaseOrder?.poNumber || null,
        supplierName: receipt.PurchaseOrder?.Supplier?.name || "Unknown Vendor",
        receivedAt: receipt.deliveryDate,
        receiverNotes: receipt.remarks,
        items
      });
      reference = res.stockInReference || receipt.receiptNumber;
    } catch (e) {
      status = e instanceof ErpApiError && !e.retryable ? "Failed" : "Pending";
      error = errorText(e);
      console.warn(`[InventoryService] Stock-in for ${receipt.receiptNumber} ${status === "Pending" ? "queued" : "refused"}: ${error}`);
    }

    await receipt.update({
      inventorySyncStatus: status,
      inventorySyncError: error,
      ...(reference ? { inventorySyncReference: reference } : {})
    });
    await SupplierActivityLog.create({
      module: "InventorySync",
      action: status === "Synced" ? "SyncSuccess" : status === "Pending" ? "SyncQueued" : "SyncFailed",
      entityId: receipt.id,
      details: { receiptNumber: receipt.receiptNumber, itemsCount: items.length, reference, error, syncStatus: status }
    }).catch(() => {});

    return { success: status !== "Failed", synced: status === "Synced", status, stockInReference: reference, itemsCount: items.length, error };
  },

  /**
   * 3. Send return-to-supplier adjustment to Inventory (deduct unusable or returned stock).
   */
  syncReturnStockAdjustment: async (supplierReturnId) => {
    const ret = await SupplierReturn.findByPk(supplierReturnId, {
      include: [
        { model: SupplierReturnItem, as: "Items" },
        { model: Supplier, as: "Supplier" }
      ]
    });
    if (!ret) return { success: false, error: "Supplier return record not found." };

    let status = "Synced";
    let error = null;
    try {
      await pos("POST", "/api/v1/inventory/stock-adjust", {
        returnNumber: ret.returnNumber,
        supplierName: ret.Supplier?.name || "Unknown Supplier",
        reason: ret.returnReason,
        items: (ret.Items || []).map(item => ({
          productId: item.productId,
          productName: item.productName,
          quantityReturned: parseFloat(item.quantity || 0),
          unit: item.unit
        }))
      });
    } catch (e) {
      status = e instanceof ErpApiError && !e.retryable ? "Failed" : "Pending";
      error = errorText(e);
    }

    await ret.update({ inventoryAdjustmentStatus: status, inventorySyncError: error });
    await SupplierActivityLog.create({
      module: "InventoryReturnSync",
      action: status === "Synced" ? "ReturnAdjusted" : status === "Pending" ? "ReturnAdjustQueued" : "ReturnAdjustFailed",
      entityId: ret.id,
      details: { returnNumber: ret.returnNumber, status, error }
    }).catch(() => {});

    return { success: status !== "Failed", synced: status === "Synced", status, error };
  },

  /**
   * 4. Low-stock alerts from POS & Inventory.
   */
  fetchLowStockAlerts: async () => {
    try {
      const data = await pos("GET", "/api/v1/inventory/low-stock-alerts");
      return { success: true, source: "inventory_live_api", alerts: data.alerts || [] };
    } catch {
      const products = await readCatalogFromDatabase().catch(() => null);
      const list = products || (await posTablesInstalled().catch(() => false) ? [] : FALLBACK_INVENTORY_CATALOG);
      const alerts = list
        .filter(item => item.currentStock <= item.minStock)
        .map(item => ({
          productId: item.id,
          productName: item.name,
          category: item.category,
          currentStock: item.currentStock,
          minStock: item.minStock,
          unit: item.unit,
          severity: item.currentStock === 0 ? "Critical" : "Warning"
        }));
      return { success: true, source: products ? "shared_database" : "simulated_cache", alerts };
    }
  }
};
