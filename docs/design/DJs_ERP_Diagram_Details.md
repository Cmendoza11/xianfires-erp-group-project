# DJ's ERP: details for the 17 system design diagrams

The diagrams follow `diagram base.docx` (Figures 1–17). The five modules are drawn as **one system**,
DJ's ERP. Each module keeps its own MySQL database, and the modules share data only through APIs.

**Same style in every diagram (one colour per module):**

| Module | Port | Database | Colour |
|---|---|---|---|
| Accounting | 3000 | `xianfires_erp` | blue |
| POS & Inventory | 3001 | `djs_pos` | orange |
| Human Resources | 3002 | `djs_hr` | green |
| Procurement | 3003 | `djs_procurement` | purple |
| Customer Logs | 3004 | `djs_customer_logs` | pink |
| Shared / platform | – | – | teal |

**Words used in every diagram:**
- `X-ERP-Key`: the header one module sends when it calls another module's API (ERP_INTERNAL_KEY).
- `Bearer xfk_…`: the key each module uses for Accounting's `/api/v1`. Each key has scopes:
  - POS: `journal:write`
  - HR: `journal:write`
  - Procurement: `contacts:write`, `purchases:write`, `journal:write`
- `external_id`: the sender's own id, such as `POS-TXN-…`, `HR-PAY-<id>`, `SINV-<no.>` or `SRET-<no.>`.
  Accounting saves it in `integration_reference`, so a retry never posts twice.
- Sync status: Pending / Synced / Failed. Pending items are retried every 60 s.

---

## III. Structural Diagrams (The System at Rest)

### Figure 1: System Architecture Diagram

**Title band:** "System Architecture Diagram", with the subtitle "DJ's ERP: five modules working as one system".

**Left: Users** (each module has its own login):
- **Owner / Administrator** (admin role in every module): users, settings, monthly lock, Enterprise Overview
- **Accountant · Viewer**: journal, invoices, bills, payments, bank reconciliation, reports (Viewer is read-only)
- **Cashier · Inventory staff**: orders, checkout, receipts, voids, promo codes, products, stock, low-stock alerts
- **HR staff · Employee**: employees, departments, attendance (DTR), leaves, payroll, payslips, Mark as Paid
- **Purchasing staff**: purchase requests and orders, goods receipts (batch, expiry), supplier invoices and returns
- **Customer-service staff**: customers, visits, loyalty points, promo codes, redemptions
- **Web Browser**: Chrome / Edge on a PC, laptop or tablet; one tab per module (ports 3000–3004); Print / Save as PDF

**Arrow:** Users ↔ Application Servers, labelled "HTTP(S) :3000–3004".

**Center: Application Servers** (Node.js 24 · Express 4 · XianFire framework, one process per module):
- **Accounting :3000**
  - Does: chart of accounts, journal, sales invoices, bills, payments, bank reconciliation, reports, period closing, monthly lock.
  - Links: provides `/api/v1`. The Enterprise Overview reads every module's `/erp/summary`, and the Payroll page reads HR.
- **POS & Inventory :3001**
  - Does: tables, orders, checkout (Cash, GCash, Maya, card), receipts, discounts, products, stock, stock movements.
  - Links: the outbox sends to Accounting (`POS-<txn>`, voids reversed) and to Customer Logs (purchase, promo). Provides `/api/v1/inventory`.
- **Human Resources :3002**
  - Does: employees, departments, DTR, leaves, payroll with SSS / PhilHealth / Pag-IBIG / cash advance.
  - Links: Mark as Paid sends Accounting the journal `HR-PAY-<id>`. Provides `/api/v1/departments` and `/api/v1/payrolls`.
- **Procurement :3003**
  - Does: suppliers, purchase requests, purchase orders, goods receipts, supplier invoices (VAT), returns.
  - Links: stock in / out goes to POS. Bills `SINV-<no.>` and refunds `SRET-<no.>` go to Accounting. Departments come from HR.
- **Customer Logs :3004**
  - Does: customers, visit and purchase logs, loyalty points and tiers, promo codes, redemptions.
  - Links: provides `/api/customers`, `/api/customer-logs` and `/api/promos` (quote, redeem, void).
- **Integration layer** strip (HTTP + JSON; no table is shared), three columns:
  - Accounting `/api/v1`: Bearer `xfk_` key + scopes; `external_id` in `integration_reference`
  - Module APIs: `X-ERP-Key`
  - Reliability: POS outbox, plus the HR and Procurement sync status, retried every 60 s

**Right: Database Server.** MySQL 8.4 (Laragon), port 3306. One "SQL / TCP" arrow goes from each module to its own database:
- `xianfires_erp`: admin_user, accounting_account, accounting_journal_entry / _line, contact, invoice / invoice_line,
  payment, bank_reconciliation, accounting_period_close, api_client, integration_reference, setting, audit_log
- `djs_pos`: pos_users, pos_products, pos_categories, pos_inventory, pos_inventory_movements, pos_orders / _items,
  pos_transactions, pos_payments, pos_discounts, pos_restaurant_tables, pos_integration_outbox
- `djs_hr`: hr_users, hr_employees, hr_departments, hr_attendances, hr_leaves, hr_payrolls
- `djs_procurement`: scm_suppliers, scm_supplier_products, scm_purchase_requests / _items, scm_purchase_orders / _items,
  scm_goods_receipts / _items, scm_supplier_invoices, scm_supplier_returns / _items, scm_departments
- `djs_customer_logs`: crm_users, crm_customers, crm_customer_logs, crm_loyalty_records, crm_promos,
  crm_promo_redemptions, crm_audit_logs

**Bottom row:**
- **Network**: LAN or localhost; ports 3000–3004; HTTPS through an optional reverse proxy
- **Command-line Tools**: `npm run setup`, `migrate` (5 databases + API keys), `accounts` (one admin in all 5), `dev` (starts all 5), `check`
- **Configuration (.env)**: DB_HOST, DB_PORT, DB_USER, DB_SUFFIX, PORT_*, ERP_API_KEY_*, ERP_INTERNAL_KEY, ERP_ACCOUNT_*
- **Key Rules**: a module writes only its own database; debits equal credits; each post happens once; closed years and locked months refuse posts

**Legend:** the module colours, plus "Request / response" (solid arrow) and "Setup / configuration" (dashed).

---

### Figure 2: Class Diagram

Draw one package frame per module, named after the module and its database.

**Inside a module:** use solid associations (these are real foreign keys).

**Between modules:** use dashed «API» dependencies, with no foreign key; the rows are matched by id or `external_id`.

**POS & Inventory (`djs_pos`)**
- Product: -name, -type : {Food, Beverage, Dessert, Combo, Other, Supply}, -price, -status : {active, archived}
- Inventory: -currentStock : int, -minStockLevel : int; +stockIn(), +stockAdjust()
- InventoryMovement: -type : {Stock In, Stock Out, Sales Deduction, Adjustment, Void/Reversal}, -previousStock, -newStock, -referenceNumber
- Order: -orderNumber, -type : {Dine-In, Take-Out}, -status : {Pending, Preparing, Ready, Completed, Cancelled}, -customerId (CRM id), -promoCode; +applyPromo(code)
- OrderItem: -productId, -quantity, -unitPrice
- Transaction: -transactionNumber, -subtotal, -discountAmount, -promoDiscountAmount, -taxAmount, -serviceCharge, -totalAmount, -status : {Completed, Voided, Refunded}; +checkout(), +void(reason)
- Payment: -method : {Cash, GCash, Maya, Credit/Debit Card}, -amount, -status
- IntegrationOutbox: -target : {accounting, customers}, -event : {sale, void}, -status : SyncStatus, -attempts, -nextAttemptAt, -lastError; +dispatch()
- Relations:
  - Order ◆ 1..* OrderItem
  - OrderItem * — 1 Product
  - Product 1 — 1 Inventory
  - Product 1 — * InventoryMovement
  - Order 1 — 0..1 Transaction
  - Transaction 1 — * Payment
  - Transaction 1 — * IntegrationOutbox

**Customer Logs (`djs_customer_logs`)**
- Customer: -name, -contactNumber, -email, -address, -status : {ACTIVE, INACTIVE, BLOCKED}, -totalSpent, -lastPurchaseDate
- CustomerLog: -activityType : {PURCHASE, VISIT, REFUND}, -amount, -transactionReference, -sourceModule, -activityAt; +recordLog()
- LoyaltyRecord: -pointsBalance : int, -tier : {Silver ≥ 5, Gold ≥ 10}; +addPoints(n)
- Promo: -code, -discountType : {percent, fixed}, -discountValue, -minimumSpend, -pointsCost, -minimumPurchases, -startDate, -endDate; +quote(code, subtotal)
- PromoRedemption: -promoCode, -transactionReference, -discountAmount, -pointsUsed, -status : {Redeemed, Voided}; +redeem(), +void()
- Relations:
  - Customer 1 — * CustomerLog
  - Customer 1 — 1 LoyaltyRecord
  - Promo 1 — * PromoRedemption

**Accounting (`xianfires_erp`)**
- Contact: -type : {customer, supplier}, -name, -tin
- Invoice (kind = invoice or bill): -number, -vatInclusive, -vatAmount, -total, -amountPaid, -status : {open, paid, void}; +recordPayment()
- Payment: -paymentDate, -amount, -cashAccountId, -status : {posted, void}; +voidPayment()
- Account: -code, -name, -type : {ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE}
- JournalEntry: -reference, -entryDate, -entryType : {MANUAL, REVERSAL, CLOSING, INVOICE, BILL, RECEIPT, DISBURSEMENT}, -reversalOfId; +postEntry(lines), +reverse()
- JournalLine: -accountId, -debit, -credit
- IntegrationReference: -externalId, -entityType, -entityId; +createOnce()
- ApiClient: -name, -keyPrefix (`xfk_`), -scopes; +authenticate(key)
- Relations:
  - Contact 1 — * Invoice
  - Invoice 1 — * Payment
  - JournalEntry ◆ 2..* JournalLine
  - JournalLine * — 1 Account
  - Invoice and Payment post a JournalEntry
  - ApiClient 1 — * IntegrationReference → JournalEntry / Invoice

**Human Resources (`djs_hr`)**
- Employee: -employeeCode, -firstName, -lastName, -position, -salary, -dailyRate, -status : {Active, On Leave, Resigned}
- Department: -code, -name, -headId
- Attendance (DTR): -employeeId, -date, -checkIn, -checkOut, -status : {Present, Late, Absent, Half Day}
- Leave: -type, -status : {Pending, Approved, Rejected}
- Payroll:
  - Fields: -periodStart, -periodEnd, -daysWorked, -overtimeHours, -basicSalary, -overtime, -sssDeduction, -philhealthDeduction, -pagibigDeduction, -cashAdvance, -netSalary, -status : {Draft, Processed, Paid}, -accountingSyncStatus
  - Operations: +compute(DTR), +markAsPaid()
- Relations:
  - Department 1 — * Employee
  - Employee 1 — * Payroll
  - Employee 1 — * Attendance
  - Employee 1 — * Leave

**Procurement (`djs_procurement`)**
- Supplier: -supplierCode, -name, -paymentTerms, -status
- PurchaseRequest: -requestNumber, -departmentId (HR id), -priority : {Low, Medium, High, Urgent}, -status
- PurchaseOrder: -poNumber, -orderDate, -totalAmount, -status : {Draft, Pending Approval, Approved, Sent to Supplier, Partially Received, Fully Received, Cancelled}
- GoodsReceipt: -receiptNumber, -deliveryDate, -inventorySyncStatus; +receive()
- GoodsReceiptItem: -acceptedQuantity, -batchLotNumber, -expiryDate
- SupplierInvoice: -invoiceNumber, -invoiceTotal, -vatInclusive, -vatAmount, -amountPaid, -paymentStatus, -financialSyncStatus, -financialReference; +dispatchPayable(), +refreshPayment()
- SupplierReturn: -returnNumber, -status, -creditAmount, -accountingSyncStatus
- Department (mirror): -id (same as HR), -code, -name, -status
- Relations:
  - Supplier 1 — * PurchaseOrder
  - PurchaseRequest → PurchaseOrder ("converted to")
  - PurchaseOrder 1 — * GoodsReceipt
  - GoodsReceipt ◆ 1..* GoodsReceiptItem
  - PurchaseOrder 1 — * SupplierInvoice
  - SupplierReturn → GoodsReceipt
  - Department 1 — * PurchaseRequest

**«API» links (dashed, teal):**
- Transaction ⇢ JournalEntry: sale `POS-<txn>`, void = reversal
- IntegrationOutbox ⇢ CustomerLog: purchase / refund log
- IntegrationOutbox ⇢ PromoRedemption: promo quote, redeem, void
- Payroll ⇢ JournalEntry: `HR-PAY-<id>`
- SupplierInvoice ⇢ Invoice (bill): `SINV-<no.>`
- SupplierReturn ⇢ JournalEntry: `SRET-<no.>`
- GoodsReceipt ⇢ InventoryMovement: stock-in / stock-out
- HR Department ⇢ Procurement Department (mirror): departments copied

**Enumerations (yellow):**
- SyncStatus {Pending, Synced, Failed}
- POStatus
- EntryType

---

### Figure 3: Component Diagram

Five «component» boxes plus a «subsystem» Platform box. Each holds 6 inner parts:

| Component | Parts |
|---|---|
| POS & Inventory :3001 | Views (terminal, checkout, receipts) · Router + session · Controllers (posCheckout, posTransaction, posInventory) · inventoryApi (`/api/v1/inventory`) · erpSync + crm.js (outbox worker 60 s) · Models → djs_pos |
| Accounting :3000 | Views + page scripts · Router + auth (requireRole, requireJson, apiKey) · Controllers (13 + apiV1Controller) · Ledger services (journal, invoice, period, report) · Integration services (integrationService, enterpriseService, payrollService) · Models → xianfires_erp |
| Human Resources :3002 | Views · Router + erpApi · Controllers (employee, attendance, leave, payroll) · payrollCalc · accountingSync (retry worker) · Models → djs_hr |
| Customer Logs :3004 | Views · Router + erpKey (`/api/customers`, `/api/customer-logs`, `/api/promos`) · Controllers (customerLogs, promo) · Log service (+1 / −1 point, tiers) · PromoService (quote, redeem, voidRedemption) · Models → djs_customer_logs |
| Procurement :3003 | Views · Router + erpApi · Controllers (purchaseRequest, purchaseOrder, goodsReceipt, invoice) · inventoryService (POS client) · financialService (Accounting client) · hrDirectory + integrationWorker · Models → djs_procurement |
| Platform (repo root) | dev-all.js · migrate-all.js · split-databases.js · accounts.js · erp-env.js + .env · MySQL 8.4 (5 databases) |

**Ball-and-socket links** (the ball sits on the provider, the socket on the consumer):

| Interface | Provider | Consumer | What passes |
|---|---|---|---|
| IAccountingApi | Accounting | POS | journal-entries, reverse |
| IAccountingApi | Accounting | HR | journal-entries |
| IAccountingApi | Accounting | Procurement | contacts, bills, journal, GET bill |
| IHrPayrollApi | HR | Accounting | GET /payrolls |
| IHrDirectoryApi | HR | Procurement | GET /departments |
| IInventoryApi | POS | Procurement | products, stock-in, stock-adjust |
| ICustomerApi | Customer Logs | POS | search, logs, promo quote / redeem / void |
| IErpSummary | POS, HR, Procurement, Customer Logs | Accounting (Enterprise Overview) | `/erp/summary` |

---

### Figure 4: Deployment Diagram

**«device» client nodes:**
- Office PC / laptop. Its browser opens Accounting, HR, Procurement and Customer Logs.
- POS counter PC / tablet. Its browser runs the POS terminal, checkout and receipt printing.
- Owner's laptop / phone. Its browser opens the Enterprise Overview and reports.
- Each client connects to the server over the LAN with HTTP :3000–3004. An optional Nginx / Apache «device» reverse proxy can sit in front and give HTTPS on :443.

**«device» Application Server: Windows PC with Laragon**
- **«execution environment» Node.js 24**, with 5 «artifact» processes:
  - `xianfires erp project` :3000
  - `PointOfSales-main` :3001
  - `DJs-Human-Resource-Management-main` :3002
  - `eventdriven_selda-main` :3003
  - `Dj-s-Customer-Logs-main` :3004
- **Other artifacts in Node.js:** `dev-all.js` (starts the 5), `node_modules`, `.env`
- **Between the processes:** HTTP on localhost (`X-ERP-Key`, Bearer `xfk_`)
- **«execution environment» MySQL 8.4.3 (Laragon)**, with 5 «schema» artifacts: xianfires_erp, djs_pos, djs_hr, djs_procurement, djs_customer_logs
- **Node.js → MySQL:** TCP 3306 on localhost (Sequelize + mysql2)

**Notes:**
- Setup: `npm run setup` → `npm run migrate` → `npm run accounts` → `npm run dev`
- Backup with mysqldump to `Desktop\db-backups` before a migration and before year-end closing
- A `DB_SUFFIX=_demo` set of five databases can run side by side for demos

---

### Figure 5: Object Diagram

**Illustrative snapshot, 12 Nov 2026:** one paid POS sale with a promo, shown in every module it touches.

**POS:**
- `cashier01 : PosUser` {role = cashier}
- `ord1 : Order` {type = Dine-In, customerId = ana, promoCode = "WELCOME10"}
- `item1 : OrderItem` {Chicken Silog, quantity = 4, unitPrice = 150.00}
- `item2 : OrderItem` {Iced Coffee, quantity = 4, unitPrice = 100.00}
- `txn1 : Transaction`
  - transactionNumber = "TXN-20261112-0001"
  - subtotal = 1,000.00
  - promoDiscountAmount = 100.00
  - taxAmount = 108.00
  - totalAmount = 1,008.00
  - status = Completed
- `pay1 : Payment` {method = Cash, amount = 1,008.00, status = Paid}
- `mv1 : InventoryMovement` {type = Sales Deduction, Chicken Silog, previousStock = 40, newStock = 36}
- `ob1 : IntegrationOutbox` {target = accounting, event = sale, status = Synced}
- `ob2 : IntegrationOutbox` {target = customers, event = sale, status = Synced}

**Customer Logs:**
- `ana : Customer` {name = "Ana Reyes", status = ACTIVE, totalSpent = 1,008.00}
- `loy1 : LoyaltyRecord` {pointsBalance = 5, tier = Silver}
- `promo10 : Promo` {code = WELCOME10, percent 10, minimumSpend = 500.00, pointsCost = 0}
- `log1 : CustomerLog` {PURCHASE, amount = 1,008.00, transactionReference = TXN-20261112-0001, sourceModule = POS}
- `red1 : PromoRedemption` {WELCOME10, discountAmount = 100.00, pointsUsed = 0, status = Redeemed}

**Accounting:**
- `je1 : JournalEntry` {reference = "POS-TXN-20261112-0001", entryDate = 2026-11-12}
- The entry's 4 lines:

  | Line | Account | Debit | Credit |
  |---|---|---|---|
  | `l1` | 1000 Cash on Hand | 1,008.00 | |
  | `l2` | 4200 Sales Discounts | 100.00 | |
  | `l3` | 4000 Sales | | 1,000.00 |
  | `l4` | 2200 Output VAT | | 108.00 |
  | Total | | 1,108.00 | 1,108.00 |

- `ref1 : IntegrationReference` {externalId = POS-TXN-20261112-0001, apiClient = "DJ's POS & Inventory"}

**Links:**
- cashier01 creates ord1
- ord1 has item1 and item2
- ord1 → txn1 → pay1, mv1, ob1, ob2
- ob1 ⇢ je1 (via ref1)
- ob2 ⇢ log1 and red1
- log1 → ana → loy1
- red1 → promo10

**Note:** "Data is illustrative."

---

### Figure 6: Package Diagram

**«system» DJ's ERP** contains 6 packages:

**Root tooling** (repo root):
- `scripts/` (erp-env, migrate-all, split-databases, dev-all, accounts)
- `docs/`, `package.json`, `.env`

**Five module packages**, each with layered sub-packages:
- **Presentation:** views (.xian), public
- **Web:** routes, middleware, controllers
- **Business:** services or utils
- **Data:** models (Sequelize)

**Module-specific packages:**
- Accounting:
  - `services`: journal, invoice, period, report, integration, enterprise, payroll
  - `middleware`: auth, apiKey
  - `routes`: index, urls, apiV1
- POS: `utils/erpSync.js`, `utils/crm.js`, `routes/inventoryApi.js`, `routes/erpApi.js`
- HR: `services/payrollCalc.js`, `services/accountingSync.js`, `routes/erpApi.js`, `middleware/erpKey.js`
- Procurement: `services/inventoryService.js`, `services/financialService.js`, `services/hrDirectory.js`, `services/integrationWorker.js`
- Customer Logs: `modules/customerLogs/api` (promoApi), `modules/customerLogs/services` (PromoService), `routes/erpApi.js`, `config/database.js`

**Dependencies inside a module:** routes → controllers → services → models; controllers → views.

**Dependencies between modules** (dashed «access via API», never «import»):
- POS::utils → Accounting::routes(apiV1)
- POS::utils(crm.js) → CustomerLogs::api
- HR::services(accountingSync) → Accounting::routes(apiV1)
- Procurement::services(inventoryService) → POS::routes(inventoryApi)
- Procurement::services(financialService) → Accounting::routes(apiV1)
- Procurement::services(hrDirectory) → HR::routes(erpApi)
- Accounting::services(enterprise, payroll) → each module's erpApi
- Root tooling «use» → each module's migrate and models

---

### Figure 7: Composite Structure Diagram

**Classifier:** `erp : DJsERP`, the whole system.

**Attributes:** ports 3000–3004 · DB_SUFFIX · ERP_INTERNAL_KEY · ERP_API_KEY_* (one per module).

**Parts:**
- `acc : Accounting` [:3000] → xianfires_erp
- `pos : POSInventory` [:3001] → djs_pos
- `hr : HumanResources` [:3002] → djs_hr
- `scm : Procurement` [:3003] → djs_procurement
- `crm : CustomerLogs` [:3004] → djs_customer_logs
- `db : MySQLServer` (MySQL 8.4, port 3306, 5 databases)
- `launcher : dev-all.js`

**Ports on the boundary:**
- `pWeb` (HTTP 3000–3004)
- `pDb` (TCP 3306)

**Interfaces:**
- Provided (lollipop): IWebUI
- Required (socket): IDatabase

**Connectors:**
- pos → acc: IAccountingApi, `POS-<txn>` and void reversal (Bearer `xfk_`)
- hr → acc: IAccountingApi, `HR-PAY-<id>` on Mark as Paid
- scm → acc: IAccountingApi, contact, bill `SINV-<no.>`, refund `SRET-<no.>`, bill status read-back
- acc → hr: IHrPayrollApi, `GET /api/v1/payrolls`
- pos → crm: ICustomerApi, search, purchase/refund log, promo quote/redeem/void (`X-ERP-Key`)
- scm → pos: IInventoryApi, products, stock-in, stock-adjust (`X-ERP-Key`)
- scm → hr: IHrDirectoryApi, `GET /api/v1/departments` (every 60 s)
- acc → pos, hr, scm, crm: IErpSummary, `GET /erp/summary`
- each module → db (its own database only)
- launcher → each module «spawns»

**Constraint:** `{each module writes only its own database; no foreign key between databases}`

---

### Figure 8: Profile Diagram

**`«profile» DJsERPProfile`**, with the metaclasses Component, Class, Actor and Dependency.

| Stereotype | Extends | Tagged values |
|---|---|---|
| «ErpModule» | Component | port, database, owner |
| «ApiEndpoint» | Class | method, path, auth : {Session, XErpKey, BearerXfk}, scope |
| «OwnedTable» | Class | tableName, database, prefix : {none, pos_, hr_, scm_, crm_} |
| «SyncRecord» | Class | syncStatus : {Pending, Synced, Failed}, externalId, retryEvery = 60 s |
| «IntegrationMessage» | Dependency | externalId, fromModule, toModule |
| «ModuleRole» | Actor | module, roleName |

**Applied model (3 rows):**
1. **Cashier** «ModuleRole» {POS, cashier}:
   - Starts at `POST /pos/checkout/:orderId/pay` «ApiEndpoint» {Session}.
   - That writes `pos_integration_outbox` «SyncRecord».
   - The outbox calls `POST /api/v1/journal-entries` «ApiEndpoint» {BearerXfk, scope = journal:write}.
   - That saves `accounting_journal_entry` «OwnedTable» {xianfires_erp}.
2. **HR Staff** «ModuleRole» {HR, staff}:
   - Starts at `POST /payroll/:id/status` (Paid) «ApiEndpoint» {Session}.
   - That updates `hr_payrolls` «SyncRecord» {HR-PAY-<id>}.
   - That calls `POST /api/v1/journal-entries` {BearerXfk}.
3. **Purchasing Staff** «ModuleRole» {Procurement, staff}:
   - Starts at `POST /goods-receipts/receive`.
   - That saves `scm_goods_receipts` «SyncRecord».
   - That calls `POST /api/v1/inventory/stock-in` «ApiEndpoint» {XErpKey}.
   - That updates `pos_inventory` «OwnedTable» {djs_pos}.

---

## IV. Behavioral Diagrams (The System in Motion)

### Figure 9: Data Flow Diagram (Level 1)

**External entities:** Customer, Cashier, Inventory Staff, Customer-Service Staff, HR Staff / Employee, Purchasing Staff, Supplier (through Purchasing Staff), Accountant, Owner / Administrator.

**Processes:**
- 1.0 Take Order & Checkout (POS)
- 2.0 Manage Customers, Loyalty & Promos (Customer Logs)
- 3.0 Manage Products & Stock (POS)
- 4.0 Procure Goods (Procurement)
- 5.0 Manage Employees, DTR & Payroll (HR)
- 6.0 Post to General Ledger (Accounting `/api/v1`)
- 7.0 Pay Bills, Reconcile & Lock Periods (Accounting)
- 8.0 Reports & Enterprise Overview (Accounting)

**Data stores:**
- D1 Orders & Transactions
- D2 Products & Stock
- D3 Integration Outbox
- D4 Customers & Loyalty
- D5 Purchasing
- D6 Employees, DTR & Payroll
- D7 General Ledger
- D8 Invoices, Bills & Payments
- D9 Integration References

**Flows:**

*Sales (1.0, 2.0, 3.0):*
- Customer → 1.0: order, payment, promo code. 1.0 → Customer: receipt
- Cashier → 1.0: items, payment method
- 1.0 ↔ 2.0: customer lookup, promo quote
- 1.0 → D1: transaction. 1.0 → D2: Sales Deduction. 1.0 → D3: outbox messages
- D3 → 2.0: purchase log (+1 point), promo redeem / void
- D3 → 6.0: `POS-<txn>`; a void is a reversal
- 2.0 ↔ D4. Customer-Service Staff → 2.0: customers, promo codes
- Inventory Staff → 3.0: products, adjustments. 3.0 → Inventory Staff: low-stock alerts. 3.0 ↔ D2

*Procurement (4.0):*
- Purchasing Staff → 4.0: requests, POs, receipts, invoices, returns
- 4.0 → Supplier: purchase order. Supplier → 4.0: delivery, invoice
- 4.0 → 3.0: stock-in / stock-out. 4.0 ↔ D5
- 4.0 → 6.0: contact, bill `SINV-<no.>`, refund `SRET-<no.>`
- 7.0 → 4.0: bill payment status

*HR (5.0):*
- 5.0 → 4.0: departments
- HR Staff → 5.0: employees, DTR, leaves, payroll. Employee → 5.0: attendance
- 5.0 → Employee: payslip. 5.0 ↔ D6
- 5.0 → 6.0: `HR-PAY-<id>`

*Accounting (6.0, 7.0, 8.0):*
- 6.0 → D7, D8, D9. It checks that the period is open, and `external_id` makes sure the same entry is posted only once
- Accountant → 7.0: payments, bank statement. Administrator → 7.0: close year / lock month. 7.0 ↔ D7, D8
- 8.0 ← D7 balances. 8.0 ← 1.0 to 5.0: `/erp/summary`
- 8.0 → Accountant: reports. 8.0 → Owner: Enterprise Overview

---

### Figure 10: Use Case Diagram

**Boundary:** "DJ's ERP", with 5 sub-boundaries.

**Actors:**
- Cashier, Inventory Staff, Customer-Service Staff, HR Staff, Employee, Purchasing Staff, Viewer, Accountant, Administrator
- Generalization: Viewer ← Accountant ← Administrator
- Administrator is also the admin in every module.

**Use cases:**
- **POS:** Log In, Take Order, Checkout & Take Payment, Print Receipt, Void Transaction, Manage Products & Stock, View Low-Stock Alerts
  - Apply Promo Code «extend» Checkout
  - Select Customer «extend» Checkout
- **Customer Logs:** Manage Customers, Log Visit / Purchase, View Points & Tier, Manage Promo Codes, Void Promo Redemption
- **HR:** Manage Employees & Departments, Record Attendance (DTR), File / Approve Leave, Compute Payroll, Mark Payroll as Paid, View Payslip
- **Procurement:** Manage Suppliers, Create Purchase Request, Approve / Send PO, Receive Goods, Record Supplier Invoice (VAT-inclusive), Resolve Supplier Return
- **Accounting:** Post Journal Entry, Create Invoice / Bill, Record / Void Payment, Reconcile Bank, Generate Reports, View Payroll (read-only), Close Year / Lock Month, View Enterprise Overview, Manage Users & API Keys, View Audit Log

**Shared «include»:**
- **Post to Accounting via API** ← Checkout, Void Transaction, Mark Payroll as Paid, Record Supplier Invoice, Resolve Supplier Return (Refunded)
  - It includes Check Period Open & Post Once.
  - Retry Pending Sync (60 s) «extend»s it.
- **Update POS Stock** ← Checkout, Void, Receive Goods, Resolve Return
- **Record Customer Purchase & Points** ← Checkout (when a customer is selected)
- **Quote / Redeem Promo** ← Apply Promo Code

---

### Figure 11: Activity Diagram

**Scenario:** a sale with a promo code, from the order to the monthly lock.

**Swimlanes:** Cashier | POS | Customer Logs | Accounting | Administrator.

**Main flow:**
1. **Cashier:** start → open order (Dine-In / Take-Out) → add items
2. **Decision [customer?]:**
   - yes → POS searches Customer Logs → select customer
   - no → continue
3. **Decision [promo code?]:**
   - yes → POS asks Customer Logs for a quote.
   - Customer Logs checks: code active, dates, minimum spend, earlier purchases, points cost ≤ balance.
   - **Decision [valid?]:**
     - no → POS shows the reason and the sale continues without the promo
     - yes → discount applied
4. **Cashier:** take payment (Cash / GCash / Maya / Card)
5. **POS, in one database transaction:** save the transaction and payment, deduct stock (Sales Deduction), write 2 outbox rows (accounting:sale, customers:sale) → print receipt
6. **Fork** into two parallel paths:
   - **A. Accounting:** POS sends the journal entry `POS-<txn>`. Accounting checks the API key scope, that the period is open and the month not locked, debits = credits, and whether the `external_id` is new. It then posts the entry and saves `integration_reference` → POS marks the row Synced.
     - [offline / timeout] → stay Pending → wait 60 s → retry (loop)
     - [refused, e.g. locked month] → Failed + error → an admin fixes it and clicks Retry
   - **B. Customer Logs:** purchase log (+1 point, totalSpent), redeem promo (points cost deducted) → Synced
     - [offline] → Pending → retry loop
7. **Join** → Enterprise Overview shows the sale with 0 pending
8. **Decision [month end?]:**
   - yes → Administrator checks the Trial Balance → locks the month → end
   - no → end

**Alternative path:**
- The cashier voids the sale → POS restores stock and writes void outbox rows.
- Accounting posts a reversing entry.
- Customer Logs logs a refund (−1 point) and voids the promo redemption.

---

### Figure 12: Sequence Diagram

**Lifelines:** Cashier (actor), :POS Browser, :POS Server, :djs_pos DB, :Customer Logs API, :Accounting API, :xianfires_erp DB.

**sd 1.0 Promo quote (1–6)**
1. Cashier → Browser: enter promo code WELCOME10
2. Browser → POS Server: `POST /pos/checkout/:orderId/details`
3. POS Server → Customer Logs: `POST /api/promos/quote` {code, subtotal, customerId} (`X-ERP-Key`)
4. Customer Logs (self): check active, dates, minimum spend, points
5. Customer Logs → POS Server: {discount 100.00}
6. POS Server → Browser: total 1,008.00

**sd 2.0 Commit sale (7–14)**
7. Cashier → Browser: Cash 1,008.00
8. Browser → POS Server: `POST /pos/checkout/:orderId/pay`
9. POS Server → djs_pos: BEGIN; INSERT pos_transactions, pos_payments
10. POS Server → djs_pos: UPDATE pos_inventory; INSERT movement (Sales Deduction)
11. POS Server → djs_pos: INSERT 2 pos_integration_outbox rows (Pending)
12. POS Server → djs_pos: COMMIT
13. POS Server → Browser: receipt page
14. Browser → Cashier: print receipt

**sd 3.0 Sync to Accounting (15–22)**
15. POS Server (self): the outbox worker picks the Pending row
16. POS Server → Accounting: `POST /api/v1/journal-entries` {external_id POS-TXN-…, lines} (Bearer `xfk_`)
17. Accounting (self): check the key and the scope journal:write
18. Accounting → xianfires_erp: SELECT integration_reference (none found)
19. Accounting (self): period open? month locked?
20. Accounting → xianfires_erp: BEGIN; INSERT entry + 4 lines + integration_reference; COMMIT
21. Accounting → POS Server: 201 {entry}
22. POS Server → djs_pos: UPDATE outbox status = Synced

**sd 4.0 Sync to Customer Logs (23–28)**
23. POS Server → Customer Logs: `POST /api/customer-logs` {PURCHASE, TXN ref, amount}
24. Customer Logs (self): insert log, points +1, totalSpent
25. Customer Logs → POS Server: 200
26. POS Server → Customer Logs: `POST /api/promos/redeem` {code, TXN ref}
27. Customer Logs → POS Server: 200 {redemption}
28. POS Server → djs_pos: UPDATE outbox status = Synced

**alt fragment [Accounting offline] on message 16:**
- The request times out.
- POS updates the outbox row: attempts + 1, nextAttemptAt = now + 60 s.
- The retry sends the same `external_id`, so Accounting posts the entry only once.

---

### Figure 13: State Machine Diagram

**Lifecycle of a supplier invoice:** `SupplierInvoice.paymentStatus` plus `financialSyncStatus`.

**States:**
- Initial → **New (unsaved form)**
- save() [invalid] → New, with the error shown
- save() [valid] / compute VAT (if the "Amount includes 12% VAT" checkbox is ticked, vat = total × 12 / 112) → **Recorded**

**Recorded is a composite state with two parallel regions:**

**Region A: Accounting sync**
- Pending: the worker runs every 60 s and sends POST contact + bill `SINV-<no.>`
- [201] → Synced (financialReference = Accounting bill number)
- [offline / timeout] → stays Pending (attempts + 1)
- [refused, e.g. closed period] → Failed (error saved). Retry → Pending

**Region B: Payment status** (read from Accounting with GET `/api/v1/bills/SINV-<no.>`; only when Synced)
- Pending → [0 < amountPaid < total] → Partially Paid → [amountPaid = total] → **Paid** (final)
- Pending or Partially Paid → [due date passed] → Overdue
- → dispute() → Disputed
- [bill voided in Accounting] → **Voided** (final)

**Notes:**
- Accounting posts Dr 1200 Merchandise Inventory (net) + Dr 1400 Input VAT / Cr 2000 Accounts Payable (total).
- The payment is recorded in Accounting; Procurement only reads it.

---

### Figure 14: Communication Diagram

**Scenario:** procure-to-pay, from receiving goods to the bill being paid.

**Objects:** Purchasing Staff, :SCM Browser UI, :SCM Server, :inventoryService, :financialService, :POS Inventory API, :Accounting API, :djs_procurement, :djs_pos, :xianfires_erp.

**Numbered messages:**

*1. Receive goods*
- 1 receiveGoods(PO, items, batch, expiry): Staff → UI
- 1.1 `POST /goods-receipts/receive`: UI → Server
- 1.1.1 INSERT goods receipt + items (inventorySyncStatus = Pending): Server → djs_procurement
- 1.1.2 stockIn(receiptNumber, items): Server → inventoryService
- 1.1.2.1 `POST /api/v1/inventory/stock-in` (`X-ERP-Key`): inventoryService → POS Inventory API
- 1.1.2.1.1 UPDATE pos_inventory; INSERT movement (Stock In): POS API → djs_pos
- 1.1.3 UPDATE inventorySyncStatus = Synced: Server → djs_procurement

*2. Record the supplier invoice*
- 2 recordInvoice(number, total, vatInclusive): Staff → UI
- 2.1 `POST /supplier-invoices/add`: UI → Server
- 2.1.1 INSERT invoice (financialSyncStatus = Pending): Server → djs_procurement
- 2.1.2 dispatchPayable(): Server → financialService
- 2.1.2.1 `POST /api/v1/contacts` (external_id = supplierCode): financialService → Accounting API
- 2.1.2.2 `POST /api/v1/bills` (external_id = SINV-<no.>, vat_inclusive): financialService → Accounting API
- 2.1.2.2.1 INSERT bill + entry (Dr 1200 / Dr 1400 / Cr 2000) + integration_reference: Accounting API → xianfires_erp
- 2.1.2.3 «return» bill number → saved as financialReference

*3. Read the payment back*
- 3 openInvoice(): Staff → UI
- 3.1 refreshPayment(): Server → financialService
- 3.1.1 `GET /api/v1/bills/SINV-<no.>`: financialService → Accounting API
- 3.1.2 «return» amountPaid, status → paymentStatus = Partially Paid / Paid

---

### Figure 15: Interaction Overview Diagram

1. Initial node → **ref sd Log In** (each module, its own session)
2. Decision by role:
   - **[Cashier]** → ref sd POS Checkout with Promo → ref sd Sync Sale (Accounting + Customer Logs)
     - Decision [Synced?]:
       - no → ref sd Retry Outbox (after 60 s) → loop back
       - yes → merge
   - **[Purchasing]** → ref sd Purchase Request → PO → ref sd Receive Goods (stock-in to POS) → ref sd Supplier Invoice → Bill → merge
   - **[HR]** → ref sd Compute Payroll from DTR → ref sd Mark as Paid → Journal → merge
   - **[Accountant]** → ref sd Pay Bill → (Procurement reads Paid) → merge
3. Merge → **ref sd Enterprise Overview**
4. Decision [month end?]:
   - yes → ref sd Lock Month (Administrator), then decision [fiscal year end?]:
     - yes → ref sd Close Fiscal Year → final
     - no → final
   - no → final

---

### Figure 16: Timing Diagram

**Scenario:** a sale while Accounting is offline. The time axis is in seconds, t = 0 to 150.

**Lifelines:**
- **Cashier:** Idle → Checking out (t 0–20) → Idle
- **POS Server:** Idle → Committing sale (t 18–20) → Sending outbox (t 20, 80, 140) → Idle
- **Accounting module:** Offline (t 0–100) → Online
- **Outbox row (accounting):**
  - none → Pending at t = 20 (attempt 1 fails)
  - t = 80, attempt 2 fails
  - t = 140, attempt 3 succeeds → Synced at t = 141
- **Outbox row (customers):** none → Pending at t = 20 → Synced at t = 21
- **Ledger (xianfires_erp):** no entry → `POS-TXN-…` posted at t = 140 (posted only once)
- **Loyalty points (Ana):** 4 → 5 at t = 21; tier none → Silver
- **POS stock (Chicken Silog):** 40 → 36 at t = 20

**Constraints:**
- {receipt printed at t = 20 without waiting for Accounting}
- {retry interval = 60 s}
- {3 attempts, 1 entry}

---

### Figure 17: Requirement Diagram (SysML)

**REQ-0 DJ's ERP:** "The system shall run DJ's FoodHub's sales, inventory, purchasing, people and books as one system of five modules that each keep their own database and share data only through APIs."

**«deriveReqt»** into the requirements below:

| Requirement | Text | «satisfy» block | «verify» test case |
|---|---|---|---|
| REQ-1 Separate databases | Each module shall keep its own database; no foreign key between databases | split-databases.js + per-module models | TC-01: information_schema shows no cross-database FK |
| REQ-2 Secure access | Each module shall have its own login and roles; module APIs shall need `X-ERP-Key` or a Bearer `xfk_` key with scopes | auth middleware, erpKey, apiKey | TC-02: a wrong key gets 401, a missing scope gets 403 |
| REQ-3 Sales to the ledger | Every POS sale and void shall post a balanced journal entry | POS erpSync + Accounting apiV1 | Sequence steps 15–22; Trial Balance balanced after a sale and a void |
| REQ-4 Loyalty & promos | Purchases shall add points; promo codes shall be quoted, redeemed and voided | Customer Logs PromoService + POS crm.js | Sequence steps 1–6 and 23–28 |
| REQ-5 Procure-to-pay | Received goods shall add POS stock; supplier invoices shall become bills; payment status shall be read back | Procurement inventoryService + financialService | Communication messages 1–3; receive 10 → stock +10 |
| REQ-6 Payroll | Payroll shall be computed from DTR with SSS, PhilHealth, Pag-IBIG; Mark as Paid shall post Dr 6000 / Cr 2400 / Cr 1110 / Cr 1010 | HR payrollCalc + accountingSync | TC-06: payslip figures and the HR-PAY journal |
| REQ-7 Reliable sync | No message shall be lost or posted twice when a module is offline | POS outbox, sync status, integration_reference | Timing diagram: stop Accounting, sell, restart → posted once |
| REQ-8 Oversight & control | The owner shall see all modules in one page; locked months and closed years shall refuse posts; every change shall be audited | Enterprise Overview, periodService, auditService | TC-08: lock a month → posting refused |

**Legend:**
- Requirement: purple
- Block: green
- Test case: orange
- Dashed arrows: deriveReqt, satisfy, verify
