/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { 
  sequelize, 
  GoodsReceipt, 
  GoodsReceiptItem, 
  PurchaseOrder, 
  PurchaseOrderItem, 
  Supplier, 
  User, 
  SupplierActivityLog 
} from "../models/index.js";
import { inventoryService } from "../services/inventoryService.js";

export const goodsReceiptController = {
  // 1. List Goods Receipts with filters
  index: async (req, res) => {
    try {
      const { search, supplierId, syncStatus } = req.query;
      const whereClause = {};

      if (supplierId && supplierId !== 'All') {
        whereClause.supplierId = supplierId;
      }
      if (syncStatus && syncStatus !== 'All') {
        whereClause.inventorySyncStatus = syncStatus;
      }
      if (search && search.trim() !== '') {
        const query = `%${search.trim()}%`;
        whereClause[Op.or] = [
          { receiptNumber: { [Op.like]: query } },
          { deliveryReference: { [Op.like]: query } },
          { remarks: { [Op.like]: query } }
        ];
      }

      const receipts = await GoodsReceipt.findAll({
        where: whereClause,
        include: [
          { model: PurchaseOrder, as: 'PurchaseOrder' },
          { model: Supplier, as: 'Supplier' },
          { model: User, as: 'Receiver', attributes: ['name', 'email'] },
          { model: GoodsReceiptItem, as: 'Items' }
        ],
        order: [['createdAt', 'DESC']]
      });

      const suppliers = await Supplier.findAll({ where: { status: 'Active' }, order: [['name', 'ASC']] });

      // KPI Counts
      const totalReceipts = await GoodsReceipt.count();
      const allItems = await GoodsReceiptItem.findAll();
      const totalAcceptedQty = allItems.reduce((sum, item) => sum + parseFloat(item.acceptedQuantity || 0), 0);
      const totalDamagedQty = allItems.reduce((sum, item) => sum + parseFloat(item.damagedQuantity || 0), 0);
      const totalMissingQty = allItems.reduce((sum, item) => sum + parseFloat(item.missingQuantity || 0), 0);

      const formattedReceipts = receipts.map(r => {
        const plain = r.get({ plain: true });
        const items = plain.Items || [];
        const accepted = items.reduce((sum, i) => sum + parseFloat(i.acceptedQuantity || 0), 0);
        const damaged = items.reduce((sum, i) => sum + parseFloat(i.damagedQuantity || 0), 0);
        return {
          ...plain,
          itemCount: items.length,
          totalAcceptedQty: accepted,
          totalDamagedQty: damaged
        };
      });

      res.render("goods-receipts", {
        title: "Goods Receiving & Inspection | DJ's FoodHub",
        activePage: "receipts",
        receipts: formattedReceipts,
        suppliers,
        totalReceipts,
        totalAcceptedQty: totalAcceptedQty.toFixed(2),
        totalDamagedQty: totalDamagedQty.toFixed(2),
        totalMissingQty: totalMissingQty.toFixed(2),
        selectedSupplier: supplierId || 'All',
        syncFilter: syncStatus || 'All',
        searchQuery: search || '',
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading goods receipts:", error);
      req.session.error = "Failed to load goods receipts: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 2. Show Delivery Inspection Form (Selecting or receiving against PO)
  showCreateForm: async (req, res) => {
    try {
      const { poId } = req.query;
      let selectedPO = null;

      if (poId) {
        selectedPO = await PurchaseOrder.findByPk(poId, {
          include: [
            { model: Supplier, as: 'Supplier' },
            { model: PurchaseOrderItem, as: 'Items' },
            { 
              model: GoodsReceipt, 
              as: 'GoodsReceipts',
              include: [{ model: GoodsReceiptItem, as: 'Items' }]
            }
          ]
        });

        if (selectedPO) {
          // Calculate cumulative quantities previously received per item
          const plainPO = selectedPO.get({ plain: true });
          plainPO.Items = plainPO.Items.map(item => {
            let prevAccepted = 0;
            (plainPO.GoodsReceipts || []).forEach(gr => {
              (gr.Items || []).forEach(gri => {
                if (gri.purchaseOrderItemId === item.id) {
                  prevAccepted += parseFloat(gri.acceptedQuantity || 0);
                }
              });
            });
            const remaining = Math.max(0, parseFloat(item.quantity) - prevAccepted);
            return {
              ...item,
              previouslyReceivedQty: prevAccepted,
              remainingQty: remaining
            };
          });
          selectedPO = plainPO;
        }
      }

      // Load all open purchase orders eligible for delivery
      const openPOs = await PurchaseOrder.findAll({
        where: {
          status: {
            [Op.in]: ['Sent to Supplier', 'Partially Received', 'Approved']
          }
        },
        include: [{ model: Supplier, as: 'Supplier' }],
        order: [['createdAt', 'DESC']]
      });

      res.render("record-goods-receipt", {
        title: "Record Goods Delivery | DJ's FoodHub",
        activePage: "receipts",
        openPOs,
        selectedPO,
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading goods receipt form:", error);
      req.session.error = "Failed to load receiving form: " + error.message;
      res.redirect("/goods-receipts");
    }
  },

  // 3. Store Goods Receipt with Quality Inspection Partition (Transaction-Safe)
  store: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { purchaseOrderId, deliveryDate, deliveryReference, remarks } = req.body;

      if (!purchaseOrderId) {
        req.session.error = "Purchase Order selection is required.";
        await t.rollback();
        return res.redirect("/goods-receipts/receive");
      }

      const po = await PurchaseOrder.findByPk(purchaseOrderId, {
        include: [{ model: PurchaseOrderItem, as: 'Items' }],
        transaction: t
      });

      if (!po) {
        req.session.error = "Purchase Order not found.";
        await t.rollback();
        return res.redirect("/goods-receipts/receive");
      }

      // Generate Receipt Number: GR-YYYYMM-XXXX
      const date = new Date(deliveryDate || new Date());
      const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
      const count = await GoodsReceipt.count() + 1;
      const receiptNumber = `GR-${yearMonth}-${String(count).padStart(4, '0')}`;

      // Create GoodsReceipt Header
      const newGR = await GoodsReceipt.create({
        receiptNumber,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        deliveryDate: deliveryDate || new Date(),
        receivedBy: req.session.user?.id || 1,
        deliveryReference: deliveryReference ? deliveryReference.trim() : null,
        remarks: remarks ? remarks.trim() : null,
        inventorySyncStatus: 'Pending'
      }, { transaction: t });

      // Parse item inspection inputs
      const itemIds = Array.isArray(req.body['po_item_id']) ? req.body['po_item_id'] : [req.body['po_item_id']].filter(Boolean);
      const productIds = Array.isArray(req.body['product_id']) ? req.body['product_id'] : [req.body['product_id']].filter(Boolean);
      const productNames = Array.isArray(req.body['product_name']) ? req.body['product_name'] : [req.body['product_name']].filter(Boolean);
      const orderedQtys = Array.isArray(req.body['ordered_qty']) ? req.body['ordered_qty'] : [req.body['ordered_qty']].filter(Boolean);
      const prevQtys = Array.isArray(req.body['prev_qty']) ? req.body['prev_qty'] : [req.body['prev_qty']].filter(Boolean);
      const deliveredQtys = Array.isArray(req.body['delivered_qty']) ? req.body['delivered_qty'] : [req.body['delivered_qty']].filter(Boolean);
      const damagedQtys = Array.isArray(req.body['damaged_qty']) ? req.body['damaged_qty'] : [req.body['damaged_qty']].filter(Boolean);
      const units = Array.isArray(req.body['item_unit']) ? req.body['item_unit'] : [req.body['item_unit']].filter(Boolean);
      const itemRemarks = Array.isArray(req.body['item_remarks']) ? req.body['item_remarks'] : [req.body['item_remarks']].filter(Boolean);

      let totalDeliveredThisReceipt = 0;
      let totalAcceptedThisReceipt = 0;

      for (let i = 0; i < itemIds.length; i++) {
        const delivered = parseFloat(deliveredQtys[i]) || 0.00;
        const damaged = parseFloat(damagedQtys[i]) || 0.00;
        const accepted = Math.max(0, delivered - damaged);
        const ordered = parseFloat(orderedQtys[i]) || 0.00;
        const prev = parseFloat(prevQtys[i]) || 0.00;
        const remainingBeforeThis = Math.max(0, ordered - prev);
        const missing = Math.max(0, remainingBeforeThis - delivered);

        totalDeliveredThisReceipt += delivered;
        totalAcceptedThisReceipt += accepted;

        await GoodsReceiptItem.create({
          goodsReceiptId: newGR.id,
          purchaseOrderItemId: parseInt(itemIds[i]),
          productId: parseInt(productIds[i]),
          productName: productNames[i],
          orderedQuantity: ordered,
          previouslyReceivedQty: prev,
          deliveredQuantity: delivered,
          acceptedQuantity: accepted, // Crucial: Only this amount qualifies for stock-in
          damagedQuantity: damaged,
          missingQuantity: missing,
          unit: units[i] || 'kg',
          remarks: itemRemarks[i] ? itemRemarks[i].trim() : null
        }, { transaction: t });
      }

      // Check cumulative quantities across all receipts to update PO Status
      const allPOReceipts = await GoodsReceipt.findAll({
        where: { purchaseOrderId: po.id },
        include: [{ model: GoodsReceiptItem, as: 'Items' }],
        transaction: t
      });

      // Include this new receipt in the check
      let poIsFullyReceived = true;
      for (const poItem of po.Items) {
        let totalReceivedSoFar = 0;
        allPOReceipts.forEach(gr => {
          gr.Items.forEach(gri => {
            if (gri.purchaseOrderItemId === poItem.id) {
              totalReceivedSoFar += parseFloat(gri.acceptedQuantity || 0);
            }
          });
        });
        if (totalReceivedSoFar < parseFloat(poItem.quantity)) {
          poIsFullyReceived = false;
        }
      }

      const updatedPOStatus = poIsFullyReceived ? 'Fully Received' : 'Partially Received';
      await po.update({ status: updatedPOStatus }, { transaction: t });

      // Audit Log
      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'GoodsReceipt',
        action: 'Create',
        entityId: newGR.id,
        details: { receiptNumber, poNumber: po.poNumber, totalAcceptedThisReceipt, updatedPOStatus }
      }, { transaction: t });

      await t.commit();

      // Asynchronously dispatch accepted stock-in to DJYum Inventory Management System
      inventoryService.syncStockIn(newGR.id).catch(err => {
        console.warn("[GoodsReceipt] Inventory sync async warning:", err.message);
      });

      req.session.success = `Goods Receipt ${receiptNumber} recorded! PO status updated to '${updatedPOStatus}'.`;
      res.redirect(`/goods-receipts/view/${newGR.id}`);
    } catch (error) {
      await t.rollback();
      console.error("Error saving goods receipt:", error);
      req.session.error = "Failed to record delivery: " + error.message;
      res.redirect("/goods-receipts/receive");
    }
  },

  // 4. View Goods Receipt Inspection Document (Printable)
  show: async (req, res) => {
    try {
      const { id } = req.params;
      const receipt = await GoodsReceipt.findByPk(id, {
        include: [
          { model: PurchaseOrder, as: 'PurchaseOrder' },
          { model: Supplier, as: 'Supplier' },
          { model: User, as: 'Receiver', attributes: ['name', 'email'] },
          { model: GoodsReceiptItem, as: 'Items' }
        ]
      });

      if (!receipt) {
        req.session.error = "Goods receipt not found.";
        return res.redirect("/goods-receipts");
      }

      res.render("view-goods-receipt", {
        title: `Goods Receipt ${receipt.receiptNumber} | DJ's FoodHub`,
        activePage: "receipts",
        receipt,
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error viewing goods receipt:", error);
      req.session.error = "Failed to load receipt: " + error.message;
      res.redirect("/goods-receipts");
    }
  }
};
