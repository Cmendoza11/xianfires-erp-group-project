/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */

import bcrypt from "bcrypt";
import { User } from "../models/userModel.js";
import { Op, fn, col } from "sequelize";
import { Customer, LoyaltyRecord, CustomerLog } from "../models/customerRelations.js";

// Helper functions
const cleanEmail = (value) => String(value || "").trim().toLowerCase();
const cleanText = (value) => String(value || "").trim();
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Display user management page
 */
export const userManagementPage = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const roleFilter = req.query.role || "";
    const statusFilter = req.query.status || "";

    // Build where clause
    const whereClause = {};
    
    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } }
      ];
    }
    
    if (roleFilter) {
      whereClause.role = roleFilter;
    }
    
    if (statusFilter) {
      whereClause.status = statusFilter;
    }

    const users = await User.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      attributes: { exclude: ["password"] }
    });

    // Get statistics
    const [totalUsers, activeUsers, adminCount, staffCount] = await Promise.all([
      User.count(),
      User.count({ where: { status: "active" } }),
      User.count({ where: { role: "admin" } }),
      User.count({ where: { role: "staff" } })
    ]);

    res.render("adminUsers", {
      title: "User Management | Customer Logs",
      users: users.map(u => ({
        ...u.toJSON(),
        lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("en-PH") : "Never",
        createdDate: new Date(u.createdAt).toLocaleDateString("en-PH")
      })),
      search,
      roleFilter,
      statusFilter,
      stats: {
        totalUsers,
        activeUsers,
        adminCount,
        staffCount
      },
      currentUserId: req.user.id
    });

  } catch (error) {
    console.error("Error loading users:", error);
    req.flash("error_msg", "Error loading users.");
    res.redirect("/admin/dashboard");
  }
};

/**
 * Create a new user
 */
export const createUser = async (req, res) => {
  try {
    const name = cleanText(req.body.name);
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");
    const role = req.body.role === "admin" ? "admin" : "staff";

    // Validation
    const errors = [];

    if (name.length < 2) {
      errors.push("Name must be at least 2 characters.");
    }

    if (!isValidEmail(email)) {
      errors.push("Invalid email address.");
    }

    if (password.length < 8) {
      errors.push("Password must be at least 8 characters.");
    }

    // Check if email exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      errors.push("Email already in use.");
    }

    if (errors.length > 0) {
      req.flash("error_msg", errors.join(" "));
      return res.redirect("/admin/users");
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await User.create({
      name,
      email,
      password: hashedPassword,
      role,
      status: "active"
    });

    req.flash("success_msg", `User ${name} created successfully as ${role}.`);
    res.redirect("/admin/users");

  } catch (error) {
    console.error("Error creating user:", error);
    req.flash("error_msg", "Error creating user.");
    res.redirect("/admin/users");
  }
};

/**
 * Update user role
 */
export const updateUserRole = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const newRole = req.body.role === "admin" ? "admin" : "staff";

    // Prevent changing own role
    if (userId === req.user.id) {
      req.flash("error_msg", "You cannot change your own role.");
      return res.redirect("/admin/users");
    }

    const user = await User.findByPk(userId);
    
    if (!user) {
      req.flash("error_msg", "User not found.");
      return res.redirect("/admin/users");
    }

    await user.update({ role: newRole });

    req.flash("success_msg", `${user.name}'s role updated to ${newRole}.`);
    res.redirect("/admin/users");

  } catch (error) {
    console.error("Error updating user role:", error);
    req.flash("error_msg", "Error updating user role.");
    res.redirect("/admin/users");
  }
};

/**
 * Toggle user status (active/inactive)
 */
export const toggleUserStatus = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent deactivating own account
    if (userId === req.user.id) {
      req.flash("error_msg", "You cannot deactivate your own account.");
      return res.redirect("/admin/users");
    }

    const user = await User.findByPk(userId);
    
    if (!user) {
      req.flash("error_msg", "User not found.");
      return res.redirect("/admin/users");
    }

    const newStatus = user.status === "active" ? "inactive" : "active";
    await user.update({ status: newStatus });

    req.flash("success_msg", `${user.name}'s account ${newStatus === "active" ? "activated" : "deactivated"}.`);
    res.redirect("/admin/users");

  } catch (error) {
    console.error("Error toggling user status:", error);
    req.flash("error_msg", "Error updating user status.");
    res.redirect("/admin/users");
  }
};

/**
 * Reset user password
 */
export const resetUserPassword = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const newPassword = String(req.body.password || "");

    if (newPassword.length < 8) {
      req.flash("error_msg", "Password must be at least 8 characters.");
      return res.redirect("/admin/users");
    }

    const user = await User.findByPk(userId);
    
    if (!user) {
      req.flash("error_msg", "User not found.");
      return res.redirect("/admin/users");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });

    req.flash("success_msg", `Password reset for ${user.name}.`);
    res.redirect("/admin/users");

  } catch (error) {
    console.error("Error resetting password:", error);
    req.flash("error_msg", "Error resetting password.");
    res.redirect("/admin/users");
  }
};

/**
 * Delete user
 */
export const deleteUser = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent deleting own account
    if (userId === req.user.id) {
      req.flash("error_msg", "You cannot delete your own account.");
      return res.redirect("/admin/users");
    }

    const user = await User.findByPk(userId);
    
    if (!user) {
      req.flash("error_msg", "User not found.");
      return res.redirect("/admin/users");
    }

    // Prevent deleting the last admin
    if (user.role === "admin") {
      const adminCount = await User.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        req.flash("error_msg", "Cannot delete the last admin account.");
        return res.redirect("/admin/users");
      }
    }

    const userName = user.name;
    await user.destroy();

    req.flash("success_msg", `User ${userName} deleted successfully.`);
    res.redirect("/admin/users");

  } catch (error) {
    console.error("Error deleting user:", error);
    req.flash("error_msg", "Error deleting user.");
    res.redirect("/admin/users");
  }
};

/**
 * Admin dashboard (redirect for now)
 */
export const adminDashboardPage = async (req, res) => {
  // For now, redirect to promo management
  // Can be enhanced with admin-specific dashboard later
  res.redirect("/admin/promo-management");
};

/**
 * Top Customers Report - Monthly leaderboard
 */
export const topCustomersReport = async (req, res) => {
  try {
    // Get date filter from query params
    const period = req.query.period || "this_month";
    let startDate, endDate;
    const now = new Date();
    
    if (period === "this_month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (period === "last_month") {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else if (period === "this_year") {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    } else {
      // All time
      startDate = null;
      endDate = null;
    }

    // Build where clause for date filtering
    const dateFilter = startDate && endDate ? {
      activityAt: {
        [Op.between]: [startDate, endDate]
      }
    } : {};

    // Get customers with their purchase data in the period
    const customers = await Customer.findAll({
      include: [
        {
          model: LoyaltyRecord,
          attributes: ['pointsBalance', 'tier']
        },
        {
          model: CustomerLog,
          where: {
            activityType: "purchase",
            ...dateFilter
          },
          required: false,
          attributes: []
        }
      ],
      attributes: [
        'customerId',
        'name',
        'email',
        'contactNumber',
        'totalSpent',
        'lastPurchaseDate',
        [fn('COUNT', col('CustomerLogs.id')), 'purchaseCount'],
        [fn('SUM', col('CustomerLogs.amount')), 'periodSpent']
      ],
      group: ['Customer.customerId'],
      having: {
        purchaseCount: {
          [Op.gt]: 0
        }
      },
      order: [[fn('COUNT', col('CustomerLogs.id')), 'DESC']],
      limit: 50,
      subQuery: false
    });

    // Format the data
    const topCustomers = customers.map((customer, index) => ({
      rank: index + 1,
      customerId: customer.customerId,
      name: customer.name,
      email: customer.email,
      contactNumber: customer.contactNumber,
      purchaseCount: parseInt(customer.getDataValue('purchaseCount')) || 0,
      periodSpent: parseFloat(customer.getDataValue('periodSpent')) || 0,
      totalSpent: parseFloat(customer.totalSpent) || 0,
      loyaltyPoints: customer.LoyaltyRecord?.pointsBalance || 0,
      tier: customer.LoyaltyRecord?.tier || 'Regular',
      lastPurchase: customer.lastPurchaseDate ? new Date(customer.lastPurchaseDate).toLocaleDateString('en-PH') : 'Never'
    }));

    // Get period stats
    const stats = {
      totalCustomers: topCustomers.length,
      topSpender: topCustomers[0] || null,
      totalRevenue: topCustomers.reduce((sum, c) => sum + c.periodSpent, 0),
      avgSpendPerCustomer: topCustomers.length > 0 ? (topCustomers.reduce((sum, c) => sum + c.periodSpent, 0) / topCustomers.length) : 0
    };

    res.render("topCustomers", {
      title: "Top Customers Report | Customer Logs",
      topCustomers,
      stats,
      period,
      periodLabel: getPeriodLabel(period),
      startDate: startDate ? startDate.toLocaleDateString('en-PH') : null,
      endDate: endDate ? endDate.toLocaleDateString('en-PH') : null
    });

  } catch (error) {
    console.error("Error loading top customers report:", error);
    req.flash("error_msg", "Error loading report.");
    res.redirect("/admin/dashboard");
  }
};

// Helper function
function getPeriodLabel(period) {
  switch(period) {
    case 'this_month': return 'This Month';
    case 'last_month': return 'Last Month';
    case 'this_year': return 'This Year';
    case 'all_time': return 'All Time';
    default: return 'This Month';
  }
}
