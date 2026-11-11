/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { 
  sequelize, 
  SupplierInvoice, 
  PurchaseOrder, 
  GoodsReceipt, 
  Supplier, 
  SupplierActivityLog 
} from "../models/index.js";
import { financialService } from "../services/financialService.js";

export const supplierInvoiceController = {
  // 1. List Supplier Invoices with metrics & overdue checking
  index: async (req, res) => {
    try {
      const { search, supplierId, paymentStatus } = req.query;
      const whereClause = {};

      if (supplierId && supplierId !== 'All') {
        whereClause.supplierId = supplierId;
      }
      if (paymentStatus && paymentStatus !== 'All') {
        whereClause.paymentStatus = paymentStatus;
      }
      if (search && search.trim() !== '') {
        const query = `%${search.trim()}%`;
        whereClause[Op.or] = [
          { invoiceNumber: { [Op.like]: query } },
          { financialReference: { [Op.like]: query } }
        ];
      }

      const invoices = await SupplierInvoice.findAll({
        where: whereClause,
        include: [
          { model: Supplier, as: 'Supplier' },
          { model: PurchaseOrder, as: 'PurchaseOrder' },
          { model: GoodsReceipt, as: 'GoodsReceipt' }
        ],
        order: [['dueDate', 'ASC']]
      });

      const suppliers = await Supplier.findAll({ where: { status: 'Active' }, order: [['name', 'ASC']] });
      const openPOs = await PurchaseOrder.findAll({
        where: {
          status: { [Op.in]: ['Sent to Supplier', 'Partially Received', 'Fully Received', 'Approved'] }
        },
        include: [{ model: Supplier, as: 'Supplier' }],
        order: [['createdAt', 'DESC']]
      });

      const openReceipts = await GoodsReceipt.findAll({
        include: [{ model: PurchaseOrder, as: 'PurchaseOrder' }],
        order: [['createdAt', 'DESC']]
      });

      // Calculate financial summary metrics
      const allInvoices = await SupplierInvoice.findAll();
      const today = new Date().toISOString().split('T')[0];

      let totalInvoiceAmount = 0.00;
      let totalPaid = 0.00;
      let totalOutstanding = 0.00;
      let overdueCount = 0;
      let pendingCount = 0;
      let paidCount = 0;

      for (const inv of allInvoices) {
        const total = parseFloat(inv.invoiceTotal || 0);
        const paid = parseFloat(inv.amountPaid || 0);
        const balance = parseFloat(inv.outstandingBalance || (total - paid));

        totalInvoiceAmount += total;
        totalPaid += paid;
        totalOutstanding += balance;

        // Auto-check overdue status
        if (inv.paymentStatus !== 'Paid' && inv.dueDate < today) {
          overdueCount++;
          if (inv.paymentStatus !== 'Overdue') {
            await inv.update({ paymentStatus: 'Overdue' });
          }
        } else if (inv.paymentStatus === 'Paid') {
          paidCount++;
        } else {
          pendingCount++;
        }
      }

      const formattedInvoices = invoices.map(inv => {
        const plain = inv.get({ plain: true });
        const isOverdue = plain.paymentStatus !== 'Paid' && plain.dueDate < today;
        return {
          ...plain,
          isOverdue
        };
      });

      res.render("supplier-invoices", {
        title: "Supplier Invoices & Payables | DJ's FoodHub",
        activePage: "invoices",
        invoices: formattedInvoices,
        suppliers,
        openPOs,
        openReceipts,
        totalInvoiceAmount: totalInvoiceAmount.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        totalOutstanding: totalOutstanding.toFixed(2),
        overdueCount,
        pendingCount,
        paidCount,
        selectedSupplier: supplierId || 'All',
        statusFilter: paymentStatus || 'All',
        searchQuery: search || '',
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading supplier invoices:", error);
      req.session.error = "Failed to load invoices: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 2. Record New Supplier Invoice
  store: async (req, res) => {
    try {
      const { invoiceNumber, supplierId, purchaseOrderId, goodsReceiptId, invoiceDate, dueDate, invoiceTotal } = req.body;

      if (!invoiceNumber || !supplierId || !purchaseOrderId || !invoiceTotal || !dueDate) {
        req.session.error = "Invoice number, supplier, PO, due date, and total amount are required.";
        return res.redirect("/supplier-invoices");
      }

      const trimmedInv = invoiceNumber.trim();

      // Check for invoice uniqueness
      const existing = await SupplierInvoice.findOne({ where: { invoiceNumber: trimmedInv } });
      if (existing) {
        req.session.error = `Invoice number '${trimmedInv}' is already registered in the system.`;
        return res.redirect("/supplier-invoices");
      }

      const totalVal = parseFloat(invoiceTotal) || 0.00;

      const newInvoice = await SupplierInvoice.create({
        invoiceNumber: trimmedInv,
        supplierId: parseInt(supplierId),
        purchaseOrderId: parseInt(purchaseOrderId),
        goodsReceiptId: goodsReceiptId ? parseInt(goodsReceiptId) : null,
        invoiceDate: invoiceDate || new Date(),
        dueDate: dueDate,
        invoiceTotal: totalVal,
        amountPaid: 0.00,
        outstandingBalance: totalVal, // Initially equals invoice total until financial synchronization
        paymentStatus: 'Pending',
        financialSyncStatus: 'Pending'
      });

      // Audit Log
      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'SupplierInvoice',
        action: 'Create',
        entityId: newInvoice.id,
        details: { invoiceNumber: trimmedInv, invoiceTotal: totalVal, dueDate }
      }).catch(err => console.error(err));

      // Asynchronously dispatch Accounts Payable to DJYum Financial Management System
      financialService.dispatchPayable(newInvoice.id).catch(err => {
        console.warn("[SupplierInvoice] Financial dispatch async warning:", err.message);
      });

      req.session.success = `Supplier Invoice ${trimmedInv} for ₱${totalVal.toLocaleString('en-PH', { minimumFractionDigits: 2 })} recorded successfully! Dispatched to Financial System.`;
      res.redirect("/supplier-invoices");
    } catch (error) {
      console.error("Error creating supplier invoice:", error);
      req.session.error = "Failed to record invoice: " + error.message;
      res.redirect("/supplier-invoices");
    }
  },

  // 3. Get Invoice Details (API / JSON)
  getDetails: async (req, res) => {
    try {
      const { id } = req.params;
      const invoice = await SupplierInvoice.findByPk(id, {
        include: [
          { model: Supplier, as: 'Supplier' },
          { model: PurchaseOrder, as: 'PurchaseOrder' },
          { model: GoodsReceipt, as: 'GoodsReceipt' }
        ]
      });

      if (!invoice) {
        return res.status(404).json({ success: false, message: "Invoice not found" });
      }

      res.json({ success: true, invoice });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};
