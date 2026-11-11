/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import express from "express";
import { homePage } from "../controllers/homeController.js";
import { supplierController } from "../controllers/suppliercontroller.js";
import { supplierProductController } from "../controllers/supplierProductController.js";
import { departmentcontroller } from '../controllers/departmentcontroller.js';
import { purchaseRequestController } from "../controllers/purchaseRequestController.js";
import { purchaseOrderController } from "../controllers/purchaseOrderController.js";
import { goodsReceiptController } from "../controllers/goodsReceiptController.js";
import { supplierReturnController } from "../controllers/supplierReturnController.js";
import { supplierInvoiceController } from "../controllers/supplierInvoiceController.js";
import { integrationController } from "../controllers/integrationController.js";
import { dashboardController } from "../controllers/dashboardController.js";
import { purchaseHistoryController } from "../controllers/purchaseHistoryController.js";
import { supplierPerformanceController } from "../controllers/supplierPerformanceController.js";
import { reportController } from "../controllers/reportController.js";

import { 
    loginPage, 
    registerPage, 
    forgotPasswordPage, 
    dashboardPage, 
    loginUser, 
    registerUser, 
    logoutUser 
} from "../controllers/authController.js";

const router = express.Router();

router.get("/", homePage);

// --- Authentication Routes ---
router.get("/login", loginPage);
router.post("/login", loginUser);
router.get("/register", registerPage);
router.post("/register", registerUser);
router.get("/forgot-password", forgotPasswordPage);
router.get("/dashboard", dashboardController.index);
router.get("/logout", logoutUser);

// --- Module 2: Supplier Management Routes ---
router.get("/suppliers", supplierController.showDashboard);
router.post("/suppliers/add", supplierController.insertSupplier);
router.post("/suppliers/update/:id", supplierController.updateSupplier);
router.post("/suppliers/toggle-status/:id", supplierController.toggleStatus);
router.post("/suppliers/delete/:id", supplierController.deleteSupplier);
router.get("/api/suppliers/:id", supplierController.getSupplierDetails);

// Legacy backward-compatibility product routes
router.post('/suppliers/product/add', supplierController.insertProduct);
router.post('/suppliers/product/update/:id', supplierController.updateProduct);
router.post('/suppliers/product/delete/:id', supplierController.deleteProduct);

// --- Module 3: Supplier Products & Pricing Matrix Routes ---
router.get("/supplier-products", supplierProductController.index);
router.post("/supplier-products/add", supplierProductController.store);
router.post("/supplier-products/update/:id", supplierProductController.update);
router.post("/supplier-products/set-primary/:id", supplierProductController.setPrimary);
router.post("/supplier-products/delete/:id", supplierProductController.destroy);

// --- Module 4: Department Management Routes ---
router.get('/departments', departmentcontroller.index);
router.post('/departments/add', departmentcontroller.managedInHr); // departments are managed in HR
router.post('/departments/update/:id', departmentcontroller.managedInHr); // departments are managed in HR
router.post('/departments/toggle-status/:id', departmentcontroller.managedInHr); // departments are managed in HR
router.post('/departments/delete/:id', departmentcontroller.managedInHr); // departments are managed in HR

// --- Module 5: Purchase Requests Management Routes ---
router.get("/purchase-requests", purchaseRequestController.index);
router.post("/purchase-requests/add", purchaseRequestController.store);
router.post("/purchase-requests/approve/:id", purchaseRequestController.approve);
router.post("/purchase-requests/reject/:id", purchaseRequestController.reject);
router.get("/api/purchase-requests/:id", purchaseRequestController.getDetails);

// --- Module 6: Purchase Order Management Routes ---
router.get("/purchase-orders", purchaseOrderController.index);
router.get("/purchase-orders/create", purchaseOrderController.showCreateForm);
router.post("/purchase-orders/create", purchaseOrderController.store);
router.get("/purchase-orders/view/:id", purchaseOrderController.show);
router.post("/purchase-orders/approve/:id", purchaseOrderController.approve);
router.post("/purchase-orders/send/:id", purchaseOrderController.sendToSupplier);
router.post("/purchase-orders/cancel/:id", purchaseOrderController.cancel);

// --- Module 7: Goods Receiving & Delivery Management Routes ---
router.get("/goods-receipts", goodsReceiptController.index);
router.get("/goods-receipts/receive", goodsReceiptController.showCreateForm);
router.post("/goods-receipts/receive", goodsReceiptController.store);
router.get("/goods-receipts/view/:id", goodsReceiptController.show);

// --- Module 8: Supplier Returns Management Routes ---
router.get("/supplier-returns", supplierReturnController.index);
router.post("/supplier-returns/add", supplierReturnController.store);
router.post("/supplier-returns/approve/:id", supplierReturnController.approve);
router.post("/supplier-returns/mark-returned/:id", supplierReturnController.markReturned);
router.post("/supplier-returns/resolve/:id", supplierReturnController.recordResolution);

// --- Module 9: Supplier Invoices & Payables Routes ---
router.get("/supplier-invoices", supplierInvoiceController.index);
router.post("/supplier-invoices/add", supplierInvoiceController.store);
router.get("/api/supplier-invoices/:id", supplierInvoiceController.getDetails);

// --- Modules 13 & 14: Integration Layer (Inventory & Financial Systems) ---
router.get("/api/v1/supplier/products", integrationController.getSupplierProductsCatalog);
router.get("/api/v1/supplier/orders/:poNumber", integrationController.getPurchaseOrderForPeers);
router.post("/api/v1/supplier/payments/webhook", integrationController.handlePaymentWebhook);
router.post("/api/v1/supplier/sync/inventory/:receiptId", integrationController.syncInventoryManually);
router.post("/api/v1/supplier/sync/financial/:invoiceId", integrationController.syncFinancialManually);
router.get("/api/v1/supplier/inventory-alerts", integrationController.getLowStockAlerts);

// --- Module 10: Purchase History Routes ---
router.get("/purchase-history", purchaseHistoryController.index);
router.get("/purchase-history/export/csv", purchaseHistoryController.exportCSV);

// --- Module 11: Supplier Performance Routes ---
router.get("/supplier-performance", supplierPerformanceController.index);

// --- Module 12: Purchasing Reports Routes ---
router.get("/reports", reportController.index);
router.get("/reports/export/csv", reportController.exportCSV);

// Legacy aliases
router.get('/orders/add', purchaseOrderController.showCreateForm);
router.post('/orders/add', purchaseOrderController.store);
router.get('/orders/view/:id', purchaseOrderController.show);

export default router;
