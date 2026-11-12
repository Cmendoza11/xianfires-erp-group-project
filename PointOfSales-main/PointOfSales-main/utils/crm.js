/*
  Customer lookup for checkout. Customers are owned by the Customer Logs module, which keeps them in
  its own database, so the POS reads them only through the Customer Logs API (shared X-ERP-Key).
  Purchases and refunds are written back through the same API by utils/erpSync.js.
  When Customer Logs is offline the sale still goes ahead: search returns nothing, and a customer
  already chosen on the form is kept as sent; the purchase log is queued until Customer Logs is back.
*/
import { ErpApiError, peer } from "./erpClient.js";

const crm = (path) => peer("CRM", 3004, "GET", path);

/** The customer picker is shown when the POS is connected to the other DJ's ERP modules. */
export async function customersInstalled() {
  return Boolean(process.env.ERP_INTERNAL_KEY);
}

const toPick = (c) => ({ customerId: c.customerId, name: c.name, contactNumber: c.contactNumber, email: c.email });

/** Active customers matching a name, mobile number or email. { customers, available } */
export async function searchCustomers(term, limit = 10) {
  const q = String(term || "").trim();
  if (q.length < 2 || !(await customersInstalled())) return { customers: [], available: true };
  const max = Math.min(Math.max(Number(limit) || 10, 1), 25);
  try {
    const body = await crm(`/api/customers/search?q=${encodeURIComponent(q)}&limit=${max}`);
    const rows = Array.isArray(body?.data) ? body.data : [];
    return { customers: rows.filter((c) => c.status === "ACTIVE").map(toPick), available: true };
  } catch (error) {
    console.warn(`[crm] customer search unavailable: ${error.message}`);
    return { customers: [], available: false };
  }
}

/**
 * The active customer with this id, or null when Customer Logs says it does not exist or is not active.
 * If Customer Logs cannot be reached, the id and name the form sent are kept (marked unverified):
 * the purchase log waits in the outbox, and Customer Logs checks the id when it arrives.
 */
export async function findCustomer(customerId, nameFromForm = null) {
  const id = String(customerId || "").trim();
  if (!id) return null;
  try {
    const body = await crm(`/api/customers/${encodeURIComponent(id)}`);
    const customer = body?.data;
    if (!customer || customer.status !== "ACTIVE") return null;
    return { customerId: customer.customerId, name: customer.name };
  } catch (error) {
    if (error instanceof ErpApiError && error.status === 404) return null;
    if (error instanceof ErpApiError && error.status !== 0 && error.status < 500) throw error;
    console.warn(`[crm] customer ${id} kept unverified: ${error.message}`);
    return { customerId: id, name: String(nameFromForm || "").trim().slice(0, 160) || null, unverified: true };
  }
}

const crmPost = (path, body) => peer("CRM", 3004, "POST", path, body);

/**
 * Checks a Customer Logs promo code for this customer and subtotal.
 * Returns the quote, or throws ErpApiError with the reason (invalid, min spend, points, dates).
 */
export async function quotePromo({ code, customerId, subtotal }) {
  const promoCode = String(code || "").trim().toUpperCase();
  if (!promoCode) return null;
  const body = await crmPost("/api/promos/quote", { code: promoCode, customerId, subtotal: Number(subtotal) });
  return body?.data || null;
}

export async function redeemPromo(payload) {
  return crmPost("/api/promos/redeem", { ...payload, source: payload.source || "POS" });
}

export async function voidPromo({ transactionReference, reason }) {
  return crmPost("/api/promos/void", { transactionReference, source: "POS", reason });
}
