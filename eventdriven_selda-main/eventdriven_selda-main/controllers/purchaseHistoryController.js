/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { 
  PurchaseOrder, 
  PurchaseOrderItem, 
  Supplier, 
  Department, 
  GoodsReceipt, 
  GoodsReceiptItem,
  User 
} from "../models/index.js";

export const purchaseHistoryController = {
  // 1. Purchase History View with Advanced Filtering
  index: async (req, res) => {
    try {
      const { search, supplierId, departmentId, status, startDate, endDate } = req.query;
      const whereClause = {};

      if (supplierId && supplierId !== "All") {
        whereClause.supplierId = supplierId;
      }
      if (departmentId && departmentId !== "All") {
        whereClause.departmentId = departmentId;
      }
      if (status && status !== "All") {
        whereClause.status = status;
      }
      if (search && search.trim() !== "") {
        whereClause.poNumber = { [Op.like]: `%${search.trim()}%` };
      }
      if (startDate && endDate) {
        whereClause.orderDate = { [Op.between]: [startDate, endDate] };
      } else if (startDate) {
        whereClause.orderDate = { [Op.gte]: startDate };
      } else if (endDate) {
        whereClause.orderDate = { [Op.lte]: endDate };
      }

      const orders = await PurchaseOrder.findAll({
        where: whereClause,
        include: [
          { model: Supplier, as: "Supplier" },
          { model: Department, as: "Department" },
          { model: User, as: "Creator", attributes: ["name"] },
          { model: PurchaseOrderItem, as: "Items" },
          { 
            model: GoodsReceipt, 
            as: "GoodsReceipts",
            include: [{ model: GoodsReceiptItem, as: "Items" }]
          }
        ],
        order: [["orderDate", "DESC"], ["createdAt", "DESC"]]
      });

      const suppliers = await Supplier.findAll({ order: [["name", "ASC"]] });
      const departments = await Department.findAll({ order: [["name", "ASC"]] });

      // Calculate totals
      let totalValue = 0.00;
      let completedCount = 0;
      let pendingCount = 0;

      const formattedOrders = orders.map(ord => {
        const plain = ord.get({ plain: true });
        const val = parseFloat(plain.totalAmount || 0);
        totalValue += val;

        if (plain.status === "Fully Received") completedCount++;
        else if (plain.status !== "Cancelled") pendingCount++;

        // Calculate total items count and accepted quantity
        let totalItemsOrdered = 0;
        (plain.Items || []).forEach(i => totalItemsOrdered += parseFloat(i.quantity || 0));

        let totalItemsReceived = 0;
        (plain.GoodsReceipts || []).forEach(gr => {
          (gr.Items || []).forEach(gri => totalItemsReceived += parseFloat(gri.acceptedQuantity || 0));
        });

        return {
          ...plain,
          totalItemsOrdered,
          totalItemsReceived
        };
      });

      res.render("purchase-history", {
        title: "Purchase History & Audit Log | DJ's FoodHub",
        activePage: "history",
        orders: formattedOrders,
        suppliers,
        departments,
        totalOrdersCount: formattedOrders.length,
        totalPurchasesValue: totalValue.toFixed(2),
        completedOrdersCount: completedCount,
        pendingOrdersCount: pendingCount,
        filterSearch: search || "",
        filterSupplier: supplierId || "All",
        filterDepartment: departmentId || "All",
        filterStatus: status || "All",
        filterStartDate: startDate || "",
        filterEndDate: endDate || "",
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("[PurchaseHistoryController] Error loading history:", error);
      req.session.error = "Failed to load purchase history: " + error.message;
      res.redirect("/dashboard");
    }
  },

  // 2. Export Purchase History to CSV
  exportCSV: async (req, res) => {
    try {
      const { search, supplierId, departmentId, status, startDate, endDate } = req.query;
      const whereClause = {};

      if (supplierId && supplierId !== "All") whereClause.supplierId = supplierId;
      if (departmentId && departmentId !== "All") whereClause.departmentId = departmentId;
      if (status && status !== "All") whereClause.status = status;
      if (search && search.trim() !== "") whereClause.poNumber = { [Op.like]: `%${search.trim()}%` };
      if (startDate && endDate) whereClause.orderDate = { [Op.between]: [startDate, endDate] };

      const orders = await PurchaseOrder.findAll({
        where: whereClause,
        include: [
          { model: Supplier, as: "Supplier" },
          { model: Department, as: "Department" },
          { model: PurchaseOrderItem, as: "Items" }
        ],
        order: [["orderDate", "DESC"]]
      });

      let csv = "PO Number,Supplier,Department,Order Date,Expected Delivery Date,Payment Terms,Status,Total Amount (PHP),Items Count\r\n";
      orders.forEach(po => {
        const row = [
          `"${po.poNumber}"`,
          `"${po.Supplier ? po.Supplier.name.replace(/"/g, '""') : 'N/A'}"`,
          `"${po.Department ? po.Department.name.replace(/"/g, '""') : 'N/A'}"`,
          `"${po.orderDate || ''}"`,
          `"${po.expectedDeliveryDate || ''}"`,
          `"${po.paymentTerms || 'Net 30'}"`,
          `"${po.status}"`,
          `"${parseFloat(po.totalAmount || 0).toFixed(2)}"`,
          `"${(po.Items || []).length}"`
        ];
        csv += row.join(",") + "\r\n";
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=purchase_history_${Date.now()}.csv`);
      res.status(200).send(csv);
    } catch (error) {
      console.error("[PurchaseHistoryController] CSV export error:", error);
      res.status(500).send("Export failed: " + error.message);
    }
  }
};