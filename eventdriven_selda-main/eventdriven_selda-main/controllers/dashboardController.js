/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { 
  Supplier, 
  SupplierProduct, 
  Department, 
  PurchaseRequest, 
  PurchaseOrder, 
  GoodsReceipt, 
  SupplierReturn, 
  SupplierInvoice, 
  SupplierActivityLog 
} from "../models/index.js";
import { inventoryService } from "../services/inventoryService.js";

export const dashboardController = {
  index: async (req, res) => {
    try {
      const today = new Date().toISOString().split("T")[0];

      // 1. Supplier & Product Metrics
      const totalSuppliers = await Supplier.count();
      const activeSuppliers = await Supplier.count({ where: { status: "Active" } });
      const inactiveSuppliers = await Supplier.count({ where: { status: "Inactive" } });
      const totalSupplierProducts = await SupplierProduct.count();

      // 2. Purchasing Workflow Metrics
      const pendingRequests = await PurchaseRequest.count({ where: { status: "Pending" } });
      const pendingPOs = await PurchaseOrder.count({ where: { status: "Pending Approval" } });
      const approvedPOs = await PurchaseOrder.count({ where: { status: "Approved" } });
      const partiallyReceivedPOs = await PurchaseOrder.count({ where: { status: "Partially Received" } });
      const completedPOs = await PurchaseOrder.count({ where: { status: "Fully Received" } });
      const incomingDeliveries = await PurchaseOrder.count({
        where: { status: { [Op.in]: ["Sent to Supplier", "Partially Received"] } }
      });

      // 3. Financial Invoices & Payables Metrics
      const allInvoices = await SupplierInvoice.findAll();
      let pendingInvoices = 0;
      let outstandingPayables = 0.00;
      let totalInvoicedAmount = 0.00;
      let totalPaidAmount = 0.00;

      for (const inv of allInvoices) {
        const total = parseFloat(inv.invoiceTotal || 0);
        const paid = parseFloat(inv.amountPaid || 0);
        const bal = parseFloat(inv.outstandingBalance || (total - paid));

        totalInvoicedAmount += total;
        totalPaidAmount += paid;
        outstandingPayables += bal;

        if (inv.paymentStatus !== "Paid") {
          pendingInvoices++;
        }
      }

      // 4. Total Purchases (Committed & Delivered POs)
      const validPOs = await PurchaseOrder.findAll({
        where: { status: { [Op.notIn]: ["Draft", "Cancelled"] } }
      });
      let totalPurchases = 0.00;
      validPOs.forEach(po => {
        totalPurchases += parseFloat(po.totalAmount || 0);
      });

      // 5. Recent Purchase Orders (Latest 5)
      const recentOrders = await PurchaseOrder.findAll({
        include: [
          { model: Supplier, as: "Supplier" },
          { model: Department, as: "Department" }
        ],
        order: [["createdAt", "DESC"]],
        limit: 5
      });

      // 6. Upcoming Deliveries
      const upcomingDeliveriesList = await PurchaseOrder.findAll({
        where: {
          status: { [Op.in]: ["Sent to Supplier", "Approved", "Partially Received"] },
          expectedDeliveryDate: { [Op.gte]: today }
        },
        include: [{ model: Supplier, as: "Supplier" }],
        order: [["expectedDeliveryDate", "ASC"]],
        limit: 5
      });

      // 7. Recent System Activity Log
      const recentActivities = await SupplierActivityLog.findAll({
        order: [["createdAt", "DESC"]],
        limit: 8
      });

      // 8. Low-Stock Alerts from Inventory Management System
      const alertResponse = await inventoryService.fetchLowStockAlerts();
      const inventoryAlerts = alertResponse.alerts || [];

      // 9. Monthly Spend Aggregation (Past 6 months)
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthlySpendMap = {};
      const now = new Date();

      // Initialize past 6 months
      const past6Months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = `${months[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
        past6Months.push(label);
        monthlySpendMap[label] = 0.00;
      }

      validPOs.forEach(po => {
        const d = new Date(po.createdAt);
        const label = `${months[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
        if (monthlySpendMap[label] !== undefined) {
          monthlySpendMap[label] += parseFloat(po.totalAmount || 0);
        }
      });

      const maxMonthlySpend = Math.max(...Object.values(monthlySpendMap), 1000);
      const monthlyChartData = past6Months.map(label => {
        const val = monthlySpendMap[label] || 0;
        const percentage = Math.min(100, Math.round((val / maxMonthlySpend) * 100));
        return {
          label,
          amount: val.toFixed(2),
          percentage: percentage > 0 ? percentage : 4 // minimum visible bar height
        };
      });

      res.render("dashboard", {
        title: "Executive Purchasing & Supplier Dashboard | DJ's FoodHub",
        activePage: "dashboard",
        metrics: {
          totalSuppliers,
          activeSuppliers,
          inactiveSuppliers,
          totalSupplierProducts,
          pendingRequests,
          pendingPOs,
          approvedPOs,
          partiallyReceivedPOs,
          completedPOs,
          incomingDeliveries,
          pendingInvoices,
          outstandingPayables: outstandingPayables.toFixed(2),
          totalPurchases: totalPurchases.toFixed(2),
          totalInvoicedAmount: totalInvoicedAmount.toFixed(2),
          totalPaidAmount: totalPaidAmount.toFixed(2)
        },
        monthlyChartData,
        recentOrders,
        upcomingDeliveriesList,
        recentActivities,
        inventoryAlerts,
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("[DashboardController] Error generating dashboard:", error);
      req.session.error = "Dashboard error: " + error.message;
      res.redirect("/suppliers");
    }
  }
};