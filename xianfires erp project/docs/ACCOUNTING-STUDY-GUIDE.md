# Accounting Module (XianFires ERP) — Study Guide

Para sa: CJ Mendoza, may-ari ng Accounting module ng DJ's ERP.
Gamitin ito sa pag-review bago ang defense o kapag tinanong ka tungkol sa code o sa kakayahan ng system.
Lahat ng nakasulat dito ay galing mismo sa code ng `xianfires erp project/` at sa totoong data ng system.

Paano basahin:
1. Sections 1–3: ang "big picture". Ito ang sasabihin mo sa unang tanong na "ano ang system mo?"
2. Sections 4–8: paano ito gumagana sa loob (database, rules, features, security).
3. Section 9: paano ito kumokonekta sa ibang 4 modules.
4. Section 10: mga totoong halimbawa na may numbers (galing sa data ng system).
5. Section 12: mga posibleng tanong at sagot. I-practice mo itong sagutin nang hindi tumitingin.

---

## 1. Ano ang Accounting module?

Ang Accounting module ang **general ledger** ng DJ's ERP: dito napupunta ang lahat ng pera ng
DJ's FoodHub. Ito ay isang **double-entry accounting system**: bawat transaksyon ay may debit at credit
na laging magkapantay.

Ginagawa nito:
- Chart of accounts (listahan ng accounts: Cash, Sales, Salaries, atbp.)
- Journal entries (manual at automatic)
- Sales invoices (sa customers) at bills (galing sa suppliers), may 12% VAT
- Payments (bayad na natanggap at bayad na ibinigay), pati partial payment
- Bank reconciliation (pagtutugma ng libro at bank statement)
- 10 reports: General Ledger, Trial Balance, Income Statement, Balance Sheet, Cash Flow,
  AR Aging, AP Aging, VAT Summary, Sales Book, Purchase Book
- Period closing: pagsara ng fiscal year at pag-lock ng buwan
- Audit log ng bawat galaw, users na may 3 roles
- **Integration hub**: ang `/api/v1` kung saan nagpo-post ang POS, HR at Procurement,
  at ang **Enterprise Overview** na nagpapakita ng live na data ng lahat ng 5 modules

Sa DJ's ERP, ang Accounting ang **sentro**: lahat ng may epekto sa pera (benta, sweldo, bayad sa
supplier) ay dito naitatala bilang journal entry.

---

## 2. Tech stack (at bakit)

| Bahagi | Ginamit | Bakit |
|---|---|---|
| Runtime | Node.js (ESM, `"type": "module"`) | JavaScript sa server, mabilis, iisang language sa front at back |
| Web framework | Express 4 + XianFire framework | Routing, middleware; XianFire ang framework ng klase |
| Views | `.xian` files (Handlebars / `hbs`) | Server-side rendering; may auto-escaping kontra XSS |
| ORM | Sequelize 6 + `mysql2` driver | Models sa JavaScript, transactions, row locks |
| Database | MySQL 8 (Laragon), database `xianfires_erp` | Relational: may foreign keys, CHECK constraints, transactions |
| Login | `express-session` + `bcryptjs` | Session cookie; password naka-hash (hindi plain text) |
| Config | `dotenv` (`.env`) | Port, DB settings, session secret, API keys |
| Dev | `nodemon` | Auto-restart habang nagko-code |

Walang frontend framework (walang React/Vue). Ang mga page ay HTML galing server, at may maliliit na
JavaScript files sa `public/js/` para sa forms (hal. pag-add ng journal lines, pag-compute ng totals).

---

## 3. Structure ng code at daloy ng request

```
xianfires erp project/
├── index.js            ← simula ng app: Express, session, view engine, routes
├── migrate.js          ← gumagawa ng tables, CHECK constraints, default chart of accounts
├── user.js             ← CLI: gumawa ng user / magpalit ng password
├── integration-keys.js ← CLI: gumagawa ng API keys para sa POS, HR, Procurement
├── routes/
│   ├── urls.js         ← LAHAT ng URL nasa isang lugar
│   ├── index.js        ← lahat ng routes ng pages at JSON API + kung anong role ang pwede
│   └── apiV1.js        ← /api/v1 para sa ibang modules (API key)
├── middleware/
│   ├── auth.js         ← login check, roles, requireJson
│   ├── apiKey.js       ← API key check + scopes para sa /api/v1
│   └── erpModules.js   ← links papunta sa ibang 4 modules
├── controllers/ (17)   ← tumatanggap ng request, tumatawag ng service, nagre-render ng page
├── services/ (19)      ← LAHAT ng accounting rules (posting, VAT, reports, periods…)
├── models/ (15 + index)← Sequelize models = tables
├── views/              ← .xian pages + partials (header, sidebar)
└── public/             ← CSS (admin.css) at page scripts (public/js)
```

**Daloy ng isang request** (hal. pag-save ng sales invoice):

```
Browser (public/js/document-form.js)
   │  POST /api/sales/invoices  (JSON)
   ▼
routes/index.js ── middleware: naka-login? role = admin o accountant? JSON ba ang body?
   ▼
controllers/documentController.js ── kinukuha ang body, tinatawag ang service
   ▼
services/invoiceService.js (createDocument) ── validation, VAT, gumagawa ng journal entry
   ▼
models (Sequelize) ── INSERT sa invoice, invoice_line, accounting_journal_entry, accounting_journal_line
   ▼
controller ── logAudit(...) → nagsusulat sa audit_log, sumasagot ng { data: ... }
```

Bakit may **services layer**? Para iisang lugar lang ang accounting rules. Ang page ng admin at ang
`/api/v1` ng ibang modules ay iisang service function ang tinatawag, kaya pareho ang rules kahit
saan manggaling ang request.

---

## 4. Database (`xianfires_erp`)

15 tables:

| Table | Laman |
|---|---|
| `admin_user` | Users: email, bcrypt password, full_name, role (admin/accountant/viewer), status |
| `accounting_account` | Chart of accounts: code, name, type, normal_balance, is_cash, cash_flow_category, status |
| `accounting_journal_entry` | Header ng entry: date, reference, description, entry_type, reversal_of_id, created_by |
| `accounting_journal_line` | Lines ng entry: account_id, debit, credit, cleared_reconciliation_id |
| `contact` | Customers at suppliers: type, name, email, phone, address, TIN |
| `invoice` | Sales invoices AT bills (`kind` = invoice o bill): dates, VAT, subtotal, total, amount_paid, status |
| `invoice_line` | Lines ng invoice/bill: account, description, quantity, unit_price, amount |
| `payment` | Bayad sa invoice/bill: date, amount, cash account, journal entry, status (posted/void) |
| `bank_reconciliation` | Reconciliation ng bank account: statement date, statement balance, status |
| `accounting_period_close` | Mga fiscal year na naisara na at ang closing entry nila |
| `setting` | Settings (company, VAT rate, prefixes, control accounts, monthly lock) |
| `audit_log` | Sino, ano, kailan, mula saang IP |
| `api_client` | Mga module na may API key (POS, HR, Procurement): key_prefix, key_hash, scopes |
| `integration_reference` | external_id ng ibang module ↔ record sa Accounting (para hindi madoble) |
| `migration` | Listahan ng migration steps na tapos na |

**Relationships** (foreign keys):
- `accounting_journal_line.journal_entry_id` → `accounting_journal_entry`; `account_id` → `accounting_account`
- `invoice.contact_id` → `contact`; `invoice.journal_entry_id` → ang entry na ginawa nito
- `invoice_line.invoice_id` → `invoice`; `payment.invoice_id` → `invoice`
- `integration_reference.api_client_id` → `api_client`

**CHECK constraints** (database mismo ang tumatanggi sa maling data, hindi lang ang code):
- Isang journal line ay debit LANG o credit LANG: `(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)`
- `type` ng account ay asset / liability / equity / revenue / expense lang
- `role` ng user ay admin / accountant / viewer lang
- Invoice: `total > 0` at `0 <= amount_paid <= total`
- Payment: `amount > 0`

**Migrations** (`migrate.js`): `sequelize.sync()` gumagawa ng missing tables. Ang pagbabago sa existing
table ay ginagawa ng numbered steps (`accounting-1.0.0-default-chart-of-accounts` hanggang
`accounting-1.4.0-employee-advances-account`). Bawat step ay tumatakbo **isang beses lang**
(naka-record sa table na `migration`), kaya ligtas i-run ulit ang `npm run migrate`.

---

## 5. Double-entry: paano ito ginawa sa system

**Account types at normal balance:**

| Type | Normal balance | Halimbawa |
|---|---|---|
| Asset | Debit | 1000 Cash on Hand, 1010 Cash in Bank, 1100 Accounts Receivable, 1200 Merchandise Inventory, 1400 Input VAT |
| Liability | Credit | 2000 Accounts Payable, 2200 Output VAT Payable, 2400 SSS/PhilHealth/Pag-IBIG Payable |
| Equity | Credit | 3000 Owner's Capital, 3100 Owner's Drawings, 3200 Retained Earnings |
| Revenue | Credit | 4000 Sales Revenue, 4200 Sales Discounts, 4500 Other Income |
| Expense | Debit | 5000 COGS, 6000 Salaries, 6100 Rent, 6200 Utilities, 6400 Marketing, 6700 Bank Charges |

Ang default chart ay may **31 accounts** na ginagawa ng `migrate.js`.

**Ang batas ng system:** Assets = Liabilities + Equity. Kaya:
- Bawat entry: **total debit = total credit**, at may **2 o higit pang lines**.
- Ang Trial Balance ay laging balanced. Ang Balance Sheet ay may "balanced" check.

**Bakit integer cents?** Ang `0.1 + 0.2` sa JavaScript ay `0.30000000000000004`. Para walang ganitong
error, lahat ng pera ay kino-convert sa **centavos (integer)** bago i-compare o i-add
(`toCents` sa `services/accountTypes.js`, `cents()` sa reports), at ibinabalik sa pesos sa dulo
gamit ang `.toFixed(2)`.

---

## 6. Ang 10 rules na laging totoo (ledger invariants)

Ito ang pinakamahalagang bahagi sa technical defense. Bawat isa ay may lugar sa code:

| # | Rule | Saan ipinapatupad |
|---|---|---|
| 1 | Pera ay kinukumpara sa integer cents | `toCents()` / `cents()` sa services |
| 2 | Entry ay may ≥ 2 lines, bawat line debit O credit, at balanced | `prepareLines()` sa `journalService.js` + CHECK constraint |
| 3 | Lahat ng automatic posting ay dumadaan sa `postEntry()`; ang reversal sa `postReversal()` | `journalService.js` |
| 4 | Ang posted entry ay **hindi na binabago**. Ang mali ay itinatama sa **reversal** (kabaligtarang entry). Ang entry ng invoice/bill/payment ay nababago lang sa pag-**void** ng document | `reverseBlocker()` / `deleteBlocker()` |
| 5 | Hindi pwedeng mag-post sa saradong period | `assertPeriodOpen()` sa `periodService.js` |
| 6 | Header, lines at document ay sabay na nase-save sa **iisang database transaction** | `sequelize.transaction(...)` |
| 7 | Kapag binabasa tapos binabago ang balance ng document, **naka-lock ang row** | `Transaction.LOCK.UPDATE` sa `invoiceService.js` |
| 8 | Ang routes ang nagpapatupad ng roles (hindi lang tinatago ang button) | `requireRole` / `requireRoleApi` sa `routes/index.js` |
| 9 | Ang mga write ng session user ay JSON lang (`requireJson`), proteksyon kontra CSRF | `middleware/auth.js` |
| 10 | Bawat pagbabago ay nire-record sa audit log pagkatapos magtagumpay | `logAudit()` sa controllers |

**Bakit transaction?** Kung mag-crash ang server sa gitna ng pag-save (hal. na-save ang header pero
hindi ang lines), magiging unbalanced ang libro. Sa transaction, **lahat o wala**: kapag may error,
nire-rollback ang lahat.

**Bakit row lock?** Kung dalawang tao ang sabay na magbayad ng parehong invoice na ₱1,000 ang balance,
pareho silang makakakita ng ₱1,000 at pareho silang papasa sa check. Sa `LOCK.UPDATE`, maghihintay
ang pangalawa hanggang matapos ang una, kaya makikita niya ang bagong balance.

---

## 7. Features, isa-isa (ayon sa menu)

### Roles

| Role | Kaya |
|---|---|
| **Administrator** | Lahat, kasama ang users, settings, period closing, audit log, ERP integrations |
| **Accountant** | Lahat ng bookkeeping (accounts, journal, invoices, bills, payments, bank rec); walang users/settings/closing |
| **Viewer** | Read-only: tingin lang sa records at reports |

Sa routes: `read` = kahit sinong naka-login, `write` = admin o accountant, `admin` = admin lang.

### Dashboard (`/admin`)
Cash at bank balances, kita at gastos bawat buwan, receivables at payables na bukas,
overdue documents, pinakabagong entries.

### Enterprise Overview (`/admin/enterprise`)
Live na numero ng **lahat ng 5 modules** sa isang page: POS sales ngayon, low stock, open POs,
unpaid supplier invoices, active employees, payroll, customers, at ang sync status
(Pending/Synced/Failed) ng bawat koneksyon. Tinatanong ng `enterpriseService.js` ang
`/erp/summary` ng bawat module gamit ang `X-ERP-Key`, na may **4 seconds timeout**. Kapag patay ang
isang module, sinasabi lang na "not reachable" at hindi bumabagsak ang page.

### Chart of Accounts
- Gumawa, mag-edit, mag-deactivate ng account.
- **Hindi ma-delete** ang account na may journal lines na ("Set it to inactive instead"), para hindi
  masira ang history.
- May `is_cash` flag (para sa payments, bank rec at cash flow) at `cash_flow_category`
  (operating / investing / financing).

### Journal Entries
- **Manual entry**: date, reference, description, ≥ 2 lines. Hindi masi-save kung hindi balanced.
  Ang error ay "Entry is not balanced: total debit X vs total credit Y".
- **Entry types**: manual, reversal, closing, invoice, bill, receipt, disbursement.
- **Reverse**: gumagawa ng kabaligtarang entry (ang debit ay nagiging credit). Hindi pwedeng i-reverse ang:
  closing entry, entry ng document (i-void ang document), reversal mismo, o na-reverse na.
- **Delete**: manual entry lang, at kung wala sa saradong period, hindi pa na-reconcile, at hindi pa na-reverse.
- Numbering: `JE-000001` (nababago ang prefix sa Settings).

### Customers at Suppliers
Iisang `contact` table na may `type`. May TIN at address para sa invoices.

### Sales Invoices
- Pumili ng customer, petsa, due date (default: + payment terms days, 30 kung walang setting), lines
  (revenue account, qty, unit price), at kung may VAT.
- **Entry kapag na-save** (`createDocument`):
  `Dr 1100 Accounts Receivable (total) / Cr 4000 Sales (bawat line) / Cr 2200 Output VAT`
- Status: Open → Paid (kapag bayad na lahat) o Void. Lumalabas na "Overdue" kapag lampas na sa due date.
- Number: `INV-000001`.

### Bills (galing supplier)
- Lines ay expense o non-cash asset account (hal. 1200 Inventory).
- **Entry**: `Dr expense/asset lines + Dr 1400 Input VAT / Cr 2000 Accounts Payable (total)`
- Number: `BILL-000001`.

### VAT: dalawang paraan
1. **VAT exclusive** (default): idinadagdag ang VAT sa ibabaw.
   `vat = subtotal × 12%`, `total = subtotal + vat`.
2. **VAT inclusive** (`vat_inclusive`; ginagamit ng Procurement kapag naka-check ang "Amount includes 12% VAT"):
   kasama na ang VAT sa total, kaya kinukuha ito palabas:
   `vat = total × 12 / 112`, `subtotal = total − vat`.
   Ang VAT ay hinahati sa bawat line ayon sa laki nila, at ang huling line ang kumukuha ng sobrang
   centavo, kaya laging eksaktong tugma ang total sa papel.

### Payments
- Partial o full. **Hindi pwedeng lumampas sa balance.** Hindi pwedeng mas maaga sa petsa ng invoice.
  Dapat cash/bank account.
- Invoice payment: `Dr Cash/Bank / Cr 1100 AR` (entry type `receipt`)
- Bill payment: `Dr 2000 AP / Cr Cash/Bank` (entry type `disbursement`)
- **Void payment**: reversal entry, ibinabawas sa `amount_paid`, bumabalik sa Open ang document.
- **Void document**: pwede lang kung naka-void na ang lahat ng payments nito ("Void its payments first").

### Payroll (read-only)
Ang sweldo ay kinokompute at binabayaran sa **HR** ("Mark as Paid"). Ang page na ito ay kumukuha ng
Processed at Paid na payslips sa HR API (`GET /api/v1/payrolls`) at ipinapakita kung aling journal
entry (`HR-PAY-<id>`) ang naka-post. Bakit read-only? Para iisa lang ang "source of truth" ng
sweldo (HR), at walang dobleng bayad.

### Bank Reconciliation
1. Pumili ng bank account, statement date at statement ending balance.
2. I-tick ang mga transaksyong lumabas sa bank statement ("cleared").
3. Kinukuwenta ng system ang cleared balance at ang **difference**.
4. Makukumpleto lang kapag **difference = 0**.

Ang pinakabagong completed reconciliation lang ang pwedeng i-undo. Ang entry na may cleared lines ay
hindi na pwedeng i-delete (reversal ang gamitin).

### Reports (10)

| Report | Paano kinukuwenta |
|---|---|
| General Ledger | Lahat ng galaw ng isang account na may running balance |
| Trial Balance | Net (debit − credit) ng bawat account hanggang sa petsa; may "Balanced" check |
| Income Statement | Revenue − Expense sa period (hindi kasama ang closing entries) |
| Balance Sheet | Assets = Liabilities + Equity; idinadagdag sa equity ang kita ng nakaraang taon at ng taong ito |
| Cash Flow | Galaw ng cash, hinati sa operating / investing / financing; opening + net change = closing |
| AR Aging / AP Aging | Utang na hindi pa bayad: Current, 1–30, 31–60, 61–90, Over 90 days |
| VAT Summary | Output VAT − Input VAT = VAT payable (o excess input VAT) |
| Sales Book / Purchase Book | Listahan ng invoices / bills na may vatable at non-VAT amounts |

Lahat ng reports ay **binubuo mula sa ledger** (journal lines), kaya laging tugma sa isa't isa. May
print view ang bawat isa (Print / Save as PDF sa browser).

### Period Closing
- **Monthly lock**: ila-lock ang mga natapos nang buwan, para walang makapag-post o makapag-delete sa
  petsang iyon. Naka-save bilang listahan sa setting na `books_locked_through`; ang **Unlock** ay
  nagtatanggal lang ng pinakahuling na-lock na buwan. Hindi pwedeng i-lock ang kasalukuyang buwan.
- **Close fiscal year**: gumagawa ng **closing entry**. Zinizero nito ang bawat revenue at expense
  account, at ang net income (o loss) ay napupunta sa **Retained Earnings**. Pagkatapos, naka-lock
  na ang taon. Kailangang isara muna ang mga naunang taon. Ang **Reopen** ay ang pinakahuling sarado
  lang, at binubura nito ang closing entry.
- Ang lock date = ang mas huli sa (sarado na fiscal year, naka-lock na buwan).

### Audit Log (admin)
Bawat login, pagbabago sa accounts, journal, contacts, documents, payments, bank rec, periods,
settings, users at integrations: sino, ano, kailan, at IP. May filters ayon sa category.

### Users (admin)
Gumawa ng user, magpalit ng role, mag-deactivate. Password ay **minimum 8 characters** at naka-bcrypt.
Ang sign-up page ay **naka-off** maliban kung `ALLOW_SIGNUP=true` sa `.env`.

### ERP Integrations (admin)
Listahan ng API clients (POS, HR, Procurement). Bawat isa ay may sariling key at scopes. Pwedeng
i-**rotate** ang key (bagong key, patay ang luma) o i-deactivate.

### Settings (admin)
Pangalan, TIN at address ng kumpanya, currency, fiscal year start month, entry/invoice/bill prefixes,
VAT rate (default 12), payment terms days (default 30), at **control accounts** (aling account ang
AR, AP, Output VAT, Input VAT).

---

## 8. Security (madalas itanong)

| Banta | Proteksyon sa system |
|---|---|
| Nakaw na password sa database | `bcryptjs` hash; hindi naka-save ang tunay na password |
| Pagpasok nang walang login | `requireAdmin` / `requireRole` sa bawat route; redirect sa login o `401` sa API |
| User na lumalampas sa role | Role check sa **server** (route), hindi lang tinatago ang button |
| CSRF (pekeng form galing ibang site) | Ang writes ay `application/json` lang (`requireJson`, `415` kapag hindi). Hindi makakapagpadala ng JSON ang ordinaryong HTML form; may `sameSite: lax` din ang cookie |
| Ninakaw na cookie gamit ang JavaScript | `httpOnly` cookie; sariling pangalan na `xf_erp.sid` para hindi mag-agawan ng session ang 5 modules sa iisang localhost |
| SQL injection | Sequelize queries at raw SQL na may `replacements` (parameters), hindi string concatenation |
| XSS | Handlebars auto-escape; ang data para sa scripts ay dumadaan sa `json` helper na nag-e-escape ng `<` |
| Pekeng API call | `/api/v1` ay nangangailangan ng API key. Naka-hash (SHA-256) ang key sa DB, at ikinukumpara gamit ang `timingSafeEqual` kontra timing attack. May **scopes** (`journal:write`, `purchases:write`…) |
| Dobleng posting kapag nag-retry | `external_id` + `integration_reference` (`createOnce`) |
| Pagbabago sa nakaraang libro | Period lock, walang edit sa posted entries, reversal lang |
| Hindi alam kung sino ang gumawa | Audit log |

---

## 9. Ang Accounting bilang integration hub ng DJ's ERP

**Isang database bawat module.** Hindi binabasa ng ibang module ang tables ng Accounting (at hindi
rin ito nagbabasa ng sa kanila). **API lang** ang koneksyon.

### `/api/v1` (para sa POS, HR, Procurement)

- **Auth**: `Authorization: Bearer xfk_…` (o `X-API-Key`). Hindi gumagana dito ang session cookie.
- **Key format**: `xfk_<12 hex prefix>_<random>`. Ang prefix ay pang-hanap; ang buong key ay naka-SHA-256.
- **Scopes**:

| Scope | Para saan |
|---|---|
| `read` | Accounts, contacts, entries, documents, reports, change feed |
| `contacts:write` | Customers at suppliers |
| `journal:write` | Journal entries at reversal |
| `sales:write` | Sales invoices at customer payments |
| `purchases:write` | Bills at supplier payments |

- Kung sino ang may anong scope: POS at HR ay `journal:write`; ang Procurement ay
  `contacts:write`, `purchases:write` at `journal:write`.
- **Mahahalagang endpoints**: `GET /health`, `GET /accounts`, `GET/POST /contacts`,
  `GET/POST /journal-entries`, `POST /journal-entries/:id/reverse`, `GET/POST /invoices` at `/bills`,
  `POST /bills/:id/payments`, `GET /reports/trial-balance`, `/income-statement`, `/balance-sheet`,
  `/ar-aging`, `/ap-aging`, `GET /changes` (change feed).
- **Errors**: `{ "error": { "status", "message" } }`. 400 = mali ang data o sarado ang period, 401 =
  walang/maling key, 403 = kulang ang scope, 409 = parehong `external_id` na pinoproseso pa.
  Successes: `{ "data": … }`.

### Idempotency: `external_id` at `createOnce()`

Bawat padala ng ibang module ay may sarili nitong id, hal. `POS-TXN-20261112-F23E74`, `HR-PAY-1`,
`SINV-FHF-INV-20451`, `SRET-RET-202611-0001`.

Ang `createOnce()`:
1. Una, **nirereserba** ang `(client, entity type, external_id)` sa `integration_reference`. May unique
   index ito, kaya isa lang ang mananalo kahit sabay ang dalawang request.
2. Saka pa lang ginagawa ang posting.
3. Kapag dumating ulit ang parehong `external_id` (hal. nag-retry dahil nag-timeout), ibinabalik lang
   ang **dating record**. Walang bagong posting.
4. Kapag nag-error ang posting, pinapakawalan ang reservation para pwedeng mag-retry.

Ito ang dahilan kung bakit **hindi nadodoble ang benta o sweldo** kahit offline ang Accounting at
paulit-ulit na nagre-retry ang ibang module (bawat 60 seconds).

### Ano ang ipinapadala ng bawat module

| Galing | Ano | Entry sa Accounting |
|---|---|---|
| POS | Benta (`POS-<txn>`) | Dr 1000 Cash on Hand (cash) o 1010 Cash in Bank (GCash/Maya/card), Dr 4200 Sales Discounts / Cr 4000 Sales, Cr 4500 service charge, Cr 2200 Output VAT |
| POS | Void ng benta | Reversal ng entry ng benta |
| HR | Mark as Paid (`HR-PAY-<id>`) | Dr 6000 Salaries (gross) / Cr 2400 SSS/PhilHealth/Pag-IBIG, Cr 1110 cash advance, Cr 1010 net pay |
| Procurement | Supplier invoice (`SINV-<no.>`) | Supplier contact + bill: Dr 1200 Inventory, Dr 1400 Input VAT / Cr 2000 AP |
| Procurement | Refunded return (`SRET-<no.>`) | Dr 1010 Cash in Bank / Cr 1200 Inventory |
| Accounting → Procurement | Bayad sa bill | Binabasa ng Procurement ang status (Partially Paid / Paid) |

### Ang Accounting bilang "client" ng ibang modules
- **Enterprise Overview**: `GET /erp/summary` sa 4 modules (`X-ERP-Key`)
- **Payroll page**: `GET /api/v1/payrolls` sa HR

---

## 10. Mga totoong halimbawa (galing sa data ng system)

### A. POS sale, cash, walang discount (`POS-TXN-20261112-F23E74`)
2 Chicken Adobo (₱165) + 2 Iced Tea (₱45) = ₱420.00; VAT 12% = ₱50.40; total ₱470.40

| Account | Debit | Credit |
|---|---|---|
| 1000 Cash on Hand | 470.40 | |
| 4000 Sales Revenue | | 420.00 |
| 2200 Output VAT Payable | | 50.40 |
| **Total** | **470.40** | **470.40** |

### B. POS sale na may promo code WELCOME10 (`POS-TXN-20261112-E6D616`)
Subtotal ₱570.00; 10% promo = ₱57.00; VAT 12% sa (570 − 57 = 513) = ₱61.56; total ₱574.56

| Account | Debit | Credit |
|---|---|---|
| 1000 Cash on Hand | 574.56 | |
| 4200 Sales Discounts | 57.00 | |
| 4000 Sales Revenue | | 570.00 |
| 2200 Output VAT Payable | | 61.56 |
| **Total** | **631.56** | **631.56** |

Bakit naka-debit ang discount? Ang **Sales Discounts** ay "contra-revenue": binabawasan nito ang kita,
kaya ang Sales ay naitatala sa buong presyo (₱570) at hiwalay na makikita kung magkano ang naibigay
na discount.

### C. Payroll ni Maria Santos, Oct 16–31 (`HR-PAY-1`)
Basic ₱11,000 + allowance ₱1,000 + overtime ₱468.75 = gross ₱12,468.75; contributions ₱1,075; net ₱11,393.75

| Account | Debit | Credit |
|---|---|---|
| 6000 Salaries and Wages Expense | 12,468.75 | |
| 2400 SSS, PhilHealth and Pag-IBIG Payable | | 1,075.00 |
| 1010 Cash in Bank | | 11,393.75 |

### D. Supplier bill na VAT-inclusive (`SINV-FHF-INV-20451`, Fresh Harvest Farms)
Total sa papel ₱4,110.00 (kasama na ang VAT): VAT = 4,110 × 12 / 112 = **₱440.36**; net = **₱3,669.64**

| Account | Debit | Credit |
|---|---|---|
| 1200 Merchandise Inventory | 3,669.64 | |
| 1400 Input VAT | 440.36 | |
| 2000 Accounts Payable | | 4,110.00 |

Binayaran ito nang buo sa Accounting (`Dr 2000 / Cr 1010`), kaya naging **Paid** ang status nito sa
Procurement.

### E. Catering invoice sa Calapan City Hall (VAT exclusive)
50 packed lunch × ₱150 + 10 jugs iced tea × ₱120 = ₱8,700.00; VAT 12% = ₱1,044.00; total ₱9,744.00

- Pag-issue: `Dr 1100 AR 9,744.00 / Cr 4000 Sales 8,700.00 / Cr 2200 Output VAT 1,044.00`
- Partial payment ₱5,000: `Dr 1010 Cash in Bank 5,000 / Cr 1100 AR 5,000`. Balance ₱4,744, status Open.

### Kalagayan ng data ngayon
36 journal entries, 104 lines, 4 documents, 3 payments, 67 audit log rows. Balanced ang Trial Balance.

---

## 11. Mga command

```bash
# sa root ng DJ's ERP
npm run setup       # install ng dependencies ng 5 modules
npm run migrate     # 5 databases + API keys (ligtas ulitin)
npm run accounts    # iisang admin login sa 5 modules
npm run dev         # patakbuhin lahat (Accounting sa http://localhost:3000)

# sa loob ng "xianfires erp project"
npm run xian        # Accounting lang, may auto-restart (nodemon)
npm run migrate     # tables + default chart of accounts
npm run user:create -- --name "Pangalan" --email a@b.c --password xxxxxxxx
npm run user:changePassword
```

---

## 12. Mga posibleng tanong at sagot

**Tungkol sa system**

1. **Ano ang ginagawa ng module mo?**
   Ito ang general ledger ng DJ's ERP. Itinatala nito ang lahat ng transaksyong may pera gamit ang
   double-entry: benta, sweldo, bayad sa supplier at mga gastos. Gumagawa ito ng financial reports
   (Trial Balance, Income Statement, Balance Sheet, Cash Flow, VAT). Ito rin ang API na pinagpo-postan
   ng POS, HR at Procurement.

2. **Ano ang double-entry at paano mo ito tinitiyak?**
   Bawat transaksyon ay may debit at credit na magkapantay. Sa code, tinitingnan ito ng
   `prepareLines()` at `postEntry()` gamit ang integer cents. Kapag hindi pantay, hindi masi-save.
   May CHECK constraint din ang database na ang bawat line ay debit lang o credit lang.

3. **Paano kung nagkamali ng entry?**
   Hindi binubura o binabago ang posted entry. Gumagawa ng **reversal** (kabaligtarang entry), saka
   ilalagay ang tamang entry. Ganito ang tamang accounting practice, para may audit trail. Ang manual
   entry sa bukas na period ay pwedeng i-delete kung hindi pa na-reconcile o na-reverse.

4. **Paano ang VAT?**
   12% (nababago sa Settings). Exclusive: idinadagdag sa ibabaw. Inclusive: kinukuha palabas gamit
   ang ×12/112. Sa invoice, napupunta ito sa Output VAT (liability); sa bill, sa Input VAT (asset). Ang
   VAT Summary ay Output − Input = babayaran sa BIR.

5. **Ano ang mangyayari sa katapusan ng taon?**
   Close Fiscal Year: zinizero ng closing entry ang revenue at expense, at ang net income ay napupunta
   sa Retained Earnings. Pagkatapos, naka-lock na ang taon. Pwede rin mag-lock buwan-buwan.

6. **Paano mo masasabing tama ang reports?**
   Lahat ng reports ay binubuo mula sa iisang ledger (journal lines), kaya laging tugma. May
   built-in check ang Trial Balance (debit = credit), ang Balance Sheet (Assets = Liabilities + Equity)
   at ang Cash Flow (opening + net change = closing).

**Tungkol sa code**

7. **Bakit may services folder?**
   Para iisang lugar lang ang accounting rules. Pareho ang tinatawag ng page ng admin at ng API ng
   ibang modules, kaya pareho ang validation kahit saan manggaling.

8. **Ano ang transaction at bakit mo ginamit?**
   Grupo ng database operations na "lahat o wala". Sa pag-post, sabay na nase-save ang header, lines
   at document. Kapag may error, rollback, kaya hindi nagkakaroon ng unbalanced na libro.

9. **Paano kung sabay na magbayad ang dalawang user sa parehong invoice?**
   Naka-`LOCK.UPDATE` ang invoice row sa loob ng transaction. Maghihintay ang pangalawa, makikita
   niya ang bagong balance, at tatanggihan siya kung lalampas.

10. **Bakit cents at hindi decimal sa JavaScript?**
    Dahil sa floating-point error (0.1 + 0.2 ≠ 0.3). Integer centavos ang pagkukuwenta, at sa dulo
    lang kino-convert sa pesos. Sa database, `DECIMAL` ang columns.

11. **Paano ang login at roles?**
    Session cookie (`express-session`, `httpOnly`, `sameSite: lax`). Password naka-bcrypt. Sa bawat
    route ay may middleware: `read` (naka-login), `write` (admin/accountant), `admin`. Sa API, `401`
    kapag hindi naka-login at `403` kapag kulang ang role.

12. **Paano mo pinipigilan ang SQL injection at XSS?**
    Sequelize at parameterized raw queries (`replacements`). Ang Handlebars ay nag-e-escape ng output,
    at ang data para sa JavaScript ay dumadaan sa `json` helper na nag-e-escape ng `<`.

13. **Paano gumagawa ng table? Ano ang migration?**
    `npm run migrate`: gumagawa ng tables (`sync`), CHECK constraints, at nagpapatakbo ng numbered
    steps nang isang beses lang (naka-record sa `migration` table). Halimbawa, ang
    `accounting-1.4.0` ang nagdagdag ng account 1110 para sa cash advances.

**Tungkol sa integration**

14. **Paano nakakapag-post ang POS sa Accounting kung magkaibang database?**
    Sa HTTP API: `POST /api/v1/journal-entries` gamit ang sariling API key ng POS na may scope na
    `journal:write`. Walang module na direktang nagbabasa ng database ng iba.

15. **Paano kung patay ang Accounting habang may benta?**
    Tuloy ang benta sa POS. Naka-save ang mensahe sa outbox ng POS at nire-retry bawat 60 seconds.
    Pagbalik ng Accounting, naipo-post ito nang **isang beses lang** dahil sa `external_id`.

16. **Paano kung dalawang beses dumating ang parehong benta?**
    `createOnce()` + unique index sa `integration_reference`. Ang pangalawa ay ibinabalik lang ang
    unang record; walang dobleng entry.

17. **Paano kung may nagnakaw ng API key?**
    Pwedeng i-rotate o i-deactivate sa ERP Integrations. Limitado rin ang magagawa ng key ayon sa
    scopes nito, at naka-hash ito sa database.

18. **Bakit read-only ang Payroll page sa Accounting?**
    Ang HR ang may-ari ng payroll (DTR, deductions). Kapag "Mark as Paid" sa HR, ipinapadala nito ang
    journal entry. Ang Accounting ay nagpapakita lang, para iisa ang source of truth at walang
    dobleng bayad.

19. **Paano nalalaman ng Procurement na bayad na ang supplier?**
    Binabasa nito ang bill sa Accounting (`GET /api/v1/bills/SINV-<no.>`): `amount_paid` at status.
    Ito ay **pull**, hindi webhook, kaya walang pekeng "paid" na maipapadala ng iba.

20. **Ano ang Enterprise Overview?**
    Isang page na nagpapakita ng live na figures ng 5 modules, kasama ang mga naka-pending o failed na
    sync. May timeout, kaya hindi bumabagsak ang page kapag patay ang isang module.

---

## 13. Mga limitasyon (sagutin nang tapat kapag tinanong)

- **Sessions ay nasa memory**: kapag ni-restart ang server, kailangang mag-login ulit. Sa production,
  ilalagay ito sa database o Redis.
- **Walang automated test suite** sa loob ng project. Ang pag-test ay ginawa gamit ang end-to-end
  scripts at manual checks.
- **Iisang currency** (PHP) at iisang kumpanya.
- **Hindi nagpo-post ang POS ng Cost of Goods Sold**. Ang COGS ay inaayos sa monthly inventory count
  adjustment (`Dr 5000 / Cr 1200`).
- **Ang vatable sales base sa VAT Summary** ay galing sa invoices; ang POS sales ay journal entries.
  Tama ang VAT amounts, pero hindi kasama ang POS sa "vatable sales" na figure.
- **Isang shared `X-ERP-Key`** para sa module-to-module APIs. Ang Accounting naman ay may hiwalay na
  key bawat module.

Mga pwedeng future improvements: database-backed sessions, unit tests sa services, multi-currency,
automatic COGS mula sa POS, at e-mail ng invoices.
