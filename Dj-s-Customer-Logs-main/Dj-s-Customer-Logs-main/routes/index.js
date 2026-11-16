
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
    

import express from "express";
import { homePage } from "../controllers/homeController.js";
import {
    loginPage,
    forgotPasswordPage,
    loginUser,
    logoutUser
} from "../controllers/authController.js";
import { staffDashboardPage } from "../controllers/dashboardController.js";
import {
    customerModulePage,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    addCustomerLog
} from "../controllers/customerLogsController.js";
import {
    promoManagementPage,
    createPromo,
    updatePromo,
    updatePromoStatus,
    deletePromo,
    promoRedemptionPage,
    recordRedemption,
    voidRedemption
} from "../controllers/promoController.js";
import {
    userManagementPage,
    createUser,
    updateUserRole,
    toggleUserStatus,
    resetUserPassword,
    deleteUser,
    adminDashboardPage,
    topCustomersReport
} from "../controllers/userController.js";
import { requireAuth, requireRole, redirectIfAuthenticated } from "../middleware/auth.js";

const router = express.Router();

// ==================== PUBLIC ROUTES ====================
router.get("/", homePage);

// ==================== AUTH ROUTES (Unified for Staff & Admin) ====================
router.get("/login", redirectIfAuthenticated, loginPage);
router.post("/login", loginUser);
router.get("/forgot-password", forgotPasswordPage);

// ==================== LOGOUT (for both) ====================
router.get("/logout", requireAuth, logoutUser);

// ==================== STAFF ROUTES (staff ONLY - admin cannot access) ====================
router.get("/staff/dashboard", requireRole("staff"), staffDashboardPage);
router.get("/staff/modules/:module", requireRole("staff"), customerModulePage);
router.post("/staff/customers", requireRole("staff"), addCustomer);
router.post("/staff/customers/:customerId", requireRole("staff"), updateCustomer);
router.post("/staff/customers/:customerId/delete", requireRole("staff"), deleteCustomer);
router.post("/staff/customer-logs", requireRole("staff"), addCustomerLog);
router.post("/staff/promo-redemptions", requireRole("staff"), recordRedemption);
router.post("/staff/promo-redemptions/:id/void", requireRole("staff"), voidRedemption);

// ==================== ADMIN ROUTES (admin only) ====================
// Admin Dashboard
router.get("/admin/dashboard", requireRole("admin"), adminDashboardPage);

// Promo Management
router.get("/admin/promo-management", requireRole("admin"), promoManagementPage);
router.post("/admin/promos", requireRole("admin"), createPromo);
router.post("/admin/promos/:promoId", requireRole("admin"), updatePromo);
router.post("/admin/promos/:promoId/toggle", requireRole("admin"), updatePromoStatus);
router.post("/admin/promos/:promoId/delete", requireRole("admin"), deletePromo);

// User Management
router.get("/admin/users", requireRole("admin"), userManagementPage);
router.post("/admin/users", requireRole("admin"), createUser);
router.post("/admin/users/:id/role", requireRole("admin"), updateUserRole);
router.post("/admin/users/:id/toggle-status", requireRole("admin"), toggleUserStatus);
router.post("/admin/users/:id/reset-password", requireRole("admin"), resetUserPassword);
router.post("/admin/users/:id/delete", requireRole("admin"), deleteUser);

// Reports
router.get("/admin/reports/top-customers", requireRole("admin"), topCustomersReport);

// ==================== CONVENIENCE REDIRECTS ====================
router.get("/dashboard", (req, res) => {
    if (req.session && req.session.role === "admin") {
        return res.redirect("/admin/dashboard");
    }
    res.redirect("/staff/dashboard");
});

export default router;
