/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Supplier, SupplierProduct, PurchaseOrder, PurchaseOrderItem, GoodsReceipt, GoodsReceiptItem, SupplierInvoice, Department } from "../models/index.js";
import { inventoryService } from "../services/inventoryService.js";
import { financialService } from "../services/financialService.js";

export const integrationController = {
  /**
   * 1. Public API for Peer Systems: Get all offered supplier products
   * Used by Inventory Management System to view available vendor pricing and sources.
   * GET /api/v1/supplier/products
   */
  getSupplierProductsCatalog: async (req, res) => {
    try {
      const offerings = await SupplierProduct.findAll({
        include: [
          {
            model: Supplier,
            as: "Supplier",
            where: { status: "Active" },
            attributes: ["id", "supplierCode", "name", "contactPerson", "contactNumber", "paymentTerms"]
          }
        ],
        order: [["productId", "ASC"], ["isPrimarySupplier", "DESC"], ["supplierPrice", "ASC"]]
      });

      res.json({
        success: true,
        source: "SupplierManagementSystem",
        count: offerings.length,
        data: offerings.map(item => ({
          supplierProductId: item.id,
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          supplierPrice: parseFloat(item.supplierPrice),
          unit: item.unit,
          minimumOrderQuantity: item.minimumOrderQuantity,
          isPrimarySupplier: !!item.isPrimarySupplier,
          supplier: {
            id: item.Supplier.id,
            code: item.Supplier.supplierCode,
            name: item.Supplier.name,
            contactPerson: item.Supplier.contactPerson,
            contactNumber: item.Supplier.contactNumber,
            paymentTerms: item.Supplier.paymentTerms
          }
        }))
      });
    } catch (error) {
      console.error("[IntegrationController] getSupplierProductsCatalog error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * 2. Public API for Peer Systems: Query Purchase Order details by PO Number
   * Used by Financial and Inventory Systems for audit and verification.
   * GET /api/v1/supplier/orders/:poNumber
   */
  getPurchaseOrderForPeers: async (req, res) => {
    try {
      const { poNumber } = req.params;
      const po = await PurchaseOrder.findOne({
        where: { poNumber: poNumber.trim() },
        include: [
          { model: Supplier, as: "Supplier" },
          { model: Department, as: "Department" },
          { model: PurchaseOrderItem, as: "Items" },
          { 
            model: GoodsReceipt, 
            as: "GoodsReceipts",
            include: [{ model: GoodsReceiptItem, as: "Items" }]
          },
          { model: SupplierInvoice, as: "Invoices" }
        ]
      });

      if (!po) {
        return res.status(404).json({ success: false, message: `Purchase order ${poNumber} not found.` });
      }

      res.json({
        success: true,
        source: "SupplierManagementSystem",
        data: {
          id: po.id,
          poNumber: po.poNumber,
          orderDate: po.orderDate,
          expectedDeliveryDate: po.expectedDeliveryDate,
          status: po.status,
          totalAmount: parseFloat(po.totalAmount),
          paymentTerms: po.paymentTerms,
          supplier: po.Supplier ? {
            id: po.Supplier.id,
            code: po.Supplier.supplierCode,
            name: po.Supplier.name,
            email: po.Supplier.email
          } : null,
          department: po.Department ? {
            id: po.Department.id,
            name: po.Department.name,
            code: po.Department.code
          } : null,
          items: (po.Items || []).map(i => ({
            id: i.id,
            productId: i.productId,
            productName: i.productName,
            quantity: parseFloat(i.quantity),
            unit: i.unit,
            unitPrice: parseFloat(i.unitPrice),
            subtotal: parseFloat(i.subtotal)
          })),
          receiptsCount: (po.GoodsReceipts || []).length,
          invoicesCount: (po.Invoices || []).length
        }
      });
    } catch (error) {
      console.error("[IntegrationController] getPurchaseOrderForPeers error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * 3. Webhook: Financial System Payment Confirmation Webhook
   * CRITICAL ARCHITECTURAL RULE:
   * The Supplier System must NEVER independently mark invoices paid.
   * Payment confirmations come exclusively through this financial webhook.
   * POST /api/v1/supplier/payments/webhook
   */
  handlePaymentWebhook: async (req, res) => {
    // Retired: it let anyone mark invoices paid without a key. Payment status is now read from the
    // Accounting ERP (financialService.refreshPayment, run by services/integrationWorker.js).
    res.status(410).json(await financialService.processPaymentWebhook(req.body));
  },

  /**
   * 4. Manual Retry: Re-sync Goods Receipt stock-in to Inventory
   * POST /api/v1/supplier/sync/inventory/:receiptId
   */
  syncInventoryManually: async (req, res) => {
    try {
      const { receiptId } = req.params;
      const result = await inventoryService.syncStockIn(receiptId);
      res.json(result);
    } catch (error) {
      console.error("[IntegrationController] syncInventoryManually error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * 5. Manual Retry: Re-sync Supplier Invoice payable to Financial
   * POST /api/v1/supplier/sync/financial/:invoiceId
   */
  syncFinancialManually: async (req, res) => {
    try {
      const { invoiceId } = req.params;
      const result = await financialService.dispatchPayable(invoiceId);
      res.json(result);
    } catch (error) {
      console.error("[IntegrationController] syncFinancialManually error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * 6. Live Low-Stock Alerts from Inventory System
   * GET /api/v1/supplier/inventory-alerts
   */
  getLowStockAlerts: async (req, res) => {
    try {
      const result = await inventoryService.fetchLowStockAlerts();
      res.json(result);
    } catch (error) {
      console.error("[IntegrationController] getLowStockAlerts error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
};