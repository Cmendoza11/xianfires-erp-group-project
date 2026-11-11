import express from "express";
import { homePage } from "../controllers/homeController.js";
import {
  loginPage,
  registerPage,
  forgotPasswordPage,
  loginUser,
  registerUser,
  logoutUser,
  updateProfile,
  changePassword
} from "../controllers/authController.js";
import { dashboard } from "../controllers/dashboardController.js";
import {
  employeeList,
  employeeCreatePage,
  employeeCreate,
  employeeShow,
  employeeEditPage,
  employeeUpdate,
  employeeDelete,
  employeeProfile
} from "../controllers/employeeController.js";
import {
  departmentList,
  departmentCreate,
  departmentEditPage,
  departmentUpdate,
  departmentAssignEmployee,
  departmentDelete
} from "../controllers/departmentController.js";
import {
  attendanceIndex,
  recordAttendance,
  checkIn,
  checkOut,
  myAttendance
} from "../controllers/attendanceController.js";
import {
  leaveList,
  leaveCreatePage,
  leaveCreate,
  leaveApprove,
  leaveReject,
  leaveDelete
} from "../controllers/leaveController.js";
import {
  payrollList,
  payrollCreatePage,
  payrollCreate,
  payrollShow,
  payrollUpdateStatus,
  payrollDelete,
  payrollRetrySync,
  myPayslips
} from "../controllers/payrollController.js";
import { reportsIndex, reportShow } from "../controllers/reportController.js";
import {
  userList,
  createUser,
  resetUserPassword,
  updateUserRole,
  deleteUser
} from "../controllers/userController.js";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// HOME
router.get("/", homePage);

// AUTHENTICATION
router.get("/login", loginPage);
router.post("/login", loginUser);
router.get("/register", registerPage);
router.post("/register", registerUser);
router.get("/forgot-password", forgotPasswordPage);
router.get("/logout", requireAuth, logoutUser);

// DASHBOARD
router.get("/dashboard", requireAuth, dashboard);

// SELF-SERVICE PROFILE
router.get("/profile", requireAuth, employeeProfile);
router.post("/account/profile", requireAuth, updateProfile);
router.post("/account/password", requireAuth, changePassword);

// EMPLOYEE MANAGEMENT
router.get("/employees", requireRole("admin", "staff"), employeeList);
router.get("/employees/create", requireRole("admin", "staff"), employeeCreatePage);
router.post("/employees/create", requireRole("admin", "staff"), employeeCreate);
router.get("/employees/:id", requireAuth, employeeShow);
router.get("/employees/:id/edit", requireRole("admin", "staff"), employeeEditPage);
router.post("/employees/:id/edit", requireRole("admin", "staff"), employeeUpdate);
router.post("/employees/:id/delete", requireRole("admin"), employeeDelete);

// DEPARTMENT MANAGEMENT
router.get("/departments", requireRole("admin", "staff"), departmentList);
router.post("/departments", requireRole("admin"), departmentCreate);
router.get("/departments/:id/edit", requireRole("admin"), departmentEditPage);
router.post("/departments/:id/edit", requireRole("admin"), departmentUpdate);
router.post("/departments/:id/assign", requireRole("admin"), departmentAssignEmployee);
router.post("/departments/:id/delete", requireRole("admin"), departmentDelete);

// ATTENDANCE MANAGEMENT
router.get("/attendance", requireRole("admin", "staff"), attendanceIndex);
router.post("/attendance", requireRole("admin", "staff"), recordAttendance);
router.post("/attendance/check-in", requireAuth, checkIn);
router.post("/attendance/check-out", requireAuth, checkOut);
router.get("/my-attendance", requireAuth, myAttendance);

// LEAVE MANAGEMENT
router.get("/leaves", requireAuth, leaveList);
router.get("/leaves/create", requireAuth, leaveCreatePage);
router.post("/leaves/create", requireAuth, leaveCreate);
router.post("/leaves/:id/approve", requireRole("admin", "staff"), leaveApprove);
router.post("/leaves/:id/reject", requireRole("admin", "staff"), leaveReject);
router.post("/leaves/:id/delete", requireAuth, leaveDelete);

// PAYROLL MANAGEMENT (administrator only, employees see their own payslips)
router.get("/payroll", requireRole("admin"), payrollList);
router.get("/payroll/create", requireRole("admin"), payrollCreatePage);
router.post("/payroll/create", requireRole("admin"), payrollCreate);
router.get("/payroll/:id", requireAuth, payrollShow);
router.post("/payroll/:id/status", requireRole("admin"), payrollUpdateStatus);
router.post("/payroll/:id/delete", requireRole("admin"), payrollDelete);
router.post("/payroll/:id/sync", requireRole("admin"), payrollRetrySync);
router.get("/my-payslips", requireAuth, myPayslips);
router.get("/my-payslips/:id", requireAuth, payrollShow);

// REPORTS
router.get("/reports", requireRole("admin", "staff"), reportsIndex);
router.get("/reports/:type", requireRole("admin", "staff"), reportShow);

// USER ACCOUNTS
router.get("/users", requireRole("admin"), userList);
router.post("/users", requireRole("admin"), createUser);
router.post("/users/:id/password", requireRole("admin"), resetUserPassword);
router.post("/users/:id/role", requireRole("admin"), updateUserRole);
router.post("/users/:id/delete", requireRole("admin"), deleteUser);

export default router;
