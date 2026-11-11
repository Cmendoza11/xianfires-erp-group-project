/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { 
  sequelize, 
  SupplierReturn, 
  SupplierReturnItem, 
  Supplier, 
  PurchaseOrder, 
  GoodsReceipt, 
  GoodsReceiptItem, 
  SupplierProduct,
  SupplierActivityLog 
} from "../models/index.js";
import { inventoryService } from "../services/inventoryService.js";
import { financialService } from "../services/financialService.js";

export const supplierReturnController = {
  // 1. List Returns with filters
  index: async (req, res) => {
    try {
      const { search, supplierId, status } = req.query;
      const whereClause = {};

      if (supplierId && supplierId !== 'All') {
        whereClause.supplierId = supplierId;
      }
      if (status && status !== 'All') {
        whereClause.status = status;
      }
      if (search && search.trim() !== '') {
        const query = `%${search.trim()}%`;
        whereClause[Op.or] = [
          { returnNumber: { [Op.like]: query } },
          { returnReason: { [Op.like]: query } }
        ];
      }

      const returns = await SupplierReturn.findAll({
        where: whereClause,
        include: [
          { model: Supplier, as: 'Supplier' },
          { model: PurchaseOrder, as: 'PurchaseOrder' },
          { model: GoodsReceipt, as: 'GoodsReceipt' },
          { model: SupplierReturnItem, as: 'Items' }
        ],
        order: [['createdAt', 'DESC']]
      });

      const suppliers = await Supplier.findAll({ where: { status: 'Active' }, order: [['name', 'ASC']] });
      const openPOs = await PurchaseOrder.findAll({
        where: {
          status: { [Op.in]: ['Sent to Supplier', 'Partially Received', 'Fully Received'] }
        },
        order: [['createdAt', 'DESC']]
      });

      // KPI Counts
      const totalReturns = await SupplierReturn.count();
      const pendingReturns = await SupplierReturn.count({ where: { status: 'Pending' } });
      const approvedReturns = await SupplierReturn.count({ where: { status: 'Approved' } });
      const completedReturns = await SupplierReturn.count({ 
        where: { status: { [Op.in]: ['Replaced', 'Refunded', 'Returned to Supplier'] } } 
      });

      const formattedReturns = returns.map(ret => {
        const plain = ret.get({ plain: true });
        return {
          ...plain,
          itemCount: (plain.Items || []).length
        };
      });

      res.render("supplier-returns", {
        title: "Supplier Returns Management | DJ's FoodHub",
        activePage: "returns",
        returns: formattedReturns,
        suppliers,
        openPOs,
        totalReturns,
        pendingReturns,
        approvedReturns,
        completedReturns,
        selectedSupplier: supplierId || 'All',
        statusFilter: status || 'All',
        searchQuery: search || '',
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading supplier returns:", error);
      req.session.error = "Failed to load returns: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 2. Create New Return Request
  store: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { supplierId, purchaseOrderId, goodsReceiptId, returnReason, remarks, item_name, item_id, item_qty, item_unit, item_reason } = req.body;

      if (!supplierId || !purchaseOrderId || !returnReason) {
        req.session.error = "Supplier, purchase order, and return reason are required.";
        await t.rollback();
        return res.redirect("/supplier-returns");
      }

      // Generate Return Number: RET-YYYYMM-XXXX
      const date = new Date();
      const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
      const count = await SupplierReturn.count() + 1;
      const returnNumber = `RET-${yearMonth}-${String(count).padStart(4, '0')}`;

      const newReturn = await SupplierReturn.create({
        returnNumber,
        supplierId: parseInt(supplierId),
        purchaseOrderId: parseInt(purchaseOrderId),
        goodsReceiptId: goodsReceiptId ? parseInt(goodsReceiptId) : null,
        returnDate: new Date(),
        returnReason: returnReason.trim(),
        remarks: remarks ? remarks.trim() : null,
        status: 'Pending',
        inventoryAdjustmentStatus: 'Not Needed'
      }, { transaction: t });

      // Parse items
      const names = Array.isArray(item_name) ? item_name : [item_name].filter(Boolean);
      const pids = Array.isArray(item_id) ? item_id : [item_id].filter(Boolean);
      const qtys = Array.isArray(item_qty) ? item_qty : [item_qty].filter(Boolean);
      const units = Array.isArray(item_unit) ? item_unit : [item_unit].filter(Boolean);
      const reasons = Array.isArray(item_reason) ? item_reason : [item_reason].filter(Boolean);

      for (let i = 0; i < names.length; i++) {
        if (names[i] && names[i].trim() !== '') {
          await SupplierReturnItem.create({
            supplierReturnId: newReturn.id,
            productId: (await inventoryService.resolveProductId({ productId: pids[i], productName: names[i], unit: units[i] })) ?? (parseInt(pids[i]) || 0),
            productName: names[i].trim(),
            quantity: parseFloat(qtys[i]) || 1.00,
            unit: units[i] || 'kg',
            reason: reasons[i] ? reasons[i].trim() : returnReason
          }, { transaction: t });
        }
      }

      // Audit Log
      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'SupplierReturn',
        action: 'Create',
        entityId: newReturn.id,
        details: { returnNumber, reason: returnReason }
      }, { transaction: t });

      await t.commit();
      req.session.success = `Return request ${returnNumber} submitted for approval.`;
      res.redirect("/supplier-returns");
    } catch (error) {
      await t.rollback();
      console.error("Error creating return request:", error);
      req.session.error = "Failed to create return: " + error.message;
      res.redirect("/supplier-returns");
    }
  },

  // 3. Approve Return Request
  approve: async (req, res) => {
    try {
      const { id } = req.params;
      const ret = await SupplierReturn.findByPk(id);
      if (!ret) {
        req.session.error = "Return record not found.";
        return res.redirect("/supplier-returns");
      }

      await ret.update({ status: 'Approved' });
      req.session.success = `Return ${ret.returnNumber} approved for dispatch to vendor.`;
      res.redirect("/supplier-returns");
    } catch (error) {
      console.error("Error approving return:", error);
      req.session.error = "Action failed: " + error.message;
      res.redirect("/supplier-returns");
    }
  },

  // 4. Mark Return as physically dispatched to supplier
  markReturned: async (req, res) => {
    try {
      const { id } = req.params;
      const ret = await SupplierReturn.findByPk(id);
      if (!ret) {
        req.session.error = "Return record not found.";
        return res.redirect("/supplier-returns");
      }

      await ret.update({ status: 'Returned to Supplier' });

      // Notify Inventory to deduct or adjust returned items
      inventoryService.syncReturnStockAdjustment(ret.id).catch(err => {
        console.warn("[SupplierReturn] Inventory return sync warning:", err.message);
      });

      req.session.success = `Return ${ret.returnNumber} marked as physically returned to vendor. Awaiting replacement or refund.`;
      res.redirect("/supplier-returns");
    } catch (error) {
      console.error("Error updating return:", error);
      req.session.error = "Action failed: " + error.message;
      res.redirect("/supplier-returns");
    }
  },

  // 5. Record Return Resolution (Replacement or Refund)
  recordResolution: async (req, res) => {
    try {
      const { id } = req.params;
      const { resolutionType, notes } = req.body; // 'Replaced' or 'Refunded'

      const ret = await SupplierReturn.findByPk(id);
      if (!ret) {
        req.session.error = "Return record not found.";
        return res.redirect("/supplier-returns");
      }

      const status = resolutionType === 'Refunded' ? 'Refunded' : 'Replaced';
      await ret.update({
        status,
        remarks: (ret.remarks ? ret.remarks + '\n' : '') + `[Resolution: ${status} - ${notes || 'No notes'}]`
      });

      if (resolutionType === 'Refunded') {
        financialService.dispatchCreditMemo(ret.id).catch(err => {
          console.warn("[SupplierReturn] Financial credit memo dispatch warning:", err.message);
        });
      }

      req.session.success = `Return ${ret.returnNumber} resolved as ${status}!`;
      res.redirect("/supplier-returns");
    } catch (error) {
      console.error("Error resolving return:", error);
      req.session.error = "Action failed: " + error.message;
      res.redirect("/supplier-returns");
    }
  }
};
