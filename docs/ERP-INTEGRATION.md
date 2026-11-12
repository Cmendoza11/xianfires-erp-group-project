# DJ's ERP — how the 5 modules work as one system

DJ's ERP joins five separately built XianFire apps into one ERP for the restaurant. **Each module has
its own MySQL database**, and the modules share data only through each other's APIs:

| Module | Folder | Port | Database | Tables |
|---|---|---|---|---|
| Accounting | `xianfires erp project/` | 3000 | `xianfires_erp` | `accounting_*`, `contact`, `invoice`, `payment`, … |
| POS & Inventory | `PointOfSales-main/PointOfSales-main/` | 3001 | `djs_pos` | `pos_*` |
| Human Resources | `DJs-Human-Resource-Management-main/` | 3002 | `djs_hr` | `hr_*` |
| Procurement (suppliers) | `eventdriven_selda-main/eventdriven_selda-main/` | 3003 | `djs_procurement` | `scm_*` |
| Customer Logs (loyalty) | `Dj-s-Customer-Logs-main/Dj-s-Customer-Logs-main/` | 3004 | `djs_customer_logs` | `crm_*` |

Each module keeps its own login, screens and database; a "DJ's ERP modules" section in every sidebar
links them together, and Accounting's **Enterprise Overview** (`/admin/enterprise`) shows live figures
that it asks from all five modules' APIs.

## Running it

From the workspace root (Node 20.12 or newer, MySQL running in Laragon):

```bash
npm run setup      # npm install in every module that needs it
npm run migrate    # creates/updates the five databases, issues the API keys (safe to re-run)
npm run accounts   # one admin login (same email and password) in all five modules
npm run dev        # starts all 5 modules; Ctrl+C stops them
npm run check      # syntax check of every module
```

- `npm run migrate` copies `.env.example` to `.env` on the first run and fills in the generated
  secrets (`ERP_INTERNAL_KEY`, `SESSION_SECRET`, `ERP_API_KEY_POS/HR/SCM`). HR and Procurement
  create their first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (HR asks when they are empty).
- Every step only creates what is missing; no table is dropped or emptied. Running it again keeps
  the API keys that still work.
- Older installs kept every module inside `xianfires_erp` (one database). `npm run migrate` first
  moves each module's tables into that module's own database with `RENAME TABLE`, so rows, indexes,
  auto-increment counters and the module's own foreign keys move with them
  (`scripts/split-databases.js`; it can also be run on its own).
- `npm run dev -- --only=pos,erp` starts only some modules.
- Database names, ports and URLs can be changed in `.env` (`DB_NAME_ERP`, `DB_NAME_HR`, …,
  `PORT_*`, `ERP_URL_*`).
- **Another set of databases** (for testing without touching real data): `DB_SUFFIX=_demo` uses
  `xianfires_erp_demo`, `djs_hr_demo`, `djs_pos_demo`, `djs_procurement_demo` and
  `djs_customer_logs_demo`. In PowerShell: `$env:DB_SUFFIX="_demo"; npm run migrate`, then
  `npm run dev` in the same terminal. Each set keeps its own Accounting keys in `.env`
  (`ERP_API_KEY_POS_DEMO`, …), so switching sets needs no re-migrate. The older
  `DB_NAME=xianfires_erp_demo` still selects the `_demo` set.

## Who owns what

Each module's data lives in **its own database, and only that module reads or writes it**.

| Data | Owner | Used by |
|---|---|---|
| Employees, departments | HR | Procurement (department list), Enterprise Overview |
| Products, stock | POS & Inventory | Procurement (catalog, deliveries, returns) |
| Customers, loyalty | Customer Logs | POS checkout |
| Suppliers | Procurement | Accounting (as supplier contacts) |
| Ledger, payables, payments, VAT | Accounting | everyone posts through its API |

Another module's data is **read and changed only through that module's API**:

| Module | API | Key |
|---|---|---|
| Accounting | `/api/v1/*`: accounts, contacts, journal entries, invoices, bills, payments, reports (see `xianfires erp project/docs/ERP-API.md`) | the caller's own `Authorization: Bearer xfk_…` |
| POS & Inventory | `GET/POST /api/v1/inventory/products`, `GET /api/v1/inventory/low-stock-alerts`, `POST /api/v1/inventory/stock-in`, `POST /api/v1/inventory/stock-adjust`, `GET /api/v1/erp/summary` | `X-ERP-Key` |
| HR | `GET /api/v1/departments`, `GET /api/v1/payrolls`, `GET /api/v1/payrolls/:id`, `GET /api/v1/erp/summary` | `X-ERP-Key` |
| Procurement | `GET /api/v1/erp/summary` | `X-ERP-Key` |
| Customer Logs | `/api/customers` (search, details, loyalty), `/api/customer-logs`, `/api/promos` (`GET`, `POST /quote`, `POST /redeem`, `POST /void`), `GET /api/erp/summary` | `X-ERP-Key` |

`X-ERP-Key` is `ERP_INTERNAL_KEY` from the root `.env`. Ledger rules (balanced entries, closed
periods) apply to everything posted to Accounting.

## Relations in the database

Open http://localhost/phpmyadmin (user `root`, no password): the five databases are listed by name.

| Database | Tables | Foreign keys (inside the database) |
|---|---|---|
| `xianfires_erp` (Accounting) | 15 | 17 |
| `djs_hr` | 6 | 7 |
| `djs_pos` | 14 | 12 |
| `djs_procurement` | 14 | 24 |
| `djs_customer_logs` | 7 | 6 |

Inside a module, tables are joined by real foreign keys (66 in total; the **Designer** tab of each
database draws them). **Between modules** there are no foreign keys, because the modules are
separate databases: rows point at each other through key columns, and the owning module's API keeps
those links correct:

| Column | Points to | How the link is made and kept |
|---|---|---|
| `djs_pos.pos_orders.customerId`, `djs_pos.pos_transactions.customerId` | `djs_customer_logs.crm_customers.customerId` | chosen in the checkout picker (Customer Logs API); `customerName` is copied so the sale keeps the name |
| `djs_customer_logs.crm_customer_logs.transactionReference` (when `sourceModule = 'POS'`) | `djs_pos.pos_transactions.transactionNumber` | POS sends the purchase or refund through the Customer Logs API |
| `djs_customer_logs.crm_promo_redemptions.transactionReference` (when `source = 'POS'`) | `djs_pos.pos_transactions.transactionNumber` (`promoCode`) | POS checks the promo with `/api/promos/quote` at checkout, then records it with `/api/promos/redeem`; a void calls `/api/promos/void` |
| `productId` in `djs_procurement.scm_supplier_products`, `scm_purchase_request_items`, `scm_purchase_order_items`, `scm_goods_receipt_items`, `scm_supplier_return_items` | `djs_pos.pos_products.id` | found by name, or created as a **Supply** item, through the POS inventory API |
| `djs_procurement.scm_departments.id` (and `departmentId` in `scm_purchase_requests`, `scm_purchase_orders`) | `djs_hr.hr_departments.id` | Procurement mirrors HR's departments with the same ids, from the HR API |
| `djs_hr.hr_payrolls.accountingEntryNumber` | Accounting journal entry | posted through `/api/v1` as `HR-PAY-<id>` when HR marks the payroll Paid |
| `djs_procurement.scm_supplier_invoices.financialReference` | Accounting bill (`invoice` with `kind = 'bill'`) | posted through `/api/v1` as `SINV-<invoice no.>` |
| `djs_procurement.scm_supplier_returns.accountingEntryNumber` | Accounting journal entry | posted through `/api/v1` as `SRET-<return no.>` |
| `xianfires_erp.integration_reference` (`api_client_id`, `external_id`) | the Accounting row each module created | one row per posting, so a retry never posts twice |

Keeping the links in the APIs also means each module keeps working while another is stopped (POS
still sells when Accounting or Customer Logs is down; Procurement still receives when POS is down),
and each module can be migrated on its own.

The databases are on the same MySQL server, so a checker can still join them in one query
(phpMyAdmin → **SQL** tab; read-only):

```sql
-- POS sale → Customer Logs customer → Accounting journal entry
SELECT t.transactionNumber, t.totalAmount, c.name AS customer, e.accounting_journal_entry_id AS journal_entry_id
FROM djs_pos.pos_transactions t
LEFT JOIN djs_customer_logs.crm_customers c ON c.customerId = t.customerId
LEFT JOIN xianfires_erp.integration_reference r ON r.external_id = CONCAT('POS-', t.transactionNumber)
LEFT JOIN xianfires_erp.accounting_journal_entry e ON e.uuid = r.entity_uuid;

-- Procurement supplier product → POS stock item
SELECT s.name AS supplier, sp.productName, p.id AS pos_product_id, p.type, i.currentStock
FROM djs_procurement.scm_supplier_products sp
JOIN djs_procurement.scm_suppliers s ON s.id = sp.supplierId
JOIN djs_pos.pos_products p ON p.id = sp.productId
JOIN djs_pos.pos_inventory i ON i.productId = p.id;

-- HR departments = Procurement departments
SELECT h.id, h.code, h.name AS hr_department, s.name AS procurement_department, s.status
FROM djs_hr.hr_departments h LEFT JOIN djs_procurement.scm_departments s ON s.id = h.id;

-- HR payroll → Accounting journal entry
SELECT p.id, CONCAT(e.firstName, ' ', e.lastName) AS employee, p.netSalary, p.status, p.accountingEntryNumber
FROM djs_hr.hr_payrolls p JOIN djs_hr.hr_employees e ON e.id = p.employeeId;
```

## What flows between the modules

| When | From → To | What happens | In Accounting |
|---|---|---|---|
| A sale is paid | POS → Accounting | journal entry `POS-<transaction no.>` | Dr 1000 Cash on Hand (cash) or 1010 Cash in Bank (GCash, Maya, card); Dr 4200 Sales Discounts; Cr 4000 Sales; Cr 4500 Other Income (service charge); Cr 2200 Output VAT |
| A sale is voided | POS → Accounting | reversing entry | the sale's entry reversed |
| A sale has a customer | POS → Customer Logs | purchase log (+1 loyalty point, total spent) | — |
| That sale is voided | POS → Customer Logs | refund log (−1 point) | — |
| HR computes payroll from attendance (DTR) | inside HR | days paid × rate per day, overtime (beyond 8 h) × hourly rate × 125%, minus SSS 5% / PhilHealth 2.5% / Pag-IBIG 2% (employee share; half for a kinsenas) and any cash advance | — |
| HR clicks **Mark as Paid** | HR → Accounting | journal entry `HR-PAY-<id>`; Paid then becomes final in HR. Accounting's **Payroll** page lists HR's approved and paid payslips (read-only, through HR's API) | Dr 6000 Salaries (gross); Cr 2400 SSS/PhilHealth/Pag-IBIG; Cr 1110 Advances to Employees (cash advance repaid); Cr 1010 Cash in Bank (net pay) |
| A customer uses a promo code at the POS | POS ↔ Customer Logs | the POS asks Customer Logs for the discount (`/api/promos/quote`: code, validity dates, minimum spend, earlier purchases, points cost); after the sale it records the redemption with the transaction number (and the points cost is taken from the customer's balance); a void cancels it and gives the points back | the promo discount is part of Dr 4200 Sales Discounts |
| Departments change in HR | HR → Procurement | Procurement copies HR's list (same ids) from the HR API: on department, request and order pages, and every minute | — |
| A supplier product or PO line is saved | Procurement → POS | linked to the POS item with that name, or a new stock-only **Supply** item is created; rows saved while the POS was offline are linked when it answers again | — |
| Goods are received | Procurement → POS | accepted quantity added to stock (`Stock In` movement) | — |
| Goods are returned | Procurement → POS | returned quantity removed from stock (`Stock Out`) | — |
| A supplier invoice is recorded | Procurement → Accounting | supplier contact + bill `SINV-<invoice no.>`; "Amount includes 12% VAT" sends `vat_inclusive` so Accounting takes the VAT out of the total | Dr 1200 Merchandise Inventory (net); Dr 1400 Input VAT (when VAT-inclusive); Cr 2000 Accounts Payable (total) |
| The bill is paid in Accounting | Accounting → Procurement | Procurement reads the status: Partially Paid / Paid / Voided | the payment entry |
| A return is resolved as Refunded | Procurement → Accounting | journal entry `SRET-<return no.>` | Dr 1010 Cash in Bank; Cr 1200 Merchandise Inventory |
| Enterprise Overview is opened | every module → Accounting | each module's `/erp/summary` API answers with its figures; a module that is stopped is shown as not reachable | — |

Account codes are the Accounting module's default chart. If yours differ, set the `ERP_ACCOUNT_*`
variables in `.env` (see `utils/erpSync.js` in POS, `services/accountingSync.js` in HR and
`services/financialService.js` in Procurement).

## Why nothing is lost or posted twice

- Every message carries the sender's own id (`external_id` such as `POS-TXN-…`). Accounting and
  Customer Logs apply each id once, so a retry after a timeout never books a sale twice.
- The POS writes each message to `pos_integration_outbox` **in the same database transaction as the
  sale or void**, then sends it. If Accounting or Customer Logs is offline the sale still completes;
  the message waits and is retried every minute. A customer already chosen at checkout is kept even
  when Customer Logs is offline, and Customer Logs checks the id when the purchase arrives.
- HR and Procurement keep a sync status on the record itself (Pending / Synced / Failed, plus the
  error). Pending is retried every minute; Failed means the other module refused it (for example a
  closed accounting period or a fractional stock quantity) and needs a person to fix the cause.
- Each record page shows its status, and has a retry button for admins (POS transaction, HR payslip).
  Enterprise Overview lists everything waiting or failed.

## Rules for changing the code

- A module reads and writes **only its own database**. To use another module's data, call that
  module's API, or add an endpoint to it (protected with `X-ERP-Key`).
- Keep your module's table prefix (`hr_`, `pos_`, `scm_`, `crm_`) and set `tableName` explicitly in
  the model.
- New columns: add them to the model; each module's migrate/start-up adds missing columns
  (and missing ENUM values) without touching data. Accounting has its own migration steps (see its
  `CLAUDE.md`).
- Never use `sync({ force: true })`, `TRUNCATE` or `DROP` on a real database.
  Procurement's `reset-db.js` / `seed-user-data.js` only touch `scm_*` tables and
  `test-all-flows.js` needs `--write-test-data`.
- Session cookies have different names per module (`xf_erp.sid`, `xf_pos.sid`, …) because the
  modules share `localhost`; keep them distinct.

## Closing the books

- **Monthly lock** (Accounting > Period Closing): lock a month once its books are final; nothing dated in
  it or before it can be posted, changed or deleted. Locks are kept in order, so "Unlock latest month"
  puts the books back exactly as they were before that lock.
- **Fiscal year close**: posts the closing entry to retained earnings and locks the year.

## Known limits

- POS stock is counted in whole units, so a delivery of 2.5 kg is refused until it is recorded as a
  whole quantity.
- POS sales do not post cost of goods sold; post a periodic stock count adjustment
  (Dr 5000 / Cr 1200) in Accounting.
- The VAT report's VAT amounts include POS sales, but its "vatable sales" base lists only invoices.
- A supplier refund is booked as cash received; a credit against an unpaid bill is handled in
  Accounting by voiding and re-issuing the bill.
- One shared `X-ERP-Key` is used between modules (Accounting has a separate key per module).
- While HR is stopped, Procurement keeps its last copy of the departments; while POS is stopped,
  Procurement cannot list POS items (new items are linked once the POS answers).
- Procurement's own pages still have no login check (as before the integration).
