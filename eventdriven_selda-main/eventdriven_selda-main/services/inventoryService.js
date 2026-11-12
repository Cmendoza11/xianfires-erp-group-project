/*
    MIT License

    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
/*
  Procurement <-> POS & Inventory (the DJ's ERP module that owns products and stock). The POS keeps
  its data in its own database, so Procurement reaches it only through the POS inventory API:
  - Catalog and low-stock alerts come from GET /api/v1/inventory/products and /low-stock-alerts.
  - Deliveries (goods receipts) and supplier returns are sent to the POS API, which records the
    stock movements. Receipt / return numbers make retries safe (the POS applies each once).
  - Rows saved while the POS was offline keep the form's placeholder product id; linkCatalogByName()
    (run by services/integrationWorker.js) links them to the POS item with the same name later.
  Status on the record: Synced, Pending (POS not reachable; retried by services/integrationWorker.js)
  or Failed (the POS refused it, e.g. an unknown product or a fractional quantity; see the error).
*/
import { GoodsReceipt, GoodsReceiptItem, PurchaseOrder, PurchaseOrderItem, PurchaseRequestItem, Supplier, SupplierProduct, SupplierReturn, SupplierReturnItem, SupplierActivityLog } from "../models/index.js";
import { ErpApiError, peer } from "./erpClient.js";

const pos = (method, path, body) => peer("POS", 3001, method, path, body);

// Procurement is part of DJ's ERP (not running on its own) when the shared key is configured.
const connectedToPos = () => Boolean(process.env.ERP_INTERNAL_KEY);

// Used only when Procurement runs on its own, without DJ's ERP.
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

// Every POS item, deactivated ones too, so an id is never mistaken for a missing product.
async function fullPosCatalog() {
  const data = await pos("GET", "/api/v1/inventory/products?includeInactive=1");
  return Array.isArray(data?.products) ? data.products : [];
}

const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const findByName = (catalog, name) =>
  catalog.find((p) => sameName(p.name, name) && p.status !== "inactive") || catalog.find((p) => sameName(p.name, name));

const errorText = (error) => String(error?.message || error).slice(0, 1000);

export const inventoryService = {
  /**
   * 1. Official product catalog from POS & Inventory.
   */
  fetchMasterCatalog: async () => {
    try {
      const data = await pos("GET", "/api/v1/inventory/products");
      return { source: "inventory_live_api", products: data.products || [] };
    } catch (error) {
      if (connectedToPos()) {
        return { source: "unavailable", message: `POS & Inventory is not reachable right now (${error.message}).`, products: [] };
      }
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
    let catalog = null;
    try {
      catalog = await fullPosCatalog();
    } catch (error) {
      console.warn(`[InventoryService] POS not reachable while saving "${name}": ${error.message}`);
      return null; // the caller keeps the form's id; linkCatalogByName() fixes it when the POS is back
    }
    const id = parseInt(productId, 10);
    if (id) {
      const byId = catalog.find((p) => p.id === id);
      // The PO / request forms send a placeholder id (101) on new rows, so an id only counts
      // when it belongs to the product the user named.
      if (byId && (!name || sameName(byId.name, name))) return byId.id;
    }
    if (name) {
      const byName = findByName(catalog, name);
      if (byName) return byName.id;
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
   * Links rows whose product id is not a POS item (saved while the POS was offline, or seeded
   * before the POS answered) to the POS item with the same name, registering a Supply item in the
   * POS when there is none. Rows that point at a real POS item are never touched. Throws when the
   * POS is not reachable; returns how many rows were linked.
   */
  linkCatalogByName: async () => {
    if (!connectedToPos()) return 0;
    const catalog = await fullPosCatalog();
    const ids = new Set(catalog.map((p) => p.id));
    let linked = 0;
    for (const model of [SupplierProduct, PurchaseRequestItem, PurchaseOrderItem, GoodsReceiptItem, SupplierReturnItem]) {
      const attributes = ["id", "productId", "productName"].concat(model.rawAttributes.unit ? ["unit"] : []);
      const rows = await model.findAll({ attributes, paranoid: false });
      for (const row of rows) {
        const name = String(row.productName || "").trim();
        if (!name || ids.has(row.productId)) continue;
        let target = findByName(catalog, name);
        if (!target) {
          const data = await pos("POST", "/api/v1/inventory/products", { name, unit: row.unit || "kg" });
          target = data.product;
          if (!target) continue;
          catalog.push(target);
          ids.add(target.id);
        }
        await model.update({ productId: target.id }, { where: { id: row.id }, paranoid: false });
        linked += 1;
      }
    }
    if (linked) console.log(`[InventoryService] Linked ${linked} row(s) to POS items by name.`);
    return linked;
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
    } catch (error) {
      if (connectedToPos()) {
        return { success: true, source: "unavailable", message: `POS & Inventory is not reachable right now (${error.message}).`, alerts: [] };
      }
      const alerts = FALLBACK_INVENTORY_CATALOG
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
      return { success: true, source: "simulated_cache", alerts };
    }
  }
};
