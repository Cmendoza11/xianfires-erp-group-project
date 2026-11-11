/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { inventoryService } from "../services/inventoryService.js";
import { 
  sequelize, 
  PurchaseOrder, 
  PurchaseOrderItem, 
  Supplier, 
  Department, 
  PurchaseRequest, 
  PurchaseRequestItem, 
  SupplierProduct, 
  User, 
  GoodsReceipt, 
  SupplierInvoice,
  SupplierActivityLog 
} from "../models/index.js";

export const purchaseOrderController = {
  // 1. List Purchase Orders with filters & metrics
  index: async (req, res) => {
    try {
      const { search, supplierId, departmentId, status } = req.query;
      const whereClause = {};

      if (supplierId && supplierId !== 'All') {
        whereClause.supplierId = supplierId;
      }
      if (departmentId && departmentId !== 'All') {
        whereClause.departmentId = departmentId;
      }
      if (status && status !== 'All') {
        whereClause.status = status;
      }
      if (search && search.trim() !== '') {
        const query = `%${search.trim()}%`;
        whereClause[Op.or] = [
          { poNumber: { [Op.like]: query } },
          { notes: { [Op.like]: query } }
        ];
      }

      const orders = await PurchaseOrder.findAll({
        where: whereClause,
        include: [
          { model: Supplier, as: 'Supplier' },
          { model: Department, as: 'Department' },
          { model: PurchaseRequest, as: 'PurchaseRequest' },
          { model: User, as: 'Creator', attributes: ['name'] },
          { model: PurchaseOrderItem, as: 'Items' }
        ],
        order: [['createdAt', 'DESC']]
      });

      const suppliers = await Supplier.findAll({ where: { status: 'Active' }, order: [['name', 'ASC']] });
      const departments = await Department.findAll({ where: { status: 'Active' }, order: [['name', 'ASC']] });

      // KPI Counts
      const totalOrders = await PurchaseOrder.count();
      const pendingApprovalOrders = await PurchaseOrder.count({ where: { status: 'Pending Approval' } });
      const approvedOrders = await PurchaseOrder.count({ where: { status: 'Approved' } });
      const sentOrders = await PurchaseOrder.count({ where: { status: 'Sent to Supplier' } });
      const partiallyReceived = await PurchaseOrder.count({ where: { status: 'Partially Received' } });
      const fullyReceived = await PurchaseOrder.count({ where: { status: 'Fully Received' } });

      const formattedOrders = orders.map(o => {
        const plain = o.get({ plain: true });
        return {
          ...plain,
          itemCount: (plain.Items || []).length
        };
      });

      res.render("purchase-orders", {
        title: "Purchase Orders | DJ's FoodHub",
        activePage: "orders",
        orders: formattedOrders,
        suppliers,
        departments,
        totalOrders,
        pendingApprovalOrders,
        approvedOrders,
        sentOrders,
        partiallyReceived,
        fullyReceived,
        selectedSupplier: supplierId || 'All',
        selectedDepartment: departmentId || 'All',
        statusFilter: status || 'All',
        searchQuery: search || '',
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading purchase orders:", error);
      req.session.error = "Failed to load purchase orders: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 2. Show Multi-Item PO Creation Form (Optionally pre-filled from an approved PR)
  showCreateForm: async (req, res) => {
    try {
      const { fromPR } = req.query;
      let prefilledPR = null;

      if (fromPR) {
        prefilledPR = await PurchaseRequest.findByPk(fromPR, {
          include: [
            { model: Department, as: 'Department' },
            { model: PurchaseRequestItem, as: 'Items' }
          ]
        });
      }

      const suppliers = await Supplier.findAll({
        where: { status: 'Active' },
        include: [{ model: SupplierProduct, as: 'Products', where: { availability: true }, required: false }],
        order: [['name', 'ASC']]
      });

      const departments = await Department.findAll({
        where: { status: 'Active' },
        order: [['name', 'ASC']]
      });

      res.render("create-purchase-order", {
        title: "Create Purchase Order | DJ's FoodHub",
        activePage: "orders",
        suppliers,
        departments,
        prefilledPR,
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading PO creation form:", error);
      req.session.error = "Failed to load creation page: " + error.message;
      res.redirect("/purchase-orders");
    }
  },

  // 3. Store New Multi-Item Purchase Order (Transaction-safe)
  store: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { supplierId, departmentId, purchaseRequestId, orderDate, expectedDeliveryDate, paymentTerms, notes, status } = req.body;

      if (!supplierId || !departmentId) {
        req.session.error = "Supplier and department are required.";
        await t.rollback();
        return res.redirect("/purchase-orders/create");
      }

      // Verify supplier is Active
      const supplier = await Supplier.findByPk(supplierId);
      if (!supplier || supplier.status !== 'Active') {
        req.session.error = "Cannot create order: Selected supplier is not active.";
        await t.rollback();
        return res.redirect("/purchase-orders/create");
      }

      // Generate PO Number: PO-YYYYMM-XXXX
      const date = new Date(orderDate || new Date());
      const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
      const count = await PurchaseOrder.count({ paranoid: false }) + 1;
      const poNumber = `PO-${yearMonth}-${String(count).padStart(4, '0')}`;

      // Parse items
      const pids = Array.isArray(req.body['item_id']) ? req.body['item_id'] : [req.body['item_id']].filter(Boolean);
      const names = Array.isArray(req.body['item_name']) ? req.body['item_name'] : [req.body['item_name']].filter(Boolean);
      const qtys = Array.isArray(req.body['item_qty']) ? req.body['item_qty'] : [req.body['item_qty']].filter(Boolean);
      const units = Array.isArray(req.body['item_unit']) ? req.body['item_unit'] : [req.body['item_unit']].filter(Boolean);
      const prices = Array.isArray(req.body['item_price']) ? req.body['item_price'] : [req.body['item_price']].filter(Boolean);

      let lineItems = [];
      let grandTotal = 0.00;

      for (let i = 0; i < names.length; i++) {
        if (names[i] && names[i].trim() !== '') {
          const qty = parseFloat(qtys[i]) || 1.00;
          const unitPrice = parseFloat(prices[i]) || 0.00;
          const subtotal = qty * unitPrice;
          grandTotal += subtotal;

          lineItems.push({
            productId: (await inventoryService.resolveProductId({ productId: pids[i], productName: names[i], unit: units[i] })) ?? (parseInt(pids[i]) || 0),
            productName: names[i].trim(),
            quantity: qty,
            unit: units[i] || 'kg',
            unitPrice: unitPrice,
            subtotal: subtotal
          });
        }
      }

      if (lineItems.length === 0) {
        req.session.error = "At least one product line item must be added to the purchase order.";
        await t.rollback();
        return res.redirect("/purchase-orders/create");
      }

      const initialStatus = status || 'Draft';

      const newPO = await PurchaseOrder.create({
        poNumber,
        supplierId: parseInt(supplierId),
        departmentId: parseInt(departmentId),
        purchaseRequestId: purchaseRequestId ? parseInt(purchaseRequestId) : null,
        orderDate: orderDate || new Date(),
        expectedDeliveryDate: expectedDeliveryDate || null,
        createdBy: req.session.user?.id || 1,
        paymentTerms: paymentTerms || supplier.paymentTerms || 'Net 30',
        notes: notes ? notes.trim() : null,
        status: initialStatus,
        totalAmount: grandTotal
      }, { transaction: t });

      // Save Line Items
      for (const item of lineItems) {
        await PurchaseOrderItem.create({
          purchaseOrderId: newPO.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal
        }, { transaction: t });
      }

      // If created from a Purchase Request, update PR status
      if (purchaseRequestId) {
        const pr = await PurchaseRequest.findByPk(purchaseRequestId, { transaction: t });
        if (pr) {
          await pr.update({ status: 'Converted to PO' }, { transaction: t });
        }
      }

      // Audit Log
      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'PurchaseOrder',
        action: 'Create',
        entityId: newPO.id,
        details: { poNumber, supplierName: supplier.name, totalAmount: grandTotal, status: initialStatus }
      }, { transaction: t });

      await t.commit();
      req.session.success = `Purchase Order ${poNumber} created successfully!`;
      res.redirect(`/purchase-orders/view/${newPO.id}`);
    } catch (error) {
      await t.rollback();
      console.error("Error creating purchase order:", error);
      req.session.error = "Failed to create purchase order: " + error.message;
      res.redirect("/purchase-orders/create");
    }
  },

  // 4. View Purchase Order Details (Official Printable Voucher)
  show: async (req, res) => {
    try {
      const { id } = req.params;
      const order = await PurchaseOrder.findByPk(id, {
        include: [
          { model: Supplier, as: 'Supplier' },
          { model: Department, as: 'Department' },
          { model: PurchaseRequest, as: 'PurchaseRequest' },
          { model: User, as: 'Creator', attributes: ['name', 'email'] },
          { model: User, as: 'Approver', attributes: ['name', 'email'] },
          { model: PurchaseOrderItem, as: 'Items' },
          { model: GoodsReceipt, as: 'GoodsReceipts' },
          { model: SupplierInvoice, as: 'Invoices' }
        ]
      });

      if (!order) {
        req.session.error = "Purchase order not found.";
        return res.redirect("/purchase-orders");
      }

      res.render("view-purchase", {
        title: `PO ${order.poNumber} | DJ's FoodHub`,
        activePage: "orders",
        order,
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error displaying order details:", error);
      req.session.error = "Failed to load order: " + error.message;
      res.redirect("/purchase-orders");
    }
  },

  // 5. Approve Purchase Order
  approve: async (req, res) => {
    try {
      const { id } = req.params;
      const order = await PurchaseOrder.findByPk(id);

      if (!order) {
        req.session.error = "Purchase order not found.";
        return res.redirect("/purchase-orders");
      }

      if (order.status !== 'Draft' && order.status !== 'Pending Approval') {
        req.session.error = `Order is already in '${order.status}' status.`;
        return res.redirect(`/purchase-orders/view/${id}`);
      }

      await order.update({
        status: 'Approved',
        approvedBy: req.session.user?.id || 1,
        approvedAt: new Date()
      });

      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'PurchaseOrder',
        action: 'Approve',
        entityId: order.id,
        details: { poNumber: order.poNumber }
      }).catch(err => console.error(err));

      req.session.success = `Purchase Order ${order.poNumber} has been approved!`;
      res.redirect(`/purchase-orders/view/${id}`);
    } catch (error) {
      console.error("Error approving order:", error);
      req.session.error = "Approval failed: " + error.message;
      res.redirect("/purchase-orders");
    }
  },

  // 6. Send Purchase Order to Supplier
  sendToSupplier: async (req, res) => {
    try {
      const { id } = req.params;
      const order = await PurchaseOrder.findByPk(id, {
        include: [{ model: Supplier, as: 'Supplier' }]
      });

      if (!order) {
        req.session.error = "Purchase order not found.";
        return res.redirect("/purchase-orders");
      }

      if (order.status !== 'Approved') {
        req.session.error = "Only Approved orders can be marked as Sent to Supplier.";
        return res.redirect(`/purchase-orders/view/${id}`);
      }

      await order.update({ status: 'Sent to Supplier' });

      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'PurchaseOrder',
        action: 'SendToSupplier',
        entityId: order.id,
        details: { poNumber: order.poNumber, supplier: order.Supplier?.name }
      }).catch(err => console.error(err));

      req.session.success = `Purchase Order ${order.poNumber} marked as Sent to Supplier!`;
      res.redirect(`/purchase-orders/view/${id}`);
    } catch (error) {
      console.error("Error sending order:", error);
      req.session.error = "Action failed: " + error.message;
      res.redirect("/purchase-orders");
    }
  },

  // 7. Cancel Purchase Order
  cancel: async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const order = await PurchaseOrder.findByPk(id);

      if (!order) {
        req.session.error = "Purchase order not found.";
        return res.redirect("/purchase-orders");
      }

      if (order.status === 'Fully Received') {
        req.session.error = "Cannot cancel an order that has already been fully received.";
        return res.redirect(`/purchase-orders/view/${id}`);
      }

      await order.update({
        status: 'Cancelled',
        notes: (order.notes ? order.notes + '\n' : '') + `[Cancelled: ${reason || 'No reason provided'}]`
      });

      req.session.success = `Purchase Order ${order.poNumber} has been cancelled.`;
      res.redirect("/purchase-orders");
    } catch (error) {
      console.error("Error cancelling order:", error);
      req.session.error = "Cancellation failed: " + error.message;
      res.redirect("/purchase-orders");
    }
  },

  // --- Backward compatibility routes ---
  getPurchaseHistory: (req, res) => purchaseOrderController.index(req, res),
  showAddOrderPage: (req, res) => purchaseOrderController.showCreateForm(req, res),
  insertOrder: (req, res) => purchaseOrderController.store(req, res),
  getOrderDetails: (req, res) => purchaseOrderController.show(req, res)
};
