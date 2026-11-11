/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { inventoryService } from "../services/inventoryService.js";
import { 
  sequelize, 
  PurchaseRequest, 
  PurchaseRequestItem, 
  Department, 
  User, 
  SupplierProduct, 
  PurchaseOrder,
  SupplierActivityLog 
} from "../models/index.js";

export const purchaseRequestController = {
  // 1. List Purchase Requests with filters
  index: async (req, res) => {
    try {
      const { search, departmentId, status, priority } = req.query;
      const whereClause = {};

      if (departmentId && departmentId !== 'All') {
        whereClause.departmentId = departmentId;
      }
      if (status && status !== 'All') {
        whereClause.status = status;
      }
      if (priority && priority !== 'All') {
        whereClause.priority = priority;
      }
      if (search && search.trim() !== '') {
        const query = `%${search.trim()}%`;
        whereClause[Op.or] = [
          { requestNumber: { [Op.like]: query } },
          { purpose: { [Op.like]: query } }
        ];
      }

      const requests = await PurchaseRequest.findAll({
        where: whereClause,
        include: [
          { model: Department, as: 'Department' },
          { model: User, as: 'Requester', attributes: ['id', 'name', 'email'] },
          { model: User, as: 'Approver', attributes: ['id', 'name'] },
          { model: PurchaseRequestItem, as: 'Items' }
        ],
        order: [['createdAt', 'DESC']]
      });

      const departments = await Department.findAll({ where: { status: 'Active' }, order: [['name', 'ASC']] });
      const allOffered = await SupplierProduct.findAll({
        where: { availability: true },
        order: [['isPrimarySupplier', 'DESC'], ['supplierPrice', 'ASC']]
      });

      // Deduplicate by productId (avoids MySQL only_full_group_by strict mode)
      const seenProductIds = new Set();
      const availableProducts = [];
      for (const item of allOffered) {
        if (!seenProductIds.has(item.productId)) {
          seenProductIds.add(item.productId);
          availableProducts.push({
            productId: item.productId,
            productName: item.productName,
            unit: item.unit,
            supplierPrice: parseFloat(item.supplierPrice || 0)
          });
        }
      }

      // KPI Counts
      const totalRequests = await PurchaseRequest.count();
      const pendingRequests = await PurchaseRequest.count({ where: { status: 'Pending' } });
      const approvedRequests = await PurchaseRequest.count({ where: { status: 'Approved' } });
      const convertedRequests = await PurchaseRequest.count({ where: { status: 'Converted to PO' } });

      const formattedRequests = requests.map(r => {
        const plain = r.get({ plain: true });
        return {
          ...plain,
          itemCount: (plain.Items || []).length
        };
      });

      res.render("purchase-requests", {
        title: "Purchase Requests | DJ's FoodHub",
        activePage: "requests",
        requests: formattedRequests,
        departments,
        availableProducts,
        totalRequests,
        pendingRequests,
        approvedRequests,
        convertedRequests,
        selectedDepartment: departmentId || 'All',
        statusFilter: status || 'All',
        priorityFilter: priority || 'All',
        searchQuery: search || '',
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading purchase requests:", error);
      req.session.error = "Failed to load purchase requests: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 2. Create Purchase Request with multiple items (Transaction-safe)
  store: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { departmentId, priority, purpose, items } = req.body;

      if (!departmentId || !purpose) {
        req.session.error = "Department and purpose are required.";
        await t.rollback();
        return res.redirect("/purchase-requests");
      }

      // Generate PR Number: PR-YYYYMM-XXXX
      const date = new Date();
      const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
      const count = await PurchaseRequest.count({ paranoid: false }) + 1;
      const requestNumber = `PR-${yearMonth}-${String(count).padStart(4, '0')}`;

      const newPR = await PurchaseRequest.create({
        requestNumber,
        departmentId: parseInt(departmentId),
        requestedBy: req.session.user?.id || 1,
        requestDate: new Date(),
        priority: priority || 'Medium',
        purpose: purpose.trim(),
        status: 'Pending'
      }, { transaction: t });

      // Parse items (support both single object and array of items from dynamic form)
      let parsedItems = [];
      if (typeof items === 'string') {
        try { parsedItems = JSON.parse(items); } catch (e) { parsedItems = []; }
      } else if (Array.isArray(items)) {
        parsedItems = items;
      } else if (req.body['item_name']) {
        // Form array fields
        const names = Array.isArray(req.body['item_name']) ? req.body['item_name'] : [req.body['item_name']];
        const pids = Array.isArray(req.body['item_id']) ? req.body['item_id'] : [req.body['item_id']];
        const qtys = Array.isArray(req.body['item_qty']) ? req.body['item_qty'] : [req.body['item_qty']];
        const units = Array.isArray(req.body['item_unit']) ? req.body['item_unit'] : [req.body['item_unit']];
        const remarks = Array.isArray(req.body['item_remarks']) ? req.body['item_remarks'] : [req.body['item_remarks']];

        for (let i = 0; i < names.length; i++) {
          if (names[i] && names[i].trim() !== '') {
            parsedItems.push({
              productId: (await inventoryService.resolveProductId({ productId: pids[i], productName: names[i], unit: units[i] })) ?? (parseInt(pids[i]) || 0),
              productName: names[i].trim(),
              quantity: parseFloat(qtys[i]) || 1.00,
              unit: units[i] || 'kg',
              remarks: remarks[i] || null
            });
          }
        }
      }

      if (parsedItems.length === 0) {
        req.session.error = "At least one item must be added to the purchase request.";
        await t.rollback();
        return res.redirect("/purchase-requests");
      }

      for (const item of parsedItems) {
        await PurchaseRequestItem.create({
          purchaseRequestId: newPR.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
          remarks: item.remarks
        }, { transaction: t });
      }

      // Audit Log
      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'PurchaseRequest',
        action: 'Create',
        entityId: newPR.id,
        details: { requestNumber, departmentId, itemCount: parsedItems.length }
      }, { transaction: t });

      await t.commit();
      req.session.success = `Purchase Request ${requestNumber} created with ${parsedItems.length} item(s)!`;
      res.redirect("/purchase-requests");
    } catch (error) {
      await t.rollback();
      console.error("Error creating purchase request:", error);
      req.session.error = "Failed to create purchase request: " + error.message;
      res.redirect("/purchase-requests");
    }
  },

  // 3. Approve Purchase Request
  approve: async (req, res) => {
    try {
      const { id } = req.params;
      const pr = await PurchaseRequest.findByPk(id);

      if (!pr) {
        req.session.error = "Purchase request not found.";
        return res.redirect("/purchase-requests");
      }

      if (pr.status !== 'Pending') {
        req.session.error = `Request is already in '${pr.status}' status.`;
        return res.redirect("/purchase-requests");
      }

      await pr.update({
        status: 'Approved',
        approvedBy: req.session.user?.id || 1,
        approvedAt: new Date()
      });

      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'PurchaseRequest',
        action: 'Approve',
        entityId: pr.id,
        details: { requestNumber: pr.requestNumber }
      }).catch(err => console.error(err));

      req.session.success = `Purchase Request ${pr.requestNumber} approved! Ready to convert into Purchase Order.`;
      res.redirect("/purchase-requests");
    } catch (error) {
      console.error("Error approving request:", error);
      req.session.error = "Approval failed: " + error.message;
      res.redirect("/purchase-requests");
    }
  },

  // 4. Reject Purchase Request (Requires reason)
  reject: async (req, res) => {
    try {
      const { id } = req.params;
      const { rejectionReason } = req.body;

      if (!rejectionReason || rejectionReason.trim() === '') {
        req.session.error = "A rejection reason is mandatory when rejecting a requisition.";
        return res.redirect("/purchase-requests");
      }

      const pr = await PurchaseRequest.findByPk(id);
      if (!pr) {
        req.session.error = "Purchase request not found.";
        return res.redirect("/purchase-requests");
      }

      await pr.update({
        status: 'Rejected',
        approvedBy: req.session.user?.id || 1,
        approvedAt: new Date(),
        rejectionReason: rejectionReason.trim()
      });

      req.session.success = `Purchase Request ${pr.requestNumber} was rejected.`;
      res.redirect("/purchase-requests");
    } catch (error) {
      console.error("Error rejecting request:", error);
      req.session.error = "Rejection failed: " + error.message;
      res.redirect("/purchase-requests");
    }
  },

  // 5. Get Purchase Request Details (API / JSON)
  getDetails: async (req, res) => {
    try {
      const { id } = req.params;
      const pr = await PurchaseRequest.findByPk(id, {
        include: [
          { model: Department, as: 'Department' },
          { model: User, as: 'Requester', attributes: ['name', 'email'] },
          { model: User, as: 'Approver', attributes: ['name', 'email'] },
          { model: PurchaseRequestItem, as: 'Items' }
        ]
      });

      if (!pr) {
        return res.status(404).json({ success: false, message: "Purchase request not found" });
      }

      res.json({ success: true, request: pr });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};
