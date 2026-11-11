/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import bcrypt from "bcrypt";
import { 
  sequelize, 
  User, 
  Department, 
  Supplier, 
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
import { ownTables } from "./models/ownTables.js";

console.log("===============================================================");
console.log("📦 SEEDING OFFICIAL USER DATA & COMPREHENSIVE SAMPLE RECORDS");
console.log("===============================================================\n");

async function seedData() {
  try {
    await sequelize.authenticate();
    console.log("✅ Connected to MySQL database.\n");

    // 1. Reset tables cleanly
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0;");
    // Only Procurement's own scm_* tables: the database is shared with the other ERP modules.
    const tables = ownTables(sequelize);
    for (const t of tables) {
      await sequelize.query(`TRUNCATE TABLE \`${t}\`;`);
    }
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1;");
    console.log("✅ Cleared all tables for fresh seed.");

    // 2. Seed Default Admin User
    const hashedPassword = await bcrypt.hash("admin123", 10);
    const admin = await User.create({
      name: "DJ's System Administrator",
      email: "admin@gmail.com",
      password: hashedPassword,
      role: "admin"
    });
    console.log(`👤 Seeded Admin: ${admin.email}`);

    // 3. Seed Standard Restaurant Departments
    const depts = await Department.bulkCreate([
      { code: "KIT", name: "Kitchen", departmentHead: "Executive Chef Marco", description: "Food preparation, recipes & kitchen stock requisitions", status: "Active" },
      { code: "PUR", name: "Purchasing", departmentHead: "Purchasing Officer Sarah", description: "Supplier procurement, purchase orders & vendor relations", status: "Active" },
      { code: "INV", name: "Inventory", departmentHead: "Warehouse Manager Alex", description: "Stock-in receiving, quality inspection & storeroom storage", status: "Active" },
      { code: "FIN", name: "Finance", departmentHead: "Finance Head Elena", description: "Payables disbursement, invoice auditing & accounting", status: "Active" },
      { code: "ADM", name: "Administration", departmentHead: "General Manager David", description: "Executive administration & management approvals", status: "Active" }
    ]);
    const kitchenDept = depts[0];
    const purchasingDept = depts[1];
    console.log("🏢 Seeded 5 Restaurant Departments.");

    // 4. Seed the 20 Suppliers provided by user
    const rawSuppliers = [
      {
        code: "SUP-0001",
        name: "Mang Juan Fresh Meat Trading",
        contactPerson: "Juan Dela Cruz",
        phone: "+63 912 345 4567",
        email: "orders@mangjuanmeat.com",
        paymentTerms: "Net 30",
        address: "Poblacion, Gloria, Oriental Mindoro",
        description: "Primary supplier of fresh pork kasim, pork liempo, and beef shank. Delivery every Monday and Thursday."
      },
      {
        code: "SUP-0002",
        name: "Aling Nena's Crispy Corner & Poultry Supply",
        contactPerson: "Nena Santos",
        phone: "+63 923 456 7890",
        email: "sales@alingnenapoultry.com",
        paymentTerms: "Net 15",
        address: "Pinamalayan, Oriental Mindoro",
        description: "Fresh chicken skin, chicken wings, and ground pork. Daily morning deliveries."
      },
      {
        code: "SUP-0003",
        name: "Golden Basket Dry Goods & Spices",
        contactPerson: "Mario Lim",
        phone: "+63 934 567 8901",
        email: "orders@goldenbasket.ph",
        paymentTerms: "COD",
        address: "Calapan City, Oriental Mindoro",
        description: "Cooking oil, all-purpose flour, sugar, iodized salt, and dry seasonings."
      },
      {
        code: "SUP-0004",
        name: "Ocean's Harvest Seafood Supply",
        contactPerson: "Ramon Mercado",
        phone: "+63 945 678 9012",
        email: "harvest@oceansseafood.com",
        paymentTerms: "Net 15",
        address: "Roxas, Oriental Mindoro",
        description: "Fresh squid, boneless milkfish (bangus), and tilapia. Chilled delivery every Tuesday and Friday."
      },
      {
        code: "SUP-0005",
        name: "Oriental Farm Produce & Fresh Veggies",
        contactPerson: "Elena Ramos",
        phone: "+63 956 789 0123",
        email: "supply@orientalfarms.ph",
        paymentTerms: "COD",
        address: "Bongabong, Oriental Mindoro",
        description: "Red onions, native garlic, potatoes, carrots, and fresh calamansi. Direct farm delivery."
      },
      {
        code: "SUP-0006",
        name: "Chef's Secret Sauce & Seasoning Depot",
        contactPerson: "Kenneth Tan",
        phone: "+63 967 890 1234",
        email: "sales@chefssecretsauces.com",
        paymentTerms: "Net 30",
        address: "Batangas City, Batangas",
        description: "Commercial size soy sauce, vinegar, oyster sauce, and fish sauce in gallons."
      },
      {
        code: "SUP-0007",
        name: "EcoPack Solutions & Container Hub",
        contactPerson: "Grace Reyes",
        phone: "+63 978 901 2345",
        email: "orders@ecopacksolutions.ph",
        paymentTerms: "Net 30",
        address: "Calapan City, Oriental Mindoro",
        description: "Biodegradable takeout boxes, paper cups, wooden cutlery, and food-grade packaging bags."
      },
      {
        code: "SUP-0008",
        name: "Golden Grain Rice & Milling Co.",
        contactPerson: "Eduardo Torralba",
        phone: "+63 989 012 3456",
        email: "sales@goldengrainmilling.com",
        paymentTerms: "Net 15",
        address: "Bansud, Oriental Mindoro",
        description: "Sinandomeng rice, premium jasmine rice, and glutinous rice in 25kg and 50kg sacks."
      },
      {
        code: "SUP-0009",
        name: "Creamy Delight Dairy & Beverage Supplies",
        contactPerson: "Sarah Mendoza",
        phone: "+63 990 123 4567",
        email: "orders@creamydelight.ph",
        paymentTerms: "Net 7",
        address: "Lipa City, Batangas",
        description: "Commercial condensed milk, evaporated milk, quick-melt cheese blocks, and whipped cream."
      },
      {
        code: "SUP-0010",
        name: "Baker's Choice Wholesale Supplies",
        contactPerson: "Joseph Castelo",
        phone: "+63 901 234 5678",
        email: "supply@bakerschoice.com",
        paymentTerms: "Net 30",
        address: "San Jose, Occidental Mindoro",
        description: "Crispy breadcrumbs, cornstarch, instant yeast, baking powder, and frying mix formulations."
      },
      {
        code: "SUP-0011",
        name: "Island Gas & Commercial LPG Depot",
        contactPerson: "Arnel Villanueva",
        phone: "+63 915 111 2233",
        email: "orders@islandgaslpg.com",
        paymentTerms: "Net 30",
        address: "Gloria, Oriental Mindoro",
        description: "Commercial 50kg LPG tanks and regulator replacements. On-call priority refill service."
      },
      {
        code: "SUP-0012",
        name: "Fresh Brew Coffee Beans & Syrups",
        contactPerson: "Christine Laurel",
        phone: "+63 926 222 3344",
        email: "sales@freshbrewco.ph",
        paymentTerms: "Net 15",
        address: "Amadeo, Cavite",
        description: "Roasted Arabica and Robusta coffee beans, flavored syrups, and coffee machine cleaning kits."
      },
      {
        code: "SUP-0013",
        name: "Pure Crystal Ice & Cold Storage",
        contactPerson: "Danilo Cruz",
        phone: "+63 937 333 4455",
        email: "dispatch@purecrystalice.com",
        paymentTerms: "COD",
        address: "Pinamalayan, Oriental Mindoro",
        description: "Tube ice bags, crushed ice for beverages, and temporary cold storage services."
      },
      {
        code: "SUP-0014",
        name: "Mindoro Spice & Herb Gardens",
        contactPerson: "Maria Clara Santos",
        phone: "+63 948 444 5566",
        email: "info@mindorospices.ph",
        paymentTerms: "Net 7",
        address: "Socorro, Oriental Mindoro",
        description: "Fresh basil, rosemary, dried bay leaves, black pepper, and chili flakes."
      },
      {
        code: "SUP-0015",
        name: "Prime Cut Frozen Foods Wholesale",
        contactPerson: "Antonio Garcia",
        phone: "+63 959 555 6677",
        email: "orders@primecutfrozen.com",
        paymentTerms: "Net 15",
        address: "Calapan City, Oriental Mindoro",
        description: "Frozen french fries, hotdogs, bacon strips, and processed meat patties."
      },
      {
        code: "SUP-0016",
        name: "Clean & Bright Sanitary Supplies",
        contactPerson: "Teresa Aquino",
        phone: "+63 917 666 7788",
        email: "sales@cleanbrightph.com",
        paymentTerms: "Net 30",
        address: "Batangas City, Batangas",
        description: "Commercial dishwashing liquid, degreasers, hand soap refills, and kitchen paper towels."
      },
      {
        code: "SUP-0017",
        name: "Golden Fry Cooking Oil Distributors",
        contactPerson: "Roberto Gutierrez",
        phone: "+63 928 777 8899",
        email: "supply@goldenfryoil.com",
        paymentTerms: "Net 30",
        address: "Lucena City, Quezon",
        description: "20-liter tin containers of palm oil and coconut oil for high-volume deep frying."
      },
      {
        code: "SUP-0018",
        name: "Tagalog Dairy & Fresh Milk Farm",
        contactPerson: "Beatrice Manalo",
        phone: "+63 939 888 9900",
        email: "fresh@tagalogdairy.ph",
        paymentTerms: "Net 7",
        address: "Victoria, Oriental Mindoro",
        description: "Fresh pasteurized carabao milk, whole cow's milk, and homemade butter."
      },
      {
        code: "SUP-0019",
        name: "Premium Choice Processed Meats",
        contactPerson: "Fernando Poe Jr.",
        phone: "+63 940 999 0011",
        email: "orders@premiumchoicemeats.com",
        paymentTerms: "Net 15",
        address: "San Teodoro, Oriental Mindoro",
        description: "Sweet ham, tocino, longganisa, and tapa for breakfast menu items."
      },
      {
        code: "SUP-0020",
        name: "Asian Feast Noodle & Pasta Factory",
        contactPerson: "Felicity Sy",
        phone: "+63 951 000 1122",
        email: "sales@asianfeastnoodles.ph",
        paymentTerms: "Net 30",
        address: "Biñan, Laguna",
        description: "Fresh egg noodles, canton, bihon, macaroni, and spaghetti pasta in bulk packs."
      }
    ];

    const createdSuppliers = [];
    for (const s of rawSuppliers) {
      const created = await Supplier.create({
        supplierCode: s.code,
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        paymentTerms: s.paymentTerms,
        description: s.description,
        status: "Active"
      });
      createdSuppliers.push(created);
    }
    console.log(`🚚 Seeded all ${createdSuppliers.length} official suppliers.`);

    // 5. Seed the 20 Supplier Products offered
    const rawProducts = [
      { suppIdx: 0, pid: 101, name: "Pork Kasim", price: 240.00, moq: 5.00, unit: "kg", isPrimary: true },
      { suppIdx: 1, pid: 102, name: "Chicken Skin", price: 140.00, moq: 3.00, unit: "kg", isPrimary: true },
      { suppIdx: 2, pid: 103, name: "Cooking Oil", price: 95.00, moq: 10.00, unit: "L", isPrimary: true },
      { suppIdx: 3, pid: 104, name: "Fresh Squid", price: 320.00, moq: 2.00, unit: "kg", isPrimary: true },
      { suppIdx: 4, pid: 105, name: "Red Onions", price: 120.00, moq: 5.00, unit: "kg", isPrimary: true },
      { suppIdx: 5, pid: 106, name: "Soy Sauce Gallon", price: 180.00, moq: 2.00, unit: "container", isPrimary: true },
      { suppIdx: 6, pid: 107, name: "Takeout Meal Box", price: 450.00, moq: 1.00, unit: "pack (100 pcs)", isPrimary: true },
      { suppIdx: 7, pid: 108, name: "Sinandomeng Rice", price: 1250.00, moq: 2.00, unit: "sack (25kg)", isPrimary: true },
      { suppIdx: 8, pid: 109, name: "Condensed Milk 300ml", price: 48.00, moq: 12.00, unit: "can", isPrimary: true },
      { suppIdx: 9, pid: 110, name: "Crispy Breadcrumbs", price: 85.00, moq: 5.00, unit: "kg", isPrimary: true },
      { suppIdx: 10, pid: 111, name: "Commercial LPG Tank Refill 50kg", price: 3800.00, moq: 1.00, unit: "tank", isPrimary: true },
      { suppIdx: 11, pid: 112, name: "Roasted Arabica Coffee Beans", price: 550.00, moq: 2.00, unit: "kg", isPrimary: true },
      { suppIdx: 12, pid: 113, name: "Tube Ice Big Bag", price: 50.00, moq: 5.00, unit: "bag", isPrimary: true },
      { suppIdx: 13, pid: 114, name: "Ground Black Pepper", price: 280.00, moq: 1.00, unit: "kg", isPrimary: true },
      { suppIdx: 14, pid: 115, name: "Shoestring French Fries", price: 160.00, moq: 4.00, unit: "kg", isPrimary: true },
      { suppIdx: 15, pid: 116, name: "Dishwashing Liquid 1 Gallon", price: 220.00, moq: 2.00, unit: "container", isPrimary: true },
      { suppIdx: 16, pid: 117, name: "Deep Fryer Palm Oil 20L", price: 1650.00, moq: 1.00, unit: "container", isPrimary: false },
      { suppIdx: 17, pid: 118, name: "Fresh Carabao Milk 1L", price: 90.00, moq: 5.00, unit: "bottle", isPrimary: true },
      { suppIdx: 18, pid: 119, name: "Pork Tocino", price: 210.00, moq: 3.00, unit: "kg", isPrimary: true },
      { suppIdx: 19, pid: 120, name: "Fresh Egg Noodles", price: 75.00, moq: 5.00, unit: "kg", isPrimary: true }
    ];

    const createdProducts = [];
    for (const p of rawProducts) {
      const supplier = createdSuppliers[p.suppIdx];
      const prod = await SupplierProduct.create({
        supplierId: supplier.id,
        productId: p.pid,
        productName: p.name,
        sku: `SKU-${p.pid}`,
        supplierPrice: p.price,
        minOrderQty: p.moq,
        unit: p.unit,
        availability: true,
        isPrimarySupplier: p.isPrimary
      });
      createdProducts.push(prod);
    }
    console.log(`📦 Seeded all ${createdProducts.length} supplier catalog products.`);

    // 6. Seed Sample Operational Records for Every Module so user can test all pages

    // A. Purchase Requests (Module 5)
    console.log("\n--- Seeding Sample Purchase Requests ---");
    const pr1 = await PurchaseRequest.create({
      requestNumber: "PR-202611-0001",
      departmentId: kitchenDept.id,
      requestedBy: admin.id,
      requestDate: "2026-11-08",
      priority: "High",
      purpose: "Weekend banquet preparation: Pork Kasim and Crispy Chicken Skin stock-up",
      status: "Approved",
      approvedBy: admin.id,
      approvedAt: "2026-11-08 10:30:00"
    });
    await PurchaseRequestItem.create({
      purchaseRequestId: pr1.id,
      productId: 101,
      productName: "Pork Kasim",
      quantity: 20.00,
      unit: "kg",
      remarks: "Fresh chilled meat needed by Friday"
    });
    await PurchaseRequestItem.create({
      purchaseRequestId: pr1.id,
      productId: 102,
      productName: "Chicken Skin",
      quantity: 15.00,
      unit: "kg",
      remarks: "For appetizers"
    });

    const pr2 = await PurchaseRequest.create({
      requestNumber: "PR-202611-0002",
      departmentId: kitchenDept.id,
      requestedBy: admin.id,
      requestDate: "2026-11-10",
      priority: "Urgent",
      purpose: "Kitchen replenishment: LPG Tank Refill and Cooking Oil",
      status: "Pending"
    });
    await PurchaseRequestItem.create({
      purchaseRequestId: pr2.id,
      productId: 111,
      productName: "Commercial LPG Tank Refill 50kg",
      quantity: 2.00,
      unit: "tank",
      remarks: "Main kitchen stove backup"
    });
    await PurchaseRequestItem.create({
      purchaseRequestId: pr2.id,
      productId: 103,
      productName: "Cooking Oil",
      quantity: 30.00,
      unit: "L",
      remarks: "Deep fry station refill"
    });
    console.log("📝 Seeded 2 Purchase Requests (1 Approved, 1 Pending).");

    // B. Purchase Orders (Module 6)
    console.log("\n--- Seeding Sample Purchase Orders ---");
    // PO 1: Mang Juan - Fully Received
    const po1 = await PurchaseOrder.create({
      poNumber: "PO-202611-0001",
      supplierId: createdSuppliers[0].id, // Mang Juan
      departmentId: kitchenDept.id,
      purchaseRequestId: pr1.id,
      orderDate: "2026-11-08",
      expectedDeliveryDate: "2026-11-09",
      createdBy: admin.id,
      approvedBy: admin.id,
      approvedAt: "2026-11-08 14:00:00",
      paymentTerms: "Net 30",
      totalAmount: 4800.00,
      status: "Fully Received"
    });
    const po1Item = await PurchaseOrderItem.create({
      purchaseOrderId: po1.id,
      productId: 101,
      productName: "Pork Kasim",
      quantity: 20.00,
      unitPrice: 240.00,
      subtotal: 4800.00,
      unit: "kg"
    });

    // PO 2: Golden Basket - Partially Received (Demonstrates Quality Inspection & Partial Delivery)
    const po2 = await PurchaseOrder.create({
      poNumber: "PO-202611-0002",
      supplierId: createdSuppliers[2].id, // Golden Basket
      departmentId: kitchenDept.id,
      orderDate: "2026-11-09",
      expectedDeliveryDate: "2026-11-10",
      createdBy: admin.id,
      approvedBy: admin.id,
      approvedAt: "2026-11-09 09:00:00",
      paymentTerms: "COD",
      totalAmount: 2850.00,
      status: "Partially Received"
    });
    const po2Item = await PurchaseOrderItem.create({
      purchaseOrderId: po2.id,
      productId: 103,
      productName: "Cooking Oil",
      quantity: 30.00,
      unitPrice: 95.00,
      subtotal: 2850.00,
      unit: "L"
    });

    // PO 3: Ocean's Harvest - Sent to Supplier (Incoming Delivery)
    const po3 = await PurchaseOrder.create({
      poNumber: "PO-202611-0003",
      supplierId: createdSuppliers[3].id, // Ocean's Harvest
      departmentId: kitchenDept.id,
      orderDate: "2026-11-10",
      expectedDeliveryDate: "2026-11-11",
      createdBy: admin.id,
      approvedBy: admin.id,
      approvedAt: "2026-11-10 08:30:00",
      paymentTerms: "Net 15",
      totalAmount: 3200.00,
      status: "Sent to Supplier"
    });
    await PurchaseOrderItem.create({
      purchaseOrderId: po3.id,
      productId: 104,
      productName: "Fresh Squid",
      quantity: 10.00,
      unitPrice: 320.00,
      subtotal: 3200.00,
      unit: "kg"
    });

    // PO 4: Island Gas - Approved (Ready for dispatch)
    const po4 = await PurchaseOrder.create({
      poNumber: "PO-202611-0004",
      supplierId: createdSuppliers[10].id, // Island Gas
      departmentId: kitchenDept.id,
      orderDate: "2026-11-10",
      expectedDeliveryDate: "2026-11-12",
      createdBy: admin.id,
      approvedBy: admin.id,
      approvedAt: "2026-11-10 11:00:00",
      paymentTerms: "Net 30",
      totalAmount: 7600.00,
      status: "Approved"
    });
    await PurchaseOrderItem.create({
      purchaseOrderId: po4.id,
      productId: 111,
      productName: "Commercial LPG Tank Refill 50kg",
      quantity: 2.00,
      unitPrice: 3800.00,
      subtotal: 7600.00,
      unit: "tank"
    });
    console.log("📑 Seeded 4 Purchase Orders (Fully Received, Partially Received, Sent, Approved).");

    // C. Goods Receipts (Module 7)
    console.log("\n--- Seeding Sample Goods Receipts ---");
    // Receipt 1 for PO 1 (100% clean delivery)
    const gr1 = await GoodsReceipt.create({
      receiptNumber: "GR-202611-0001",
      purchaseOrderId: po1.id,
      supplierId: createdSuppliers[0].id,
      deliveryDate: "2026-11-09",
      receivedBy: admin.id,
      deliveryReference: "DN-MJ-88910",
      remarks: "Complete delivery, fresh quality pork passed meat inspection.",
      inventorySyncStatus: "Synced"
    });
    await GoodsReceiptItem.create({
      goodsReceiptId: gr1.id,
      purchaseOrderItemId: po1Item.id,
      productId: 101,
      productName: "Pork Kasim",
      orderedQuantity: 20.00,
      deliveredQuantity: 20.00,
      acceptedQuantity: 20.00,
      damagedQuantity: 0.00,
      missingQuantity: 0.00,
      unit: "kg",
      remarks: "Chilled meat at 4°C"
    });

    // Receipt 2 for PO 2 (Delivered 20L of 30L; 2L Damaged / Leaking!)
    const gr2 = await GoodsReceipt.create({
      receiptNumber: "GR-202611-0002",
      purchaseOrderId: po2.id,
      supplierId: createdSuppliers[2].id,
      deliveryDate: "2026-11-10",
      receivedBy: admin.id,
      deliveryReference: "DN-GB-40112",
      notes: "Driver only brought 20L out of 30L. 2L container had puncture and leaked.",
      remarks: "2L damaged, 18L accepted into pantry. Balance of 10L to be delivered tomorrow.",
      inventorySyncStatus: "Synced"
    });
    await GoodsReceiptItem.create({
      goodsReceiptId: gr2.id,
      purchaseOrderItemId: po2Item.id,
      productId: 103,
      productName: "Cooking Oil",
      orderedQuantity: 30.00,
      deliveredQuantity: 20.00,
      acceptedQuantity: 18.00,
      damagedQuantity: 2.00,
      missingQuantity: 10.00,
      unit: "L",
      remarks: "2L punctured canister rejected"
    });
    console.log("🚚 Seeded 2 Goods Receipts (demonstrating Accepted vs Damaged split).");

    // D. Supplier Returns (Module 8)
    console.log("\n--- Seeding Sample Supplier Returns ---");
    const ret1 = await SupplierReturn.create({
      returnNumber: "RET-202611-0001",
      supplierId: createdSuppliers[2].id, // Golden Basket
      purchaseOrderId: po2.id,
      goodsReceiptId: gr2.id,
      returnDate: "2026-11-10",
      returnReason: "Punctured 2L container leaking upon truck unloading",
      status: "Returned to Supplier",
      remarks: "Driver acknowledged leakage. Credit memo requested for ₱190.00."
    });
    await SupplierReturnItem.create({
      supplierReturnId: ret1.id,
      productId: 103,
      productName: "Cooking Oil",
      quantity: 2.00,
      unit: "L",
      reason: "Punctured container leakage"
    });
    console.log("🔄 Seeded 1 Supplier Return for damaged cooking oil.");

    // E. Supplier Invoices (Module 9)
    console.log("\n--- Seeding Sample Supplier Invoices & Accounts Payable ---");
    // Invoice 1: Mang Juan - Fully Paid
    await SupplierInvoice.create({
      invoiceNumber: "INV-MJ-2026-001",
      supplierId: createdSuppliers[0].id,
      purchaseOrderId: po1.id,
      goodsReceiptId: gr1.id,
      invoiceDate: "2026-11-09",
      dueDate: "2026-12-09",
      invoiceTotal: 4800.00,
      amountPaid: 4800.00,
      outstandingBalance: 0.00,
      paymentStatus: "Paid",
      financialSyncStatus: "Synced",
      financialReference: "FIN-AP-202611-0081"
    });

    // Invoice 2: Golden Basket - Partially Paid
    await SupplierInvoice.create({
      invoiceNumber: "INV-GB-2026-042",
      supplierId: createdSuppliers[2].id,
      purchaseOrderId: po2.id,
      goodsReceiptId: gr2.id,
      invoiceDate: "2026-11-10",
      dueDate: "2026-11-25",
      invoiceTotal: 2850.00,
      amountPaid: 1500.00,
      outstandingBalance: 1350.00,
      paymentStatus: "Partially Paid",
      financialSyncStatus: "Synced",
      financialReference: "FIN-AP-202611-0094"
    });

    // Invoice 3: Island Gas - Pending Payable (Due Soon)
    await SupplierInvoice.create({
      invoiceNumber: "INV-IG-2026-118",
      supplierId: createdSuppliers[10].id,
      purchaseOrderId: po4.id,
      invoiceDate: "2026-11-10",
      dueDate: "2026-12-10",
      invoiceTotal: 7600.00,
      amountPaid: 0.00,
      outstandingBalance: 7600.00,
      paymentStatus: "Pending",
      financialSyncStatus: "Synced",
      financialReference: "FIN-AP-202611-0105"
    });
    console.log("💰 Seeded 3 Supplier Invoices (Paid, Partially Paid, Pending).");

    // F. Activity Logs
    console.log("\n--- Seeding Chronological Audit Activity Logs ---");
    await SupplierActivityLog.bulkCreate([
      { userId: admin.id, module: "Supplier", action: "Register", entityId: 1, details: { name: "Mang Juan Fresh Meat Trading", code: "SUP-0001" } },
      { userId: admin.id, module: "PurchaseRequest", action: "Create", entityId: 1, details: { requestNumber: "PR-202611-0001", dept: "Kitchen" } },
      { userId: admin.id, module: "PurchaseOrder", action: "Create", entityId: 1, details: { poNumber: "PO-202611-0001", total: 4800.00 } },
      { userId: admin.id, module: "GoodsReceipt", action: "Receive", entityId: 1, details: { receiptNumber: "GR-202611-0001", accepted: 20 } },
      { userId: admin.id, module: "SupplierInvoice", action: "PayableDispatched", entityId: 1, details: { invoiceNumber: "INV-MJ-2026-001", total: 4800.00 } },
      { userId: admin.id, module: "SupplierReturn", action: "Create", entityId: 1, details: { returnNumber: "RET-202611-0001", reason: "Container leak" } }
    ]);
    console.log("🛡️ Seeded Activity Logs.");

    console.log("\n===============================================================");
    console.log("🎉 SEEDING COMPLETED 100% SUCCESSFULLY!");
    console.log("   - 20 Official Suppliers Active");
    console.log("   - 20 Official Supplier Products Linked");
    console.log("   - 2 Purchase Requests");
    console.log("   - 4 Purchase Orders");
    console.log("   - 2 Goods Receipts (Accepted & Damaged)");
    console.log("   - 1 Supplier Return");
    console.log("   - 3 Supplier Invoices (Paid, Partial, Pending)");
    console.log("===============================================================\n");

  } catch (error) {
    console.error("❌ Seeding encountered an error:", error);
  } finally {
    process.exit(0);
  }
}

seedData();
