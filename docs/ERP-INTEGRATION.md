# DJ's ERP — how the 5 modules work as one system

DJ's ERP joins five separately built XianFire apps into one ERP for the restaurant:

| Module | Folder | Port | Tables |
|---|---|---|---|
| Accounting | `xianfires erp project/` | 3000 | `accounting_*`, `contact`, `invoice`, `payment`, … (unchanged) |
| POS & Inventory | `PointOfSales-main/PointOfSales-main/` | 3001 | `pos_*` |
| Human Resources | `DJs-Human-Resource-Management-main/` | 3002 | `hr_*` |
| Procurement (suppliers) | `eventdriven_selda-main/eventdriven_selda-main/` | 3003 | `scm_*` |
| Customer Logs (loyalty) | `Dj-s-Customer-Logs-main/Dj-s-Customer-Logs-main/` | 3004 | `crm_*` |

All five use **one central MySQL database** (`xianfires_erp`). Each module keeps its own login and
its own screens; a "DJ's ERP modules" section in every sidebar links them together, and
Accounting's **Enterprise Overview** (`/admin/enterprise`) shows live figures from all five.

## Running it

From the workspace root (Node 20.12 or newer, MySQL running in Laragon):

```bash
npm run setup     # npm install in every module that needs it
npm run migrate   # creates/updates the central database, issues the API keys (safe to re-run)
npm run dev       # starts all 5 modules; Ctrl+C stops them
npm run check     # syntax check of every module
```

- `npm run migrate` copies `.env.example` to `.env` on the first run and fills in the generated
  secrets (`ERP_INTERNAL_KEY`, `SESSION_SECRET`, `ERP_API_KEY_POS/HR/SCM`). HR asks for its first
  admin account unless `ADMIN_EMAIL` / `ADMIN_PASSWORD` are set in `.env`.
- Every step only creates what is missing; no table is dropped or emptied. Running it again keeps
  the API keys that still work.
- `npm run dev -- --only=pos,erp` starts only some modules.
- Ports and URLs can be changed in `.env` (`PORT_*`, `ERP_URL_*`).
- To try things without touching real data: `DB_NAME=xianfires_erp_qa npm run migrate`, then
  `DB_NAME=xianfires_erp_qa npm run dev`.

First logins: Accounting uses its existing users (`npm run user:create` in its folder makes one);
the first account registered in POS becomes its admin; Procurement seeds `admin@gmail.com` /
`admin123` (change it); Customer Logs accounts are registered at `/register`.

## Who owns what

One rule keeps the shared database consistent: **a module writes only its own tables**.

| Data | Owner | Used by |
|---|---|---|
| Employees, departments | HR | Procurement (department list), Enterprise Overview |
| Products, stock | POS & Inventory | Procurement (catalog, deliveries, returns) |
| Customers, loyalty | Customer Logs | POS checkout |
| Suppliers | Procurement | Accounting (as supplier contacts) |
| Ledger, payables, payments, VAT | Accounting | everyone posts through its API |

- **Reading** another module's data: a plain `SELECT` on its tables (never a Sequelize model, so a
  `sync()` in one module can never change another module's tables).
- **Changing** another module's data: call that module's API.
  - Accounting: `/api/v1` with the module's own key (`Authorization: Bearer xfk_…`). See
    `xianfires erp project/docs/ERP-API.md`. Ledger rules (balanced entries, closed periods) apply.
  - POS inventory (`/api/v1/inventory/*`) and Customer Logs (`/api/customers`, `/api/customer-logs`):
    header `X-ERP-Key: <ERP_INTERNAL_KEY>`.

## What flows between the modules

| When | From → To | What happens | In Accounting |
|---|---|---|---|
| A sale is paid | POS → Accounting | journal entry `POS-<transaction no.>` | Dr 1000 Cash on Hand (cash) or 1010 Cash in Bank (GCash, Maya, card); Dr 4200 Sales Discounts; Cr 4000 Sales; Cr 4500 Other Income (service charge); Cr 2200 Output VAT |
| A sale is voided | POS → Accounting | reversing entry | the sale's entry reversed |
| A sale has a customer | POS → Customer Logs | purchase log (+1 loyalty point, total spent) | — |
| That sale is voided | POS → Customer Logs | refund log (−1 point) | — |
| Payroll is marked Paid | HR → Accounting | journal entry `HR-PAY-<id>`; Paid then becomes final in HR | Dr 6000 Salaries; Cr 2400 SSS/PhilHealth/Pag-IBIG (deductions); Cr 1010 Cash in Bank (net pay) |
| Departments change in HR | HR → Procurement | Procurement's department list is refreshed (same ids) | — |
| A supplier product or PO line is saved | Procurement → POS | linked to the POS item with that name, or a new stock-only **Supply** item is created | — |
| Goods are received | Procurement → POS | accepted quantity added to stock (`Stock In` movement) | — |
| Goods are returned | Procurement → POS | returned quantity removed from stock (`Stock Out`) | — |
| A supplier invoice is recorded | Procurement → Accounting | supplier contact + bill `SINV-<invoice no.>` | Dr 1200 Merchandise Inventory; Cr 2000 Accounts Payable |
| The bill is paid in Accounting | Accounting → Procurement | Procurement reads the status: Partially Paid / Paid / Voided | the payment entry |
| A return is resolved as Refunded | Procurement → Accounting | journal entry `SRET-<return no.>` | Dr 1010 Cash in Bank; Cr 1200 Merchandise Inventory |

Account codes are the Accounting module's default chart. If yours differ, set the `ERP_ACCOUNT_*`
variables in `.env` (see `utils/erpSync.js` in POS, `services/accountingSync.js` in HR and
`services/financialService.js` in Procurement).

## Why nothing is lost or posted twice

- Every message carries the sender's own id (`external_id` such as `POS-TXN-…`). Accounting and
  Customer Logs apply each id once, so a retry after a timeout never books a sale twice.
- The POS writes each message to `pos_integration_outbox` **in the same database transaction as the
  sale or void**, then sends it. If Accounting or Customer Logs is offline the sale still completes;
  the message waits and is retried every minute.
- HR and Procurement keep a sync status on the record itself (Pending / Synced / Failed, plus the
  error). Pending is retried every minute; Failed means the other module refused it (for example a
  closed accounting period or a fractional stock quantity) and needs a person to fix the cause.
- Each record page shows its status, and has a retry button for admins (POS transaction, HR payslip).
  Enterprise Overview lists everything waiting or failed.

## Rules for changing the code

- Keep new tables in your module's prefix (`hr_`, `pos_`, `scm_`, `crm_`) and set `tableName`
  explicitly in the model.
- New columns: add them to the model; each module's migrate/start-up adds missing columns
  (and missing ENUM values) without touching data. Accounting has its own migration steps (see its
  `CLAUDE.md`).
- Never use `sync({ force: true })`, `TRUNCATE` or `DROP` on the shared database.
  Procurement's `reset-db.js` / `seed-user-data.js` only touch `scm_*` tables and
  `test-all-flows.js` needs `--write-test-data`.
- Do not write into another module's tables; add or call an API instead.
- Session cookies have different names per module (`xf_erp.sid`, `xf_pos.sid`, …) because the
  modules share `localhost`; keep them distinct.

## Known limits

- POS stock is counted in whole units, so a delivery of 2.5 kg is refused until it is recorded as a
  whole quantity.
- POS sales do not post cost of goods sold; post a periodic stock count adjustment
  (Dr 5000 / Cr 1200) in Accounting.
- The VAT report's VAT amounts include POS sales, but its "vatable sales" base lists only invoices.
- A supplier refund is booked as cash received; a credit against an unpaid bill is handled in
  Accounting by voiding and re-issuing the bill.
- One shared `X-ERP-Key` is used between modules (Accounting has a separate key per module).
- Procurement's own pages still have no login check (as before the integration).
