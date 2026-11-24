import { QueryTypes } from "sequelize";
import { sequelize, Contact, Invoice } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError } from "./accountTypes.js";
import { assertFormat, assertSafeText, FORMATS } from "./securityService.js";

export const CONTACT_TYPES = {
  customer: { label: "Customer", plural: "Customers", documentKind: "invoice" },
  supplier: { label: "Supplier", plural: "Suppliers", documentKind: "bill" }
};

const editUrl = (type, uuid) => (type === "customer" ? urls.customerEdit(uuid) : urls.supplierEdit(uuid));

function toContact(row) {
  return {
    contactId: row.contact_id,
    uuid: row.uuid,
    type: row.type,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    tin: row.tin,
    status: Number(row.status),
    outstanding: Number(row.outstanding ?? 0),
    openDocuments: Number(row.open_documents ?? 0),
    editUrl: editUrl(row.type, row.uuid),
    updateApi: urls.updateContact(row.uuid),
    deleteApi: urls.deleteContact(row.uuid)
  };
}

// Contacts with their unpaid balance across open invoices or bills.
export async function listContacts(type, { includeInactive = true } = {}) {
  const rows = await sequelize.query(
    `SELECT c.*,
       COALESCE(SUM(CASE WHEN i.status = 'open' THEN i.total - i.amount_paid ELSE 0 END), 0) AS outstanding,
       COALESCE(SUM(CASE WHEN i.status = 'open' THEN 1 ELSE 0 END), 0) AS open_documents
     FROM contact c
     LEFT JOIN invoice i ON i.contact_id = c.contact_id
     WHERE c.type = ? AND c.deleted_at IS NULL ${includeInactive ? "" : "AND c.status = 1"}
     GROUP BY c.contact_id
     ORDER BY c.name`,
    { replacements: [type], type: QueryTypes.SELECT }
  );
  return rows.map(toContact);
}

export async function getContact(uuid) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  const row = await Contact.findOne({ where: { uuid }, raw: true });
  return row ? toContact(row) : null;
}

function normalize(type, data, current) {
  const name = String(data.name ?? current?.name ?? "").trim();
  if (!name) {
    throw new AccountingValidationError(`${CONTACT_TYPES[type].label} name is required`);
  }
  if (name.length < 2 || name.length > 150) throw new AccountingValidationError("Name must be 2 to 150 characters");
  assertSafeText(name, "Name");
  const email = String(data.email ?? current?.email ?? "").trim();
  // Only fields sent in this request are checked, so older records can still be updated.
  if (data.email && email) assertFormat(email, FORMATS.email, "Enter a valid email address, e.g. name@company.com");
  const sent = (key) => data[key] !== undefined && String(data[key]).trim() !== "";
  if (sent("tin")) assertFormat(String(data.tin).trim(), FORMATS.tin, "TIN must look like 000-000-000 or 000-000-000-000");
  if (sent("phone")) assertFormat(String(data.phone).trim(), FORMATS.phone, "Phone may only contain digits, spaces, + ( ) and -, e.g. 0917 123 4567");
  if (sent("address")) assertSafeText(data.address, "Address");
  const text = (key) => {
    const value = data[key] === undefined ? current?.[key] : data[key];
    return value ? String(value).trim() || null : null;
  };
  return {
    name,
    email: email || null,
    phone: text("phone"),
    address: text("address"),
    tin: text("tin"),
    status:
      data.status === undefined ? current?.status ?? 1 : [1, "1", true, "true"].includes(data.status) ? 1 : 0
  };
}

export async function createContact(type, data) {
  if (!CONTACT_TYPES[type]) {
    throw new AccountingValidationError("Invalid contact type");
  }
  const contact = await Contact.create({ type, ...normalize(type, data ?? {}) });
  return contact.get({ plain: true });
}

export async function updateContact(uuid, data) {
  const current = UUID_PATTERN.test(uuid) ? await Contact.findOne({ where: { uuid } }) : null;
  if (!current) {
    throw new AccountingValidationError("Contact not found");
  }
  const before = current.get({ plain: true });
  await current.update(normalize(current.type, data ?? {}, before));
  return { before, after: current.get({ plain: true }) };
}

export async function deleteContact(uuid) {
  const contact = UUID_PATTERN.test(uuid) ? await Contact.findOne({ where: { uuid } }) : null;
  if (!contact) {
    throw new AccountingValidationError("Contact not found");
  }
  if (await Invoice.findOne({ where: { contact_id: contact.contact_id }, attributes: ["invoice_id"] })) {
    throw new AccountingValidationError(
      `${contact.name} has invoices or bills and cannot be deleted. Set it to inactive instead.`
    );
  }
  const plain = contact.get({ plain: true });
  await contact.destroy();
  return plain;
}
