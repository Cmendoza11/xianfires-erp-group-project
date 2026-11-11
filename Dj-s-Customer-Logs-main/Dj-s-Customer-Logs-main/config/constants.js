/*
    ERP System - Shared Constants & Enums
    Used across all modules
*/

export const USER_ROLES = {
  ADMIN: "admin",
  STAFF: "staff",
  MANAGER: "manager",
  SUPERVISOR: "supervisor"
};

export const MODULES = {
  CUSTOMER_LOGS: "customerLogs",
  POS: "pos",
  INVENTORY: "inventory",
  ACCOUNTING: "accounting",
  HR: "hr",
  PAYROLL: "payroll",
  SUPPLIER: "supplier"
};

export const TRANSACTION_TYPES = {
  SALE: "SALE",
  RETURN: "RETURN",
  ADJUSTMENT: "ADJUSTMENT",
  TRANSFER: "TRANSFER"
};

export const PROMO_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  EXPIRED: "EXPIRED"
};

export const AUDIT_ACTIONS = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  VIEW: "VIEW",
  REDEEM: "REDEEM"
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVER_ERROR: 500
};
