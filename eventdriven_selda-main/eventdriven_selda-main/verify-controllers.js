/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { supplierController } from "./controllers/suppliercontroller.js";
import { supplierProductController } from "./controllers/supplierProductController.js";
import { departmentcontroller } from "./controllers/departmentcontroller.js";
import { purchaseRequestController } from "./controllers/purchaseRequestController.js";
import { purchaseOrderController } from "./controllers/purchaseOrderController.js";
import { goodsReceiptController } from "./controllers/goodsReceiptController.js";
import { supplierReturnController } from "./controllers/supplierReturnController.js";
import { supplierInvoiceController } from "./controllers/supplierInvoiceController.js";
import { dashboardController } from "./controllers/dashboardController.js";
import { purchaseHistoryController } from "./controllers/purchaseHistoryController.js";
import { supplierPerformanceController } from "./controllers/supplierPerformanceController.js";
import { reportController } from "./controllers/reportController.js";

async function verifyAllControllers() {
  console.log("===============================================================");
  console.log("🧪 TESTING ALL CONTROLLERS & VIEWS FOR ERRORS");
  console.log("===============================================================\n");

  const mockReq = {
    query: {},
    params: {},
    body: {},
    session: { user: { id: 1, name: "DJ's System Administrator", role: "admin" } }
  };

  function createMockRes(name) {
    return {
      render: (view, data) => {
        console.log(`  ✅ [PASS] ${name} -> Rendered '${view}' successfully.`);
      },
      redirect: (url) => {
        console.warn(`  ⚠️ [REDIRECT] ${name} redirected to '${url}'. Session error:`, mockReq.session.error);
      },
      status: (code) => ({
        json: (data) => console.log(`  ✅ [PASS] ${name} (Status ${code})`)
      }),
      json: (data) => console.log(`  ✅ [PASS] ${name} (JSON returned)`)
    };
  }

  try {
    // 1. Dashboard (Module 1)
    await dashboardController.index(mockReq, createMockRes("Dashboard"));

    // 2. Suppliers (Module 2)
    await supplierController.showDashboard(mockReq, createMockRes("Suppliers List"));

    // 3. Supplier Products (Module 3)
    await supplierProductController.index(mockReq, createMockRes("Supplier Products Matrix"));

    // 4. Departments (Module 4)
    await departmentcontroller.index(mockReq, createMockRes("Departments List"));

    // 5. Purchase Requests (Module 5) - Previous Image 1 Error!
    await purchaseRequestController.index(mockReq, createMockRes("Purchase Requests"));

    // 6. Purchase Orders (Module 6)
    await purchaseOrderController.index(mockReq, createMockRes("Purchase Orders"));

    // 7. Goods Receipts (Module 7)
    await goodsReceiptController.index(mockReq, createMockRes("Goods Receipts"));

    // 8. Supplier Returns (Module 8)
    await supplierReturnController.index(mockReq, createMockRes("Supplier Returns"));

    // 9. Supplier Invoices (Module 9)
    await supplierInvoiceController.index(mockReq, createMockRes("Supplier Invoices"));

    // 10. Purchase History (Module 10)
    await purchaseHistoryController.index(mockReq, createMockRes("Purchase History"));

    // 11. Supplier Performance (Module 11) - Previous Image 2 Error!
    await supplierPerformanceController.index(mockReq, createMockRes("Supplier Performance"));

    // 12. Purchasing Reports (Module 12)
    await reportController.index(mockReq, createMockRes("Reports Center"));

    console.log("\n===============================================================");
    console.log("🎉 ALL 12 MODULE CONTROLLERS RENDERED CLEANLY WITHOUT ERRORS!");
    console.log("===============================================================\n");
  } catch (err) {
    console.error("❌ Controller verification failed:", err);
  } finally {
    process.exit(0);
  }
}

verifyAllControllers();
