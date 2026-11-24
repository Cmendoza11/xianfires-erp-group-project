# DJYum POS: implementation and acceptance guide

Base URL: `http://localhost:3001` when started through the ERP launcher.
Scope: POS module. Findings below come from code inspection; the checklist is a validation plan, not a claim that the scenarios passed.

## 1. Five core features

| Feature | Required behavior | Existing implementation |
| --- | --- | --- |
| Role-based access | Admin manages configuration; cashier sells; inventory staff manages stock; restaurant staff handles order status | `middleware/auth.js`, `utils/permissions.js`, role checks in `routes/posRoutes.js`, Settings user roles |
| Product catalog and cart | Search/filter sellable products, add quantities, reject unavailable products and insufficient stock | `controllers/posTerminalController.js`, `views/pos/terminal.xian`; server recomputes prices |
| Orders and checkout | Dine-in/take-out, optional table, customer, discounts and promo validation | `controllers/posCheckoutController.js`; only Pending orders can be paid |
| Payment and inventory | Cash/change, recorded electronic payment, one sale per order, atomic stock deduction and movement history | Payment transaction and row locks in `processPayment`; electronic payments are manually verified, not charged through a payment gateway |
| Receipts, reports and integrations | Printable receipt, transaction lookup, sales/inventory reports, admin void and ERP delivery retry | Receipt template, transaction/report controllers, integration outbox and retry routes |

These features exist in code. Actual database configuration, concurrent payment behavior, printer output and ERP connectivity still require acceptance testing.

Role identification: login uses the account's stored role, not a separate cashier login URL. The sidebar displays the role below the user's name. Cashiers now land directly on `/pos/terminal`, inventory staff on `/pos/inventory`, restaurant staff on `/pos/orders`, and administrators on `/dashboard`. The first registered user becomes admin; later registrations become cashier. Admin can change roles under Settings → Users & Roles. `npm run accounts` creates/updates administrators across the five modules; it is not a cashier creation tool.

## 2. Endpoints and examples

### Browser/session endpoints

These are existing Express web routes, mostly returning HTML or redirects with flash messages. They are not a uniform JSON REST API. Authenticate at `/login` and preserve the session cookie `xf_pos.sid`. Use valid IDs from your own database in the examples.

| Method | Path | Access / behavior |
| --- | --- | --- |
| GET | `/pos/terminal` | Admin/cashier; rendered catalog and cart |
| POST | `/pos/orders` | Admin/cashier; creates Pending order, redirects to checkout |
| GET | `/pos/checkout/:orderId` | Admin/cashier; checkout page |
| POST | `/pos/checkout/:orderId/details` | Admin/cashier; saves table, discount and customer details |
| POST | `/pos/checkout/:orderId/pay` | Admin/cashier; records payment, redirects to confirmation |
| GET | `/pos/payment/:transactionId/confirmation` | Confirmation page; cashier restricted to own transaction |
| GET | `/pos/receipts/:transactionId` | Admin/cashier; printable receipt |
| GET | `/pos/transactions` | Transaction list |
| POST | `/pos/transactions/:id/void` | Admin only |
| POST | `/pos/transactions/:id/sync` | Admin integration retry |
| GET | `/pos/customers/search?q=Ana` | Admin/cashier; Customer Logs lookup JSON |
| POST | `/pos/promos/quote` | Admin/cashier; promo quote JSON |
| GET | `/pos/inventory` | Admin/inventory staff |
| GET | `/pos/reports/sales` | Admin only |
| GET | `/pos/reports/inventory` | Admin/inventory staff |

Examples below run in the browser console while logged into the POS. They mutate records: use test data. Redirects are followed automatically; `response.url` contains the resulting page, including when validation sends the user back.

Create an order:

```js
const response = await fetch('/pos/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderType: 'Take-Out',
    items: [{ productId: 1, quantity: 2 }],
    note: 'No onions'
  })
});
window.location.assign(response.url);
```

On success: redirect to `/pos/checkout/<createdOrderId>`. Stock is checked here but deducted only on successful payment. Client-supplied prices and totals are not authoritative.

Save checkout details; replace `42` and table `3`:

```js
const response = await fetch('/pos/checkout/42/details', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderType: 'Dine-In', tableId: 3, discountId: '',
    customerId: '', promoCode: ''
  })
});
window.location.assign(response.url);
```

Pay cash, after verifying that the live order total is no more than PHP 500:

```js
const response = await fetch('/pos/checkout/42/pay', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderType: 'Take-Out', tableId: '', discountId: '',
    paymentMethod: 'Cash', amountReceived: '500',
    customerId: '', promoCode: ''
  })
});
window.location.assign(response.url);
```

Electronic payment alternative: `paymentMethod` is exactly `GCash`, `Maya`, or `Credit/Debit Card`. Send `referenceNumber` (at least four characters) and `verified: 'on'` after manually checking the provider's payment confirmation. This records a payment; it does not capture funds or independently verify a provider reference.

Promo preview, using a real customer ID and configured promo code:

```js
const response = await fetch('/pos/promos/quote', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'DJ-YUM10', customerId: 7, subtotal: 600 })
});
console.log(response.status, await response.json());
```

Success envelope: `{ "promo": ... }`. The quote contents come from Customer Logs. ERP quote errors use `{ "error": "message" }`. A preview is not the final payable total; checkout recalculates and revalidates.

### Integration JSON API

These routes require the configured `X-ERP-Key` header, not a cashier cookie. Never embed the integration key in public frontend JavaScript.

| Method | Path | Purpose / body |
| --- | --- | --- |
| GET | `/api/v1/inventory/products` | Active products with stock; `?includeInactive=1` includes inactive |
| POST | `/api/v1/inventory/products` | Find/create supply item: `{ "name": "Rice", "unit": "kg" }` |
| GET | `/api/v1/inventory/low-stock-alerts` | Products at/below minimum stock |
| POST | `/api/v1/inventory/stock-in` | `{ "receiptNumber": "TEST-GR-001", "items": [{ "productId": 1, "acceptedQuantity": 5 }] }` |
| POST | `/api/v1/inventory/stock-adjust` | `{ "returnNumber": "TEST-RT-001", "items": [{ "productId": 1, "quantityReturned": 2 }] }` |

Read-only PowerShell example, assuming an authorized key is already in `$env:ERP_API_KEY`:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3001/api/v1/inventory/products' -Headers @{ 'X-ERP-Key' = $env:ERP_API_KEY }
```

Stock-in/adjust use receipt/return numbers for idempotency. Quantities must be whole units. Wrapped inventory errors use `{ "error": { "status": 400, "message": "..." } }`; unexpected inventory errors return 500 with a generic message. Authentication errors are handled separately by the ERP key middleware.

## 3. UI mockups

Text wireframes; colors follow the current theme: background `#101010`, sidebar `#171717`, cards `#1a1a1a`, yellow accent `#f9df36`, near-white primary text. Menu links remain text-only.

### Cashier terminal

```text
┌─────────────────┬──────────────────────────────────────────┐
│ DJYum POS       │ POS Terminal                             │
│ Dashboard       ├────────────────────────┬─────────────────┤
│ POS Terminal ▪  │ Search [____________]  │ Current order   │
│ Orders          │ [All] [Meals] [Drinks] │ Burger   2  240 │
│ Tables          │                        │ Drink    1   60 │
│ Transactions    │ Burger PHP120 [Add]    │ Subtotal    300 │
│                 │ Drink   PHP60 [Add]    │ Type: Take-Out  │
│ Name / cashier  │                        │ [Checkout]      │
└─────────────────┴────────────────────────┴─────────────────┘
```

### Checkout

```text
┌───────────────────────────┬────────────────────────────────┐
│ Order and item summary    │ Order type / table             │
│ 2 Burger          240.00  │ Customer search / promo        │
│ 1 Drink            60.00  │ Discount selector              │
│ Subtotal          300.00  │ Payment method: Cash           │
│ Discount            0.00  │ Received: [500.00]             │
│ Tax/service per settings │ Change: calculated             │
│ TOTAL: server calculated │ [Confirm Payment]              │
└───────────────────────────┴────────────────────────────────┘
```

### Confirmation

```text
Payment Confirmed — TXN-...
Total paid / amount received / change
[Print Receipt] [View Transaction] [New Sale]
```

These wireframes describe the intended screen structure; exact labels/layout can differ from the existing templates.

## 4. Complete checkout flow

1. Cashier logs in. Server loads the account role and applies route permissions.
2. Open POS Terminal; search/filter products and build the cart.
3. Submit cart. Server validates IDs, quantities, availability and stock; prices come from the database. It creates a Pending order and item snapshots, then redirects to checkout.
4. Choose Dine-In or Take-Out. Optionally assign a table for Dine-In. Current code allows Dine-In without a table; mandatory table selection would be a separate change.
5. Optionally choose a registered customer, POS discount and promo. Promo eligibility is checked through Customer Logs. Table conflicts and discounts are revalidated when saving/paying.
6. Compute totals using `utils/pos.js`: discount is clamped to subtotal; taxable amount = subtotal − discount; service = taxable × configured service rate; tax = (taxable + service) × configured tax rate; total = taxable + service + tax. Monetary components are rounded to two decimals.
7. Choose payment. Cash requires sufficient amount received; electronic payments require a reference and manual verification checkbox.
8. Inside one database transaction, lock the order; reject already paid/cancelled orders; check table/discount/payment; lock inventory rows and recheck available stock.
9. Deduct stock, record movements, create sale/payment/discount records, mark order Completed, update table availability and queue integration events. Database failure rolls back these local writes together.
10. After commit, attempt Accounting/Customer Logs delivery. Offline delivery can be retried through the outbox. A queued integration does not mean the remote module already received the sale.
11. Redirect to payment confirmation; open receipt and print or save as PDF.
12. Admin may void through the transaction page. Verify stock restoration and external reversal during testing.

## 5. Error handling guide

| Scenario | Existing handling / operator action |
| --- | --- |
| No login / expired session | Redirect to login; sign in again and check saved orders before resubmitting |
| Forbidden role | Flash error and redirect to Dashboard; admin reviews assigned role |
| Empty/malformed cart, invalid quantity | Flash error and redirect to Terminal; rebuild/check cart |
| Unavailable product or insufficient stock | Reject order/payment; check current stock and create a corrected order if needed |
| Table conflict | Reject assignment/payment; select another table |
| Invalid discount/promo | Reject application; remove/correct code or select an eligible customer |
| Customer Logs offline during promo check | Promo cannot be validated; retry or pay without promo |
| Insufficient cash | Reject payment; enter sufficient amount received |
| Missing electronic reference or verification | Reject payment; confirm provider receipt and complete required fields |
| Repeated payment | Reject already processed order; find the existing transaction instead of collecting funds again |
| Database failure during payment | Transaction rollback; inspect order/transaction state before retrying |
| Accounting delivery offline | Local payment can remain successful with queued delivery; admin checks sync status/retries |
| Unknown URL | Rendered 404 page |
| Unexpected web error | Rendered 500 page; inspect server logs. Current web handler can show `error.message` |

Recommended follow-ups, not implemented by this guide: generic unexpected-error messages with a support reference; consistent JSON errors for API consumers; preserve unsaved cart/input on validation failure; provider integration if automatic electronic payment verification is required. Do not treat the current web redirect behavior as JSON 400/403 responses.

## 6. Receipt printing format

Existing route: `/pos/receipts/:transactionId`; template: `views/pos/receipt.xian`; printing uses `window.print()` and hides `.no-print` controls. The receipt now has an 80mm/58mm paper selector, remembered in this browser, with matching print content width and 3mm margins. Set matching paper stock in the printer driver.

Example below assumes tax/service/discount are zero for illustration. Live receipts must use the saved transaction totals.

```text
             DJYum FoodHub
        [Configured store address]
          [Configured contact]
----------------------------------------
Transaction: TXN-EXAMPLE
Order:       ORD-EXAMPLE
Date:        [Transaction timestamp]
Cashier:     Maria
Type:        Take-Out
----------------------------------------
Item               Qty    Unit    Amount
Burger               2  120.00    240.00
Drink                1   60.00     60.00
----------------------------------------
Subtotal                         300.00
Discount                           0.00
Tax                                0.00
TOTAL                            300.00
Payment: Cash
Received                         500.00
Change                           200.00
----------------------------------------
       [Configured receipt footer]
```

Include service charge when applicable; show promo breakdown as part of the discount, not an additional deduction. Show provider reference for electronic payment. Test the actual printer, paper width, long product names and multi-page orders. Dedicated thermal page sizing and any additional business-required receipt fields are follow-up work.

## 7. Testing checklist

Use isolated test databases and test accounts. Record tester, date, build, inputs, expected vs actual result and evidence for each item. None of the boxes below imply an executed test.

### Roles and navigation

- [ ] Admin can manage products, settings, discounts, roles and voids.
- [ ] Cashier role is visible below the account name; admin links are hidden.
- [ ] Cashier cannot access admin-only URLs or POST actions directly.
- [ ] Cashier cannot view another cashier's transaction/receipt/confirmation.
- [ ] Inventory staff can manage stock and inventory reports; cannot collect payment.
- [ ] Restaurant staff can update permitted preparation statuses; cannot collect payment.
- [ ] Logout prevents access to authenticated pages.

### Cart, orders and totals

- [ ] Search and category filters work; Supply items cannot be sold.
- [ ] Empty cart, invalid IDs, zero/negative/oversized quantities are rejected.
- [ ] Duplicate cart lines merge correctly; tampered browser prices do not affect totals.
- [ ] Out-of-stock/unavailable products are rejected on submit.
- [ ] Dine-In/Take-Out and table changes save correctly; occupied-table conflicts are rejected.
- [ ] Fixed/percent discounts, promo eligibility/expiry/minimum spend and customer lookup work.
- [ ] Totals match configured tax/service rates and two-decimal rounding.
- [ ] Unpaid order creation does not deduct stock.

### Payment integrity

- [ ] Exact cash gives zero change; excess cash gives correct change.
- [ ] Insufficient/invalid cash is rejected with no stock/payment write.
- [ ] GCash/Maya/card require reference and `verified: 'on'`.
- [ ] Double-click/repeated payment creates one transaction and one stock deduction.
- [ ] Two sessions competing for the last stock cannot oversell.
- [ ] Simulated DB failure rolls back sale, payment, stock and movement together.
- [ ] Cancelled/already processed orders cannot be paid.
- [ ] Admin void restores stock once; repeated void does not restore twice.

### Receipt, integration and presentation

- [ ] Receipt uses saved totals and correct cashier/order/payment details.
- [ ] Print preview/PDF and actual printer output are readable; controls are hidden.
- [ ] Long names/large orders fit without clipped totals.
- [ ] Accounting receives one sale; offline delivery retries without duplicate posting.
- [ ] Customer loyalty/promo effects and void reversals reconcile with Customer Logs.
- [ ] Inventory API rejects unauthorized keys and fractional quantities.
- [ ] Repeated receipt/return numbers do not duplicate stock adjustments.
- [ ] Sales/inventory reports match known test transactions and movements.
- [ ] Dark theme remains readable on Terminal, Checkout, Dashboard and login at desktop/mobile sizes.

### Local startup

Start MySQL, then from the ERP root:

```powershell
npm run dev -- --only=pos
```

Use `npm run dev` instead when testing live integrations across all five modules. Initial dependency/database/account setup is documented in the ERP root README. Preserve the configured database set while testing; do not run destructive resets against existing business data.

## Implementation verification

The functional update adds role-based landing pages, cashier order ownership enforcement at checkout/payment, whole-number quantity validation, per-user session cart drafts, safe unexpected-error messages, and a 58mm/80mm receipt selector. Existing transactional payment, stock movements, voids and reports remain in use.

Executed: `npm test` (3 passed) and `npm run test:checkout` (27 HTTP/MySQL checks passed), including concurrent last-stock payments and manually verified GCash. Terminal/checkout generated inline scripts were parsed successfully. Integration tests use unique `pos_test_*` databases and leave them for inspection; they do not modify the live POS database or send payments to ERP peers. Live Accounting/Customer Logs delivery, physical printer output and browser interaction checks still need manual validation.

To see changes: restart POS, sign out and sign in as a cashier; Terminal opens directly. Add items and refresh to restore the draft. Complete checkout, open the receipt and choose paper width.

## Ingredient-based Stock Management

The Stock Management sidebar entry now groups Ingredients Overview, Low Stock, Out of Stock, Stock Movements, Stock In, Stock Out, Stock Adjustment and Ingredients & Recipes. Stock screens and inventory reports list Supply items (ingredients), while Products lists sellable menu items.

The six requested raw materials are Pita Bread (pcs), Beef (grams), Cabbage (grams), Cucumber (grams), Onion (grams), Shawarma Sauce (ml). Actual opening stock and recipe amounts must be entered; none were assumed. Use Stock In for deliveries and set minimum levels for alerts. Do not add grams, ml and pieces into a single unit count.

Under Ingredients & Recipes, select a menu product and enter ingredient quantities used per one serving. Save Recipe as admin. The POS then derives available servings from the limiting ingredient; checkout deducts aggregated ingredient quantities atomically. A void restores the saved movement quantities, even if the recipe has changed. Products without a saved recipe retain their existing finished-product stock behavior until configured. Historic sales and product stock are preserved.

Implementation uses the new pos_recipes table, registered during safe bootstrap. Recipe and stock quantities are whole base units; use grams instead of fractional kg and ml instead of fractional liters. Live ERP procurement mappings and physical stock reconciliation should be checked with the actual supplier data.
