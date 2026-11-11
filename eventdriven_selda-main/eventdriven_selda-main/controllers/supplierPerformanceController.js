/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { 
  Supplier, 
  PurchaseOrder, 
  PurchaseOrderItem, 
  GoodsReceipt, 
  GoodsReceiptItem, 
  SupplierReturn 
} from "../models/index.js";

export const supplierPerformanceController = {
  index: async (req, res) => {
    try {
      const { search, gradeFilter } = req.query;

      const suppliers = await Supplier.findAll({
        where: search && search.trim() !== "" ? {
          [Op.or]: [
            { name: { [Op.like]: `%${search.trim()}%` } },
            { supplierCode: { [Op.like]: `%${search.trim()}%` } }
          ]
        } : {},
        include: [
          {
            model: PurchaseOrder,
            as: "PurchaseOrders",
            where: { status: { [Op.notIn]: ["Draft", "Cancelled"] } },
            required: false,
            include: [
              { model: PurchaseOrderItem, as: "Items" },
              {
                model: GoodsReceipt,
                as: "GoodsReceipts",
                include: [{ model: GoodsReceiptItem, as: "Items" }]
              }
            ]
          },
          {
            model: SupplierReturn,
            as: "Returns",
            required: false
          }
        ],
        order: [["name", "ASC"]]
      });

      let totalNetworkSpend = 0.00;
      let networkOrdersCount = 0;
      let topPerformerName = "N/A";
      let highestScore = -1;

      const performanceList = suppliers.map(supplier => {
        const pos = supplier.PurchaseOrders || [];
        const returns = supplier.Returns || [];
        const totalOrders = pos.length;
        networkOrdersCount += totalOrders;

        let supplierSpend = 0.00;
        let totalOrderedQty = 0;
        let totalDeliveredQty = 0;
        let totalAcceptedQty = 0;
        let totalDamagedQty = 0;
        let totalReceipts = 0;
        let onTimeReceipts = 0;
        let totalLeadDays = 0;
        let leadDaysSampleCount = 0;

        pos.forEach(po => {
          supplierSpend += parseFloat(po.totalAmount || 0);

          (po.Items || []).forEach(item => {
            totalOrderedQty += parseFloat(item.quantity || 0);
          });

          (po.GoodsReceipts || []).forEach(gr => {
            totalReceipts++;

            // On-time check
            if (po.expectedDeliveryDate && gr.deliveryDate) {
              const exp = new Date(po.expectedDeliveryDate).setHours(0, 0, 0, 0);
              const rec = new Date(gr.deliveryDate).setHours(0, 0, 0, 0);
              if (rec <= exp) {
                onTimeReceipts++;
              }
            } else {
              onTimeReceipts++;
            }

            // Lead time
            if (po.orderDate && gr.deliveryDate) {
              const ord = new Date(po.orderDate);
              const rec = new Date(gr.deliveryDate);
              const diffDays = Math.max(0, Math.round((rec - ord) / (1000 * 60 * 60 * 24)));
              totalLeadDays += diffDays;
              leadDaysSampleCount++;
            }

            (gr.Items || []).forEach(gri => {
              totalDeliveredQty += parseFloat(gri.deliveredQuantity || 0);
              totalAcceptedQty += parseFloat(gri.acceptedQuantity || 0);
              totalDamagedQty += parseFloat(gri.damagedQuantity || 0);
            });
          });
        });

        totalNetworkSpend += supplierSpend;

        // 1. On-Time Delivery Rate
        const onTimeRate = totalReceipts > 0 ? Math.min(100, Math.round((onTimeReceipts / totalReceipts) * 100)) : 100;

        // 2. Fulfillment Rate (Accepted vs Ordered)
        const fulfillmentRate = totalOrderedQty > 0 ? Math.min(100, Math.round((totalAcceptedQty / totalOrderedQty) * 100)) : (totalOrders > 0 ? 95 : 100);

        // 3. Damage Rate
        const damageRate = totalDeliveredQty > 0 ? Math.min(100, parseFloat(((totalDamagedQty / totalDeliveredQty) * 100).toFixed(1))) : 0.0;

        // 4. Return Rate
        const returnRate = totalOrders > 0 ? Math.min(100, parseFloat(((returns.length / totalOrders) * 100).toFixed(1))) : 0.0;

        // 5. Average Lead Days
        const avgLeadDays = leadDaysSampleCount > 0 ? (totalLeadDays / leadDaysSampleCount).toFixed(1) : (pos.length > 0 ? "2.5" : "N/A");

        // 6. Weighted Composite Score (out of 100)
        let score = 95; // Default for fresh clean supplier
        if (totalOrders > 0) {
          const rawScore = (onTimeRate * 0.40) + (fulfillmentRate * 0.40) + ((100 - damageRate) * 0.20);
          score = Math.max(0, Math.min(100, Math.round(rawScore)));
        }

        // 7. Tier & Grade
        let tier = "Tier 1: Preferred Partner";
        let grade = "A+";
        let badgeColor = "emerald";
        let stars = 5;

        if (score >= 90) {
          tier = "Tier 1: Preferred";
          grade = "A+";
          badgeColor = "emerald";
          stars = 5;
        } else if (score >= 80) {
          tier = "Tier 2: Reliable";
          grade = "A";
          badgeColor = "blue";
          stars = 4;
        } else if (score >= 70) {
          tier = "Tier 3: Moderate";
          grade = "B";
          badgeColor = "amber";
          stars = 3;
        } else {
          tier = "Tier 4: At Risk";
          grade = "C";
          badgeColor = "red";
          stars = 2;
        }

        // Recommendations
        let recommendation = "Maintain active contract; vendor exceeds restaurant quality and fulfillment benchmarks.";
        if (damageRate > 5.0) {
          recommendation = `High defect rate detected (${damageRate}%). Issue formal quality warning and audit transport handling.`;
        } else if (onTimeRate < 80) {
          recommendation = `Delivery delays noted (${100 - onTimeRate}% delayed). Recommend buffer stock and delivery schedule review.`;
        } else if (totalOrders === 0) {
          recommendation = "New vendor registered; awaiting trial purchase order to establish performance baseline.";
        }

        if (score > highestScore && totalOrders > 0) {
          highestScore = score;
          topPerformerName = supplier.name;
        }

        return {
          id: supplier.id,
          code: supplier.supplierCode,
          name: supplier.name,
          contactPerson: supplier.contactPerson,
          status: supplier.status,
          totalOrders,
          totalSpend: supplierSpend.toFixed(2),
          onTimeRate,
          fulfillmentRate,
          damageRate,
          returnRate,
          avgLeadDays,
          score,
          tier,
          grade,
          badgeColor,
          stars,
          recommendation,
          returnsCount: returns.length
        };
      });

      // Filter by Grade if specified
      const filteredList = gradeFilter && gradeFilter !== "All" 
        ? performanceList.filter(p => p.grade.startsWith(gradeFilter))
        : performanceList;

      res.render("supplier-performance", {
        title: "Supplier Performance Analytics | DJ's FoodHub",
        activePage: "performance",
        suppliers: filteredList,
        totalSuppliersCount: performanceList.length,
        totalNetworkSpend: totalNetworkSpend.toFixed(2),
        networkOrdersCount,
        topPerformerName,
        searchQuery: search || "",
        gradeFilter: gradeFilter || "All",
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("[SupplierPerformanceController] Error generating analytics:", error);
      req.session.error = "Performance analytics error: " + error.message;
      res.redirect("/suppliers");
    }
  }
};