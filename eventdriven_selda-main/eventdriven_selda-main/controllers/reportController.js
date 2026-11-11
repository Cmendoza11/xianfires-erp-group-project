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
  PurchaseOrder, 
  PurchaseOrderItem, 
  GoodsReceipt, 
  GoodsReceiptItem, 
  SupplierReturn, 
  SupplierReturnItem, 
  SupplierInvoice 
} from "../models/index.js";

export const reportController = {
  // 1. Interactive Report Center View
  index: async (req, res) => {
    try {
      const { reportType = "purchase-orders", startDate, endDate, supplierId } = req.query;
      const suppliers = await Supplier.findAll({ order: [["name", "ASC"]] });

      let reportData = [];
      let summaryTotals = {};

      const dateFilter = {};
      if (startDate && endDate) {
        dateFilter[Op.between] = [startDate, endDate];
      } else if (startDate) {
        dateFilter[Op.gte] = startDate;
      } else if (endDate) {
        dateFilter[Op.lte] = endDate;
      }
      // Op.between / Op.gte / Op.lte are Symbol keys, which Object.keys() does not count.
      const hasDateFilter = Boolean(startDate || endDate);

      switch (reportType) {
        case "supplier-directory": {
          const supps = await Supplier.findAll({
            where: supplierId && supplierId !== "All" ? { id: supplierId } : {},
            include: [{ model: SupplierProduct, as: "Products" }],
            order: [["name", "ASC"]]
          });
          reportData = supps.map(s => ({
            col1: s.supplierCode,
            col2: s.name,
            col3: s.contactPerson || "N/A",
            col4: s.contactNumber || s.email || "N/A",
            col5: s.paymentTerms || "Net 30",
            col6: (s.Products || []).length,
            status: s.status
          }));
          summaryTotals = { totalRecords: reportData.length };
          break;
        }

        case "supplier-products": {
          const whereSP = {};
          if (supplierId && supplierId !== "All") whereSP.supplierId = supplierId;
          const prods = await SupplierProduct.findAll({
            where: whereSP,
            include: [{ model: Supplier, as: "Supplier" }],
            order: [["productName", "ASC"]]
          });
          reportData = prods.map(p => ({
            col1: p.sku || `PRD-${p.productId}`,
            col2: p.productName,
            col3: p.Supplier ? p.Supplier.name : "N/A",
            col4: `₱${parseFloat(p.supplierPrice).toFixed(2)} / ${p.unit}`,
            col5: `${p.minimumOrderQuantity} ${p.unit}`,
            col6: p.isPrimarySupplier ? "Primary Source" : "Secondary",
            status: p.isPrimarySupplier ? "Primary" : "Secondary"
          }));
          summaryTotals = { totalRecords: reportData.length };
          break;
        }

        case "goods-received": {
          const whereGR = {};
          if (hasDateFilter) whereGR.deliveryDate = dateFilter;
          const receipts = await GoodsReceipt.findAll({
            where: whereGR,
            include: [
              { model: PurchaseOrder, as: "PurchaseOrder" },
              { model: Supplier, as: "Supplier" },
              { model: GoodsReceiptItem, as: "Items" }
            ],
            order: [["deliveryDate", "DESC"]]
          });

          let sumDelivered = 0;
          let sumAccepted = 0;
          let sumDamaged = 0;

          reportData = receipts.map(r => {
            let del = 0, acc = 0, dam = 0;
            (r.Items || []).forEach(i => {
              del += parseFloat(i.deliveredQuantity || 0);
              acc += parseFloat(i.acceptedQuantity || 0);
              dam += parseFloat(i.damagedQuantity || 0);
            });
            sumDelivered += del;
            sumAccepted += acc;
            sumDamaged += dam;

            return {
              col1: r.receiptNumber,
              col2: r.PurchaseOrder ? r.PurchaseOrder.poNumber : "N/A",
              col3: r.Supplier ? r.Supplier.name : "N/A",
              col4: r.deliveryDate ? r.deliveryDate.split("T")[0] : "N/A",
              col5: `Del: ${del} | Acc: ${acc} | Dam: ${dam}`,
              col6: r.inventorySyncStatus || "Pending",
              status: r.inventorySyncStatus
            };
          });

          summaryTotals = {
            totalRecords: reportData.length,
            metric1Label: "Total Delivered Units",
            metric1Val: sumDelivered,
            metric2Label: "Accepted for Stock-In",
            metric2Val: sumAccepted,
            metric3Label: "Damaged / Rejected",
            metric3Val: sumDamaged
          };
          break;
        }

        case "returned-products": {
          const whereRet = {};
          if (supplierId && supplierId !== "All") whereRet.supplierId = supplierId;
          const returns = await SupplierReturn.findAll({
            where: whereRet,
            include: [
              { model: Supplier, as: "Supplier" },
              { model: SupplierReturnItem, as: "Items" }
            ],
            order: [["createdAt", "DESC"]]
          });

          let sumReturnedUnits = 0;
          reportData = returns.map(ret => {
            let retQty = 0;
            (ret.Items || []).forEach(i => retQty += parseFloat(i.quantity || 0));
            sumReturnedUnits += retQty;

            return {
              col1: ret.returnNumber,
              col2: ret.Supplier ? ret.Supplier.name : "N/A",
              col3: ret.reason || "Defect",
              col4: `${retQty} items`,
              col5: ret.status,
              col6: ret.refundAmount ? `₱${parseFloat(ret.refundAmount).toFixed(2)}` : "Replacement",
              status: ret.status
            };
          });

          summaryTotals = {
            totalRecords: reportData.length,
            metric1Label: "Total Units Returned",
            metric1Val: sumReturnedUnits
          };
          break;
        }

        case "outstanding-invoices": {
          const whereInv = { paymentStatus: { [Op.ne]: "Paid" } };
          if (supplierId && supplierId !== "All") whereInv.supplierId = supplierId;
          const invoices = await SupplierInvoice.findAll({
            where: whereInv,
            include: [{ model: Supplier, as: "Supplier" }],
            order: [["dueDate", "ASC"]]
          });

          let sumTotalLiabilities = 0;
          let sumOutstanding = 0;
          let sumPaid = 0;

          reportData = invoices.map(inv => {
            const tot = parseFloat(inv.invoiceTotal || 0);
            const pd = parseFloat(inv.amountPaid || 0);
            const bal = parseFloat(inv.outstandingBalance || 0);
            sumTotalLiabilities += tot;
            sumPaid += pd;
            sumOutstanding += bal;

            return {
              col1: inv.invoiceNumber,
              col2: inv.Supplier ? inv.Supplier.name : "N/A",
              col3: inv.invoiceDate ? inv.invoiceDate.split("T")[0] : "N/A",
              col4: inv.dueDate ? inv.dueDate.split("T")[0] : "N/A",
              col5: `Total: ₱${tot.toFixed(2)} | Paid: ₱${pd.toFixed(2)}`,
              col6: `₱${bal.toFixed(2)}`,
              status: inv.paymentStatus
            };
          });

          summaryTotals = {
            totalRecords: reportData.length,
            metric1Label: "Outstanding Payable Balance",
            metric1Val: `₱${sumOutstanding.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
            metric2Label: "Total Invoiced",
            metric2Val: `₱${sumTotalLiabilities.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
          };
          break;
        }

        case "monthly-purchasing": {
          const pos = await PurchaseOrder.findAll({
            where: { status: { [Op.notIn]: ["Draft", "Cancelled"] } },
            order: [["orderDate", "ASC"]]
          });

          const monthMap = {};
          pos.forEach(p => {
            const m = p.orderDate ? p.orderDate.slice(0, 7) : (p.createdAt ? p.createdAt.toISOString().slice(0, 7) : "Unknown");
            if (!monthMap[m]) monthMap[m] = { count: 0, spend: 0 };
            monthMap[m].count++;
            monthMap[m].spend += parseFloat(p.totalAmount || 0);
          });

          let grandSpend = 0;
          let grandCount = 0;

          reportData = Object.keys(monthMap).sort().reverse().map(m => {
            grandSpend += monthMap[m].spend;
            grandCount += monthMap[m].count;
            return {
              col1: m,
              col2: "Monthly Spend Commitment",
              col3: `${monthMap[m].count} Orders`,
              col4: `₱${monthMap[m].spend.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
              col5: `Avg: ₱${(monthMap[m].spend / monthMap[m].count).toFixed(2)}`,
              col6: "Processed",
              status: "Completed"
            };
          });

          summaryTotals = {
            totalRecords: reportData.length,
            metric1Label: "Total Spend Across Months",
            metric1Val: `₱${grandSpend.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
            metric2Label: "Total Orders Processed",
            metric2Val: grandCount
          };
          break;
        }

        default: // "purchase-orders"
        {
          const wherePO = {};
          if (supplierId && supplierId !== "All") wherePO.supplierId = supplierId;
          if (hasDateFilter) wherePO.orderDate = dateFilter;

          const orders = await PurchaseOrder.findAll({
            where: wherePO,
            include: [
              { model: Supplier, as: "Supplier" },
              { model: Department, as: "Department" }
            ],
            order: [["orderDate", "DESC"], ["createdAt", "DESC"]]
          });

          let grandTotal = 0;
          reportData = orders.map(po => {
            const tot = parseFloat(po.totalAmount || 0);
            grandTotal += tot;
            return {
              col1: po.poNumber,
              col2: po.Supplier ? po.Supplier.name : "N/A",
              col3: po.Department ? po.Department.name : "N/A",
              col4: po.orderDate ? po.orderDate : "N/A",
              col5: po.paymentTerms || "Net 30",
              col6: `₱${tot.toFixed(2)}`,
              status: po.status
            };
          });

          summaryTotals = {
            totalRecords: reportData.length,
            metric1Label: "Total PO Commitments",
            metric1Val: `₱${grandTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
          };
          break;
        }
      }

      res.render("reports", {
        title: "Purchasing & Supplier Reports | DJ's FoodHub",
        activePage: "reports",
        reportType,
        suppliers,
        reportData,
        summaryTotals,
        filterSupplier: supplierId || "All",
        filterStartDate: startDate || "",
        filterEndDate: endDate || "",
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("[ReportController] Error generating report:", error);
      req.session.error = "Report generation error: " + error.message;
      res.redirect("/dashboard");
    }
  },

  // 2. Export Report to CSV
  exportCSV: async (req, res) => {
    try {
      const { reportType = "purchase-orders" } = req.query;
      let csv = "Column 1,Column 2,Column 3,Column 4,Column 5,Column 6,Status\r\n";

      // Simple CSV export using standard table data
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=report_${reportType}_${Date.now()}.csv`);
      res.status(200).send(csv);
    } catch (error) {
      res.status(500).send("Export failed: " + error.message);
    }
  }
};