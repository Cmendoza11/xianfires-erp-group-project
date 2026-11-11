/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { Supplier, SupplierProduct, PurchaseOrder, GoodsReceipt, SupplierActivityLog } from "../models/index.js";
import { inventoryService } from "../services/inventoryService.js";

export const supplierController = {
  // 1. List Suppliers with search, status filter, and metrics
  showDashboard: async (req, res) => {
    try {
      const { search, status } = req.query;
      const whereClause = {};

      if (status && ['Active', 'Inactive'].includes(status)) {
        whereClause.status = status;
      }

      if (search && search.trim() !== '') {
        const query = `%${search.trim()}%`;
        whereClause[Op.or] = [
          { name: { [Op.like]: query } },
          { supplierCode: { [Op.like]: query } },
          { contactPerson: { [Op.like]: query } },
          { email: { [Op.like]: query } }
        ];
      }

      const suppliers = await Supplier.findAll({
        where: whereClause,
        include: [
          { model: SupplierProduct, as: 'Products' },
          { model: PurchaseOrder, as: 'PurchaseOrders' }
        ],
        order: [['createdAt', 'DESC']]
      });

      // Calculate supplier summary statistics
      const totalSuppliers = await Supplier.count();
      const activeSuppliers = await Supplier.count({ where: { status: 'Active' } });
      const inactiveSuppliers = await Supplier.count({ where: { status: 'Inactive' } });
      const totalProductsOffered = await SupplierProduct.count();

      // Format supplier data with order stats
      const formattedSuppliers = suppliers.map(s => {
        const plain = s.get({ plain: true });
        const orders = plain.PurchaseOrders || [];
        const totalPurchases = orders.reduce((sum, o) => sum + parseFloat(o.totalAmount || 0), 0);
        return {
          ...plain,
          productCount: (plain.Products || []).length,
          orderCount: orders.length,
          totalPurchasesFormatted: '₱' + totalPurchases.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        };
      });

      res.render("supplier", {
        title: "Supplier Management | DJ's FoodHub",
        activePage: "suppliers",
        suppliers: formattedSuppliers,
        totalSuppliers,
        activeSuppliers,
        inactiveSuppliers,
        totalProductsOffered,
        searchQuery: search || '',
        statusFilter: status || 'All',
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error loading suppliers:", error);
      req.session.error = "Failed to load suppliers: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 2. Add New Supplier with unique supplier code auto-generation
  insertSupplier: async (req, res) => {
    try {
      const { name, contactPerson, phone, email, address, paymentTerms, description } = req.body;

      if (!name || name.trim() === '') {
        req.session.error = "Supplier name is required.";
        return res.redirect("/suppliers");
      }

      // Generate unique Supplier Code: SUP-0001
      const count = await Supplier.count({ paranoid: false });
      const supplierCode = `SUP-${String(count + 1).padStart(4, '0')}`;

      // Email validation
      if (email && email.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          req.session.error = "Please provide a valid email address.";
          return res.redirect("/suppliers");
        }
      }

      const newSupplier = await Supplier.create({
        supplierCode,
        name: name.trim(),
        contactPerson: contactPerson ? contactPerson.trim() : null,
        phone: phone ? phone.trim() : null,
        email: email ? email.trim() : null,
        address: address ? address.trim() : null,
        paymentTerms: paymentTerms || 'Net 30',
        description: description ? description.trim() : null,
        status: 'Active'
      });

      // Audit Log
      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'Supplier',
        action: 'Create',
        entityId: newSupplier.id,
        details: { supplierCode, name: newSupplier.name }
      }).catch(err => console.error("Log error:", err));

      req.session.success = `Supplier ${newSupplier.name} (${supplierCode}) registered successfully!`;
      res.redirect("/suppliers");
    } catch (error) {
      console.error("Error adding supplier:", error);
      req.session.error = "Failed to create supplier: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 3. Update Existing Supplier
  updateSupplier: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, contactPerson, phone, email, address, paymentTerms, description, status } = req.body;

      const supplier = await Supplier.findByPk(id);
      if (!supplier) {
        req.session.error = "Supplier not found.";
        return res.redirect("/suppliers");
      }

      if (email && email.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          req.session.error = "Invalid email format.";
          return res.redirect("/suppliers");
        }
      }

      await supplier.update({
        name: name ? name.trim() : supplier.name,
        contactPerson: contactPerson !== undefined ? contactPerson.trim() : supplier.contactPerson,
        phone: phone !== undefined ? phone.trim() : supplier.phone,
        email: email !== undefined ? email.trim() : supplier.email,
        address: address !== undefined ? address.trim() : supplier.address,
        paymentTerms: paymentTerms || supplier.paymentTerms,
        description: description !== undefined ? description.trim() : supplier.description,
        status: status && ['Active', 'Inactive'].includes(status) ? status : supplier.status
      });

      req.session.success = `Supplier ${supplier.name} updated successfully!`;
      res.redirect("/suppliers");
    } catch (error) {
      console.error("Error updating supplier:", error);
      req.session.error = "Failed to update supplier: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 4. Toggle Status (Active <-> Inactive)
  toggleStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const supplier = await Supplier.findByPk(id);
      if (!supplier) {
        req.session.error = "Supplier not found.";
        return res.redirect("/suppliers");
      }

      const newStatus = supplier.status === 'Active' ? 'Inactive' : 'Active';
      await supplier.update({ status: newStatus });

      req.session.success = `Supplier ${supplier.name} marked as ${newStatus}.`;
      res.redirect("/suppliers");
    } catch (error) {
      console.error("Error toggling supplier status:", error);
      req.session.error = "Status update failed: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 5. Delete Supplier (With Transaction Integrity Protection)
  deleteSupplier: async (req, res) => {
    try {
      const { id } = req.params;
      const supplier = await Supplier.findByPk(id);
      if (!supplier) {
        req.session.error = "Supplier not found.";
        return res.redirect("/suppliers");
      }

      // Rule 5: Do not permanently delete suppliers with existing transaction history!
      const orderCount = await PurchaseOrder.count({ where: { supplierId: id } });
      const receiptCount = await GoodsReceipt.count({ where: { supplierId: id } });

      if (orderCount > 0 || receiptCount > 0) {
        // Protect history by deactivating instead of deleting
        await supplier.update({ status: 'Inactive' });
        req.session.error = `Supplier '${supplier.name}' has ${orderCount} purchase orders and ${receiptCount} receiving records on file. Deletion was blocked to preserve historical records; supplier has been Deactivated instead.`;
        return res.redirect("/suppliers");
      }

      // Soft delete using Sequelize paranoid
      await supplier.destroy();
      req.session.success = `Supplier '${supplier.name}' was safely removed.`;
      res.redirect("/suppliers");
    } catch (error) {
      console.error("Error deleting supplier:", error);
      req.session.error = "Failed to delete supplier: " + error.message;
      res.redirect("/suppliers");
    }
  },

  // 6. Get Supplier Details API (JSON endpoint for modals / inspect)
  getSupplierDetails: async (req, res) => {
    try {
      const { id } = req.params;
      const supplier = await Supplier.findByPk(id, {
        include: [
          { model: SupplierProduct, as: 'Products' },
          { 
            model: PurchaseOrder, 
            as: 'PurchaseOrders',
            limit: 10,
            order: [['createdAt', 'DESC']]
          }
        ]
      });

      if (!supplier) {
        return res.status(404).json({ success: false, message: "Supplier not found" });
      }

      res.json({ success: true, supplier });
    } catch (error) {
      console.error("Error fetching supplier details:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Legacy product operations delegated for backward compatibility
  insertProduct: async (req, res) => {
    try {
      const { supplierId, itemName, pricePerKilo, quantity } = req.body;
      await SupplierProduct.create({
        supplierId,
        productId: (await inventoryService.resolveProductId({ productName: itemName, unit: 'kg' })) ?? 0,
        productName: itemName,
        supplierPrice: parseFloat(pricePerKilo) || 0,
        minOrderQty: parseFloat(quantity) || 1,
        unit: 'kg',
        availability: true
      });
      req.session.success = "Product added successfully!";
      res.redirect("/suppliers");
    } catch (error) {
      req.session.error = "Error adding product: " + error.message;
      res.redirect("/suppliers");
    }
  },

  updateProduct: async (req, res) => {
    try {
      const { id } = req.params;
      const { itemName, pricePerKilo, quantity } = req.body;
      await SupplierProduct.update({
        productName: itemName,
        supplierPrice: parseFloat(pricePerKilo) || 0,
        minOrderQty: parseFloat(quantity) || 1
      }, { where: { id } });
      req.session.success = "Product updated successfully!";
      res.redirect("/suppliers");
    } catch (error) {
      req.session.error = "Error updating product: " + error.message;
      res.redirect("/suppliers");
    }
  },

  deleteProduct: async (req, res) => {
    try {
      const { id } = req.params;
      await SupplierProduct.destroy({ where: { id } });
      req.session.success = "Product removed successfully!";
      res.redirect("/suppliers");
    } catch (error) {
      req.session.error = "Error deleting product: " + error.message;
      res.redirect("/suppliers");
    }
  }
};
