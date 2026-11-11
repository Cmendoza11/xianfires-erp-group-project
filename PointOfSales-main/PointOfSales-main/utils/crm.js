/*
  Customer lookup for checkout. Customers are owned by the Customer Logs module (crm_customers in
  the shared DJ's ERP database); the POS only reads them here. Purchases and refunds are written
  back through the Customer Logs API by utils/erpSync.js, never directly into its tables.
*/
import { QueryTypes } from "sequelize";
import { sequelize } from "../models/index.js";

let installed = null;

export async function customersInstalled() {
  if (installed === true) return true;
  const [row] = await sequelize.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_customers'",
    { type: QueryTypes.SELECT }
  );
  installed = Number(row.n) === 1;
  return installed;
}

export async function searchCustomers(term, limit = 10) {
  const q = String(term || "").trim();
  if (q.length < 2 || !(await customersInstalled())) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sequelize.query(
    `SELECT customerId, name, contactNumber, email FROM crm_customers
     WHERE status = 'ACTIVE' AND (name LIKE :like OR contactNumber LIKE :like OR email LIKE :like)
     ORDER BY name LIMIT ${Math.min(Math.max(Number(limit) || 10, 1), 25)}`,
    { replacements: { like }, type: QueryTypes.SELECT }
  );
}

/** The active customer with this id, or null. Used to validate what the checkout form sent. */
export async function findCustomer(customerId, transaction) {
  const id = String(customerId || "").trim();
  if (!id || !(await customersInstalled())) return null;
  const [row] = await sequelize.query(
    "SELECT customerId, name FROM crm_customers WHERE customerId = ? AND status = 'ACTIVE'",
    { replacements: [id], type: QueryTypes.SELECT, transaction }
  );
  return row || null;
}
