/*
    MIT License

    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
/*
  Procurement -> Accounting ERP (/api/v1, key ERP_API_KEY_SCM). Accounting owns payables and payments.
  - Supplier invoice -> supplier bill (Dr 1200 Merchandise Inventory / Cr 2000 Accounts Payable),
    with the supplier kept as an Accounting contact (external id = supplier code).
  - Payment status is READ from Accounting: Procurement never marks an invoice paid itself.
  - Supplier return resolved as "Refunded" -> journal entry Dr 1010 Cash in Bank / Cr 1200 Inventory
    for the returned quantity at the PO price.
  External ids (SINV-<invoice no.>, SRET-<return no.>) make every retry safe.
*/
import { SupplierInvoice, Supplier, PurchaseOrder, PurchaseOrderItem, SupplierReturn, SupplierReturnItem, SupplierActivityLog } from "../models/index.js";
import { ErpApiError, accounting } from "./erpClient.js";

// Default chart-of-accounts codes of the Accounting ERP; override in the root .env if they differ.
const ACCOUNT = {
  inventory: process.env.ERP_ACCOUNT_INVENTORY || "1200",
  refundCash: process.env.ERP_ACCOUNT_SUPPLIER_REFUNDS || "1010"
};

const cents = (value) => Math.round(Number(value ?? 0) * 100);
const pesos = (c) => Number((c / 100).toFixed(2));
const pad = (n) => String(n).padStart(2, "0");
const localDate = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value ? new Date(value) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const billId = (invoice) => `SINV-${invoice.invoiceNumber}`;
const errorText = (error) => String(error?.message || error).slice(0, 1000);
const syncStatusFor = (error) => (error instanceof ErpApiError && !error.retryable ? "Failed" : "Pending");

const log = (module, action, entityId, details) =>
  SupplierActivityLog.create({ module, action, entityId, details }).catch(() => {});

/** Creates the supplier in Accounting once (by supplier code) and keeps its details current. */
async function ensureContact(supplier) {
  if (!supplier?.supplierCode) throw new ErpApiError("The supplier has no supplier code; set one before invoicing", 400);
  const details = {
    name: supplier.name,
    email: supplier.email || null,
    phone: supplier.phone || null,
    address: supplier.address || null
  };
  const res = await accounting("POST", "/contacts", { type: "supplier", ...details, external_id: supplier.supplierCode });
  if (res.meta?.duplicate && res.data?.name !== supplier.name) {
    await accounting("PATCH", `/contacts/${encodeURIComponent(supplier.supplierCode)}`, details);
  }
  return supplier.supplierCode;
}

// Accounting's document status -> Procurement's payment status.
function paymentStatusFrom(bill) {
  if (bill.status === "void") return "Voided";
  if (bill.status === "paid" || Number(bill.balance) <= 0) return "Paid";
  if (Number(bill.amountPaid) > 0) return "Partially Paid";
  return "Pending";
}

async function applyBill(invoice, bill) {
  await invoice.update({
    financialSyncStatus: "Synced",
    financialSyncError: null,
    financialReference: bill.number,
    ...(bill.vatAmount !== undefined ? { vatAmount: bill.vatAmount } : {}),
    amountPaid: bill.amountPaid,
    outstandingBalance: bill.balance,
    paymentStatus: paymentStatusFrom(bill)
  });
}

export const financialService = {
  /**
   * 1. Supplier invoice -> Accounts Payable bill in the Accounting ERP.
   */
  dispatchPayable: async (supplierInvoiceId) => {
    const invoice = await SupplierInvoice.findByPk(supplierInvoiceId, {
      include: [
        { model: Supplier, as: "Supplier" },
        { model: PurchaseOrder, as: "PurchaseOrder" }
      ]
    });
    if (!invoice) return { success: false, error: `Supplier invoice #${supplierInvoiceId} not found.` };

    try {
      const contact = await ensureContact(invoice.Supplier);
      const po = invoice.PurchaseOrder?.poNumber;
      const res = await accounting("POST", "/bills", {
        contact,
        issue_date: localDate(invoice.invoiceDate),
        due_date: localDate(invoice.dueDate),
        reference: invoice.invoiceNumber,
        memo: po ? `Purchase order ${po}` : null,
        // A VAT-inclusive supplier invoice: Accounting takes the 12% VAT out of the total as Input VAT.
        vat: Boolean(invoice.vatInclusive),
        vat_inclusive: Boolean(invoice.vatInclusive),
        external_id: billId(invoice),
        lines: [{
          account: ACCOUNT.inventory,
          description: `Supplier invoice ${invoice.invoiceNumber}${po ? ` for ${po}` : ""}`,
          quantity: 1,
          unit_price: Number(invoice.invoiceTotal)
        }]
      });
      await applyBill(invoice, res.data);
      await log("FinancialSync", "PayableDispatched", invoice.id, { invoiceNumber: invoice.invoiceNumber, bill: res.data.number, duplicate: !!res.meta?.duplicate });
      return { success: true, synced: true, status: "Synced", financialReference: res.data.number };
    } catch (error) {
      const status = syncStatusFor(error);
      await invoice.update({ financialSyncStatus: status, financialSyncError: errorText(error) });
      await log("FinancialSync", status === "Pending" ? "PayableQueued" : "PayableFailed", invoice.id, { invoiceNumber: invoice.invoiceNumber, error: errorText(error) });
      return { success: status !== "Failed", synced: false, status, error: errorText(error) };
    }
  },

  /**
   * 2. Payment status comes from Accounting (it records the actual payments). Procurement only reads it.
   */
  refreshPayment: async (supplierInvoiceId) => {
    const invoice = await SupplierInvoice.findByPk(supplierInvoiceId);
    if (!invoice || invoice.financialSyncStatus !== "Synced") return { success: false, skipped: true };
    try {
      const res = await accounting("GET", `/bills/${encodeURIComponent(billId(invoice))}`);
      const before = invoice.paymentStatus;
      await applyBill(invoice, res.data);
      if (before !== invoice.paymentStatus) {
        await log("PaymentSync", "PaymentStatusChanged", invoice.id, { invoiceNumber: invoice.invoiceNumber, from: before, to: invoice.paymentStatus, amountPaid: invoice.amountPaid });
      }
      return { success: true, paymentStatus: invoice.paymentStatus };
    } catch (error) {
      return { success: false, error: errorText(error) };
    }
  },

  /**
   * The old push webhook let anyone mark an invoice paid without a key. Payments now come only from
   * Accounting through refreshPayment().
   */
  processPaymentWebhook: async () => ({
    success: false,
    message: "Payment updates are read from the Accounting ERP; this webhook is no longer used."
  }),

  /**
   * 3. Refunded supplier return -> cash received back from the supplier, inventory reduced.
   */
  dispatchCreditMemo: async (supplierReturnId) => {
    const ret = await SupplierReturn.findByPk(supplierReturnId, {
      include: [{ model: Supplier, as: "Supplier" }, { model: SupplierReturnItem, as: "Items" }]
    });
    if (!ret) return { success: false, error: "Supplier return not found." };
    if (ret.status !== "Refunded") return { success: true, skipped: true };

    try {
      // Value of the returned goods at the price on the purchase order.
      const poItems = await PurchaseOrderItem.findAll({ where: { purchaseOrderId: ret.purchaseOrderId } });
      let amount = 0;
      for (const item of ret.Items || []) {
        const poItem = poItems.find((p) => p.productId === item.productId) || poItems.find((p) => p.productName === item.productName);
        if (!poItem) throw new ErpApiError(`No purchase order price for returned item "${item.productName}"`, 400);
        amount += Math.round(Number(item.quantity) * cents(poItem.unitPrice));
      }
      if (amount <= 0) throw new ErpApiError("The returned items have no value to refund", 400);
      await ret.update({ creditAmount: pesos(amount).toFixed(2) });

      const supplierName = ret.Supplier?.name || "supplier";
      const res = await accounting("POST", "/journal-entries", {
        entry_date: localDate(new Date()),
        reference: ret.returnNumber,
        description: `Refund from ${supplierName} for return ${ret.returnNumber}`,
        external_id: `SRET-${ret.returnNumber}`,
        lines: [
          { account: ACCOUNT.refundCash, debit: pesos(amount), description: `Refund received from ${supplierName}` },
          { account: ACCOUNT.inventory, credit: pesos(amount), description: "Returned goods" }
        ]
      });
      await ret.update({ accountingSyncStatus: "Synced", accountingEntryNumber: res.data.entryNumber, accountingSyncError: null });
      await log("CreditMemoSync", "Dispatched", ret.id, { returnNumber: ret.returnNumber, amount: pesos(amount), entry: res.data.entryNumber });
      return { success: true, dispatched: true, entryNumber: res.data.entryNumber };
    } catch (error) {
      const status = syncStatusFor(error);
      await ret.update({ accountingSyncStatus: status, accountingSyncError: errorText(error) });
      await log("CreditMemoSync", status === "Pending" ? "Queued" : "Failed", ret.id, { returnNumber: ret.returnNumber, error: errorText(error) });
      return { success: status !== "Failed", dispatched: false, status, error: errorText(error) };
    }
  }
};
