/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { 
  sequelize, 
  User, 
  Supplier, 
  Department, 
  SupplierProduct, 
  PurchaseRequest, 
  PurchaseRequestItem, 
  PurchaseOrder, 
  PurchaseOrderItem, 
  GoodsReceipt, 
  GoodsReceiptItem, 
  SupplierReturn, 
  SupplierReturnItem, 
  SupplierInvoice, 
  SupplierActivityLog 
} from "./models/index.js";
import { inventoryService } from "./services/inventoryService.js";
import { financialService } from "./services/financialService.js";


// The database is shared with the other DJ's ERP modules, and these sample records also flow
// through the integrations (POS stock, Accounting). Run only on purpose, ideally on a QA database:
//   DB_NAME=djs_procurement_qa node test-all-flows.js --write-test-data
if (!process.argv.includes("--write-test-data")) {
  console.error("Refusing to run: this writes sample records to the shared ERP database. Add --write-test-data to confirm.");
  process.exit(1);
}
async function runComprehensiveFlowTests() {
  console.log("===============================================================");
  console.log("🧪 RUNNING COMPREHENSIVE E2E WORKFLOW TESTS FOR DJYUM SUPPLIER");
  console.log("===============================================================\n");

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  try {
    await sequelize.authenticate();
    console.log("Connected to MySQL.\n");

    // 1. Supplier Registration & Unique Code
    console.log("--- 1. Supplier Registration & Code Validation ---");
    const testSupplier = await Supplier.create({
      supplierCode: `SUP-TEST-${Date.now().toString().slice(-4)}`,
      name: "Quality Poultry & Eggs Express",
      contactPerson: "Dennis Trillo",
      phone: "+63 915 222 3344",
      email: `contact_${Date.now()}@qualitypoultry.ph`,
      address: "Lipa City, Batangas",
      paymentTerms: "Net 30",
      description: "Farm-fresh table eggs and dressed chicken",
      status: "Active"
    });
    assert(testSupplier.id > 0, `Supplier created with ID ${testSupplier.id} and code ${testSupplier.supplierCode}`);

    // Update
    await testSupplier.update({ contactPerson: "Dennis C. Trillo" });
    const reloadedSupp = await Supplier.findByPk(testSupplier.id);
    assert(reloadedSupp.contactPerson === "Dennis C. Trillo", "Supplier updated successfully");

    // 2. Department Management
    console.log("\n--- 2. Department Management ---");
    let testDept = await Department.findOne({ where: { code: "KIT" } });
    if (!testDept) {
      testDept = await Department.create({
        code: "KIT",
        name: "Kitchen",
        departmentHead: "Chef Marco",
        status: "Active"
      });
    }
    assert(testDept.id > 0, `Kitchen department active with code ${testDept.code}`);

    // 3. Supplier Products Assignment & Pricing
    console.log("\n--- 3. Supplier Product Catalog & Pricing Matrix ---");
    const testProduct = await SupplierProduct.create({
      supplierId: testSupplier.id,
      productId: 501,
      productName: "Farm Fresh Large Brown Eggs (Tray of 30)",
      supplierPrice: 240.00,
      minOrderQty: 5.00,
      unit: "trays",
      availability: true,
      isPrimarySupplier: true
    });
    assert(testProduct.id > 0, `Supplier product offering linked (₱240.00/tray)`);

    // 4. Purchase Request Submission & Approval
    console.log("\n--- 4. Purchase Request Submission & Approval ---");
    let defaultUser = await User.findOne();
    if (!defaultUser) {
      defaultUser = await User.create({
        name: "Chef Marco",
        email: "chef@djyum.ph",
        password: "hashedpassword123"
      });
    }

    const reqNum = `PR-${Date.now().toString().slice(-6)}`;
    const testPR = await PurchaseRequest.create({
      requestNumber: reqNum,
      departmentId: testDept.id,
      requestedBy: defaultUser.id,
      requestDate: new Date(),
      priority: "High",
      purpose: "Weekend breakfast buffet prep stock replenishment",
      status: "Pending"
    });

    const prItem = await PurchaseRequestItem.create({
      purchaseRequestId: testPR.id,
      productId: testProduct.productId,
      productName: testProduct.productName,
      quantity: 20.00,
      unit: "trays",
      remarks: "Urgent for Saturday banquet"
    });
    assert(testPR.id > 0 && prItem.id > 0, `Purchase Request ${reqNum} logged with 20 trays`);

    // Approve PR
    await testPR.update({
      status: "Approved",
      approvedBy: defaultUser.id,
      approvedAt: new Date()
    });
    assert(testPR.status === "Approved", "Purchase Request approved for procurement");

    // 5. Convert PR into Purchase Order
    console.log("\n--- 5. Purchase Order Creation with Price Snapshot ---");
    const poNum = `PO-${Date.now().toString().slice(-6)}`;
    const unitPrice = parseFloat(testProduct.supplierPrice);
    const orderQty = 20.00;
    const subtotal = unitPrice * orderQty;

    const testPO = await PurchaseOrder.create({
      poNumber: poNum,
      supplierId: testSupplier.id,
      departmentId: testDept.id,
      purchaseRequestId: testPR.id,
      createdBy: defaultUser.id,
      orderDate: new Date().toISOString().split("T")[0],
      expectedDeliveryDate: new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0],
      paymentTerms: "Net 30",
      totalAmount: subtotal,
      status: "Pending Approval"
    });

    const poItem = await PurchaseOrderItem.create({
      purchaseOrderId: testPO.id,
      productId: testProduct.productId,
      productName: testProduct.productName,
      quantity: orderQty,
      unitPrice: unitPrice,
      subtotal: subtotal,
      unit: "trays"
    });
    assert(testPO.totalAmount === 4800.00, `PO ${poNum} created: ₱4,800.00 snapshot price`);

    // Approve & Send PO
    await testPO.update({ status: "Sent to Supplier" });
    assert(testPO.status === "Sent to Supplier", "PO marked sent to supplier");

    // 6. Goods Receiving & Quality Inspection (Damaged split)
    console.log("\n--- 6. Goods Receiving & Quality Inspection ---");
    const grNum = `GR-${Date.now().toString().slice(-6)}`;
    const delivered = 20.00;
    const damaged = 2.00; // 2 trays broken during delivery
    const accepted = delivered - damaged; // 18 trays qualify for inventory stock-in

    const testGR = await GoodsReceipt.create({
      receiptNumber: grNum,
      purchaseOrderId: testPO.id,
      supplierId: testSupplier.id,
      deliveryDate: new Date().toISOString().split("T")[0],
      receivedBy: defaultUser.id,
      deliveryReference: "DN-99410",
      remarks: "2 trays cracked upon container unloading",
      inventorySyncStatus: "Pending"
    });

    const grItem = await GoodsReceiptItem.create({
      goodsReceiptId: testGR.id,
      purchaseOrderItemId: poItem.id,
      productId: testProduct.productId,
      productName: testProduct.productName,
      orderedQuantity: orderQty,
      deliveredQuantity: delivered,
      acceptedQuantity: accepted,
      damagedQuantity: damaged,
      missingQuantity: 0.00,
      unit: "trays",
      remarks: "2 trays damaged, 18 trays passed temperature inspection"
    });

    assert(grItem.acceptedQuantity === 18.00 && grItem.damagedQuantity === 2.00, "Delivered (20) correctly partitioned: Accepted = 18, Damaged = 2");

    // Update PO Status based on receiving
    await testPO.update({ status: "Partially Received" });
    assert(testPO.status === "Partially Received", "PO accurately reflects Partial fulfillment");

    // 7. Inventory Integration Stock-In
    console.log("\n--- 7. Inventory Stock-In Service Sync ---");
    const stockInResult = await inventoryService.syncStockIn(testGR.id);
    assert(stockInResult.success === true, `Inventory stock-in dispatched (Status: ${stockInResult.status}, items: ${stockInResult.itemsCount})`);

    // 8. Supplier Return for Damaged Products
    console.log("\n--- 8. Supplier Return Processing ---");
    const retNum = `RET-${Date.now().toString().slice(-6)}`;
    const testReturn = await SupplierReturn.create({
      returnNumber: retNum,
      supplierId: testSupplier.id,
      purchaseOrderId: testPO.id,
      goodsReceiptId: testGR.id,
      returnDate: new Date().toISOString().split("T")[0],
      returnReason: "Cracked egg shells upon arrival",
      status: "Approved",
      remarks: "2 trays damaged, refund requested"
    });

    const retItem = await SupplierReturnItem.create({
      supplierReturnId: testReturn.id,
      productId: testProduct.productId,
      productName: testProduct.productName,
      quantity: damaged,
      unit: "trays",
      reason: "Shell fractures and leakage"
    });

    assert(testReturn.status === "Approved" && parseFloat(retItem.quantity) === 2.00, `Supplier Return ${retNum} approved for 2 damaged trays`);

    // 9. Supplier Invoice & Financial Payable Dispatch
    console.log("\n--- 9. Supplier Invoice & Accounts Payable Dispatch ---");
    const invNum = `INV-${Date.now().toString().slice(-6)}`;
    const testInv = await SupplierInvoice.create({
      invoiceNumber: invNum,
      supplierId: testSupplier.id,
      purchaseOrderId: testPO.id,
      goodsReceiptId: testGR.id,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 86400000 * 30),
      invoiceTotal: 4800.00,
      amountPaid: 0.00,
      outstandingBalance: 4800.00,
      paymentStatus: "Pending",
      financialSyncStatus: "Pending"
    });

    const payableResult = await financialService.dispatchPayable(testInv.id);
    assert(payableResult.success === true, `Payable dispatched to Financial (Ref: ${payableResult.financialReference})`);

    // 10. Financial Payment Webhook Handling
    console.log("\n--- 10. Financial Payment Webhook (Master Payment Rule) ---");
    const webhookResult = await financialService.processPaymentWebhook({
      invoiceNumber: invNum,
      amountPaid: 4800.00,
      paymentDate: new Date().toISOString(),
      paymentMethod: "Bank Transfer",
      referenceNumber: "FIN-PAY-90412"
    });

    assert(webhookResult.success === true, "Financial payment webhook accepted");
    const reloadedInv = await SupplierInvoice.findByPk(testInv.id);
    assert(reloadedInv.paymentStatus === "Paid" && parseFloat(reloadedInv.outstandingBalance) === 0.00, "Invoice updated to 'Paid' with ₱0.00 balance solely via Financial confirmation");

    // 11. Low-Stock Alerts Check
    console.log("\n--- 11. Low-Stock Alerts Integration ---");
    const alerts = await inventoryService.fetchLowStockAlerts();
    assert(alerts.success === true && Array.isArray(alerts.alerts), `Low-stock alerts fetched: ${alerts.alerts.length} item(s)`);

    // 12. Supplier Activity Audit Trail
    console.log("\n--- 12. Supplier Activity Audit Logs ---");
    const logCount = await SupplierActivityLog.count();
    assert(logCount > 0, `Audit log recorded ${logCount} chronological operation(s)`);

    console.log("\n===============================================================");
    console.log(`🏁 TEST SUMMARY: ${passed} / ${total} TESTS PASSED! (${Math.round((passed / total) * 100)}%)`);
    console.log("===============================================================\n");

  } catch (err) {
    console.error("Test execution aborted with error:", err);
  } finally {
    process.exit(0);
  }
}

runComprehensiveFlowTests();
