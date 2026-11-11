/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { SupplierProduct, Supplier, SupplierActivityLog } from "../models/index.js";
import { inventoryService } from "../services/inventoryService.js";

export const supplierProductController = {
  // 1. List All Supplier Products with filters
  index: async (req, res) => {
    try {
      const { search, supplierId, availability } = req.query;
      const whereClause = {};

      if (supplierId && supplierId !== 'All') {
        whereClause.supplierId = supplierId;
      }

      if (availability !== undefined && availability !== 'All') {
        whereClause.availability = availability === 'true' || availability === '1';
      }

      if (search && search.trim() !== '') {
        const query = `%${search.trim()}%`;
        whereClause[Op.or] = [
          { productName: { [Op.like]: query } },
          { unit: { [Op.like]: query } }
        ];
      }

      const products = await SupplierProduct.findAll({
        where: whereClause,
        include: [{ model: Supplier, as: 'Supplier' }],
        order: [['productName', 'ASC'], ['supplierPrice', 'ASC']]
      });

      const suppliers = await Supplier.findAll({
        where: { status: 'Active' },
        order: [['name', 'ASC']]
      });

      // Price comparison calculation (group products by productName)
      const comparisonMap = {};
      const allOffers = await SupplierProduct.findAll({
        include: [{ model: Supplier, as: 'Supplier' }],
        order: [['supplierPrice', 'ASC']]
      });

      allOffers.forEach(offer => {
        const key = offer.productName.trim().toLowerCase();
        if (!comparisonMap[key]) {
          comparisonMap[key] = {
            productId: offer.productId,
            productName: offer.productName,
            unit: offer.unit,
            lowestPrice: parseFloat(offer.supplierPrice),
            highestPrice: parseFloat(offer.supplierPrice),
            offers: []
          };
        }
        const price = parseFloat(offer.supplierPrice);
        if (price < comparisonMap[key].lowestPrice) comparisonMap[key].lowestPrice = price;
        if (price > comparisonMap[key].highestPrice) comparisonMap[key].highestPrice = price;

        comparisonMap[key].offers.push({
          id: offer.id,
          supplierId: offer.supplierId,
          supplierName: offer.Supplier ? offer.Supplier.name : 'Unknown',
          price: price,
          minOrderQty: offer.minOrderQty,
          availability: offer.availability,
          isPrimary: offer.isPrimarySupplier
        });
      });

      const comparisonList = Object.values(comparisonMap);

      res.render("supplier-products", {
        title: "Supplier Products & Price Comparison | DJ's FoodHub",
        activePage: "supplier-products",
        products,
        suppliers,
        comparisonList,
        selectedSupplier: supplierId || 'All',
        searchQuery: search || '',
        availabilityFilter: availability || 'All',
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading supplier products:", error);
      req.session.error = "Failed to load supplier products: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 2. Add Supplier Product Offering
  store: async (req, res) => {
    try {
      const { supplierId, productId, productName, supplierPrice, minOrderQty, unit, availability, isPrimarySupplier } = req.body;

      if (!supplierId || !productName || !supplierPrice) {
        req.session.error = "Supplier, product name, and price are required.";
        return res.redirect("/supplier-products");
      }

      const isPrimary = isPrimarySupplier === 'on' || isPrimarySupplier === 'true' || isPrimarySupplier === true;
      // The POS & Inventory product this offer supplies (registered there as a Supply item if new).
      const parsedProductId = (await inventoryService.resolveProductId({ productId, productName, unit })) ?? (parseInt(productId) || 0);

      // If marked as primary supplier, unset other suppliers' primary status for this product
      if (isPrimary) {
        await SupplierProduct.update(
          { isPrimarySupplier: false },
          { where: { productId: parsedProductId } }
        );
      }

      await SupplierProduct.create({
        supplierId: parseInt(supplierId),
        productId: parsedProductId,
        productName: productName.trim(),
        supplierPrice: parseFloat(supplierPrice),
        minOrderQty: parseFloat(minOrderQty) || 1.00,
        unit: unit ? unit.trim() : 'kg',
        availability: availability !== 'false',
        isPrimarySupplier: isPrimary
      });

      req.session.success = `Product offer '${productName}' successfully registered!`;
      res.redirect("/supplier-products");
    } catch (error) {
      console.error("Error registering supplier product:", error);
      req.session.error = "Failed to add product offer: " + error.message;
      res.redirect("/supplier-products");
    }
  },

  // 3. Update Supplier Product Offering
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { productName, supplierPrice, minOrderQty, unit, availability, isPrimarySupplier } = req.body;

      const item = await SupplierProduct.findByPk(id);
      if (!item) {
        req.session.error = "Product offering not found.";
        return res.redirect("/supplier-products");
      }

      const isPrimary = isPrimarySupplier === 'on' || isPrimarySupplier === 'true' || isPrimarySupplier === true;

      if (isPrimary) {
        await SupplierProduct.update(
          { isPrimarySupplier: false },
          { where: { productId: item.productId } }
        );
      }

      await item.update({
        productName: productName ? productName.trim() : item.productName,
        supplierPrice: supplierPrice !== undefined ? parseFloat(supplierPrice) : item.supplierPrice,
        minOrderQty: minOrderQty !== undefined ? parseFloat(minOrderQty) : item.minOrderQty,
        unit: unit ? unit.trim() : item.unit,
        availability: availability !== undefined ? (availability === 'true' || availability === '1') : item.availability,
        isPrimarySupplier: isPrimary
      });

      req.session.success = `Product offering updated successfully!`;
      res.redirect("/supplier-products");
    } catch (error) {
      console.error("Error updating supplier product:", error);
      req.session.error = "Update failed: " + error.message;
      res.redirect("/supplier-products");
    }
  },

  // 4. Toggle Primary Supplier
  setPrimary: async (req, res) => {
    try {
      const { id } = req.params;
      const item = await SupplierProduct.findByPk(id);
      if (!item) {
        req.session.error = "Product not found.";
        return res.redirect("/supplier-products");
      }

      // Unset previous primary for this product
      await SupplierProduct.update(
        { isPrimarySupplier: false },
        { where: { productId: item.productId } }
      );

      // Set this one as primary
      await item.update({ isPrimarySupplier: true });

      req.session.success = `Supplier set as primary vendor for '${item.productName}'.`;
      res.redirect("/supplier-products");
    } catch (error) {
      console.error("Error setting primary supplier:", error);
      req.session.error = "Action failed: " + error.message;
      res.redirect("/supplier-products");
    }
  },

  // 5. Remove Product Offering
  destroy: async (req, res) => {
    try {
      const { id } = req.params;
      const item = await SupplierProduct.findByPk(id);
      if (!item) {
        req.session.error = "Product not found.";
        return res.redirect("/supplier-products");
      }

      await item.destroy();
      req.session.success = `Product offering removed.`;
      res.redirect("/supplier-products");
    } catch (error) {
      console.error("Error removing supplier product:", error);
      req.session.error = "Failed to remove product: " + error.message;
      res.redirect("/supplier-products");
    }
  }
};
