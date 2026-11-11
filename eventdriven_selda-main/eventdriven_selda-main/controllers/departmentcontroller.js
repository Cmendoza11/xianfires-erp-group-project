/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Op } from "sequelize";
import { Department, PurchaseRequest, PurchaseOrder, SupplierActivityLog } from "../models/index.js";
import { hrDepartmentsUrl } from "../services/hrDirectory.js";

// Departments belong to HR; this module keeps a read-only mirror (services/hrDirectory.js).
const managedInHr = (req, res) => {
  req.session.error = "Departments are managed in HR (shared across DJ's ERP). Add or change them there.";
  res.redirect('/departments');
};

const departmentcontroller = {
  managedInHr,

  // 1. List departments with search and request counts
  index: async (req, res) => {
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
          { code: { [Op.like]: query } },
          { departmentHead: { [Op.like]: query } }
        ];
      }

      const departments = await Department.findAll({
        where: whereClause,
        include: [
          { model: PurchaseRequest, as: 'PurchaseRequests' },
          { model: PurchaseOrder, as: 'PurchaseOrders' }
        ],
        order: [['name', 'ASC']]
      });

      const totalDepartments = await Department.count();
      const activeDepartments = await Department.count({ where: { status: 'Active' } });
      const inactiveDepartments = await Department.count({ where: { status: 'Inactive' } });

      const formattedDepartments = departments.map(d => {
        const plain = d.get({ plain: true });
        return {
          ...plain,
          requestCount: (plain.PurchaseRequests || []).length,
          orderCount: (plain.PurchaseOrders || []).length
        };
      });

      res.render("departments", {
        title: "Department Management | DJ's FoodHub",
        departments: formattedDepartments,
        totalDepartments,
        activeDepartments,
        inactiveDepartments,
        searchQuery: search || '',
        statusFilter: status || 'All',
        activePage: "departments",
        hrDepartmentsUrl: hrDepartmentsUrl(),
        user: req.session.user || { name: "System Administrator", role: "admin" }
      });
    } catch (error) {
      console.error("Error fetching departments:", error);
      req.session.error = "Failed to load departments: " + error.message;
      res.redirect('/departments');
    }
  },

  // 2. Create new department
  store: async (req, res) => {
    try {
      const { name, code, departmentHead, description } = req.body;

      if (!name || !code) {
        req.session.error = "Department name and code are required.";
        return res.redirect('/departments');
      }

      const formattedCode = code.trim().toUpperCase();

      // Check for code uniqueness
      const existing = await Department.findOne({ where: { code: formattedCode }, paranoid: false });
      if (existing) {
        req.session.error = `Department code '${formattedCode}' is already registered.`;
        return res.redirect('/departments');
      }

      const newDept = await Department.create({
        name: name.trim(),
        code: formattedCode,
        departmentHead: departmentHead ? departmentHead.trim() : null,
        description: description ? description.trim() : null,
        status: 'Active'
      });

      // Audit Log
      await SupplierActivityLog.create({
        userId: req.session.user?.id || null,
        module: 'Department',
        action: 'Create',
        entityId: newDept.id,
        details: { code: newDept.code, name: newDept.name }
      }).catch(err => console.error("Log error:", err));

      req.session.success = `Department '${newDept.name}' (${newDept.code}) created successfully!`;
      res.redirect('/departments');
    } catch (error) {
      console.error("Error creating department:", error);
      req.session.error = "Failed to create department: " + error.message;
      res.redirect('/departments');
    }
  },

  // 3. Update department
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, departmentHead, description, status } = req.body;

      const department = await Department.findByPk(id);
      if (!department) {
        req.session.error = "Department not found.";
        return res.redirect('/departments');
      }

      const formattedCode = code ? code.trim().toUpperCase() : department.code;

      // If code changed, check uniqueness
      if (formattedCode !== department.code) {
        const existing = await Department.findOne({ where: { code: formattedCode } });
        if (existing && existing.id !== parseInt(id)) {
          req.session.error = `Code '${formattedCode}' is already used by another department.`;
          return res.redirect('/departments');
        }
      }

      await department.update({
        name: name ? name.trim() : department.name,
        code: formattedCode,
        departmentHead: departmentHead !== undefined ? departmentHead.trim() : department.departmentHead,
        description: description !== undefined ? description.trim() : department.description,
        status: status && ['Active', 'Inactive'].includes(status) ? status : department.status
      });

      req.session.success = `Department '${department.name}' updated successfully!`;
      res.redirect('/departments');
    } catch (error) {
      console.error("Error updating department:", error);
      req.session.error = "Failed to update department: " + error.message;
      res.redirect('/departments');
    }
  },

  // 4. Toggle Status (Active <-> Inactive)
  toggleStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const department = await Department.findByPk(id);
      if (!department) {
        req.session.error = "Department not found.";
        return res.redirect('/departments');
      }

      const newStatus = department.status === 'Active' ? 'Inactive' : 'Active';
      await department.update({ status: newStatus });

      req.session.success = `Department '${department.name}' marked as ${newStatus}.`;
      res.redirect('/departments');
    } catch (error) {
      console.error("Error toggling department status:", error);
      req.session.error = "Failed to toggle status: " + error.message;
      res.redirect('/departments');
    }
  },

  // 5. Delete department (With transaction integrity check)
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const department = await Department.findByPk(id);
      if (!department) {
        req.session.error = "Department not found.";
        return res.redirect('/departments');
      }

      // Check if department has associated purchase requests or orders
      const requestCount = await PurchaseRequest.count({ where: { departmentId: id } });
      const orderCount = await PurchaseOrder.count({ where: { departmentId: id } });

      if (requestCount > 0 || orderCount > 0) {
        // Prevent permanent deletion and deactivate instead
        await department.update({ status: 'Inactive' });
        req.session.error = `Department '${department.name}' has ${requestCount} purchase requests and ${orderCount} purchase orders on record. Deletion was blocked to preserve transaction history; department has been marked as Inactive instead.`;
        return res.redirect('/departments');
      }

      await department.destroy();
      req.session.success = `Department '${department.name}' removed successfully.`;
      res.redirect('/departments');
    } catch (error) {
      console.error("Error deleting department:", error);
      req.session.error = "Failed to delete department: " + error.message;
      res.redirect('/departments');
    }
  }
};

export { departmentcontroller };
