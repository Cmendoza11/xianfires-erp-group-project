# DJ's ERP

An ERP for DJ's FoodHub restaurant, made of five systems. **Each system has its own MySQL database**,
and they share data only through each other's APIs:

| Module | Folder | Port | Database | Owner |
|---|---|---|---|---|
| Accounting (the hub) | `xianfires erp project/` | 3000 | `xianfires_erp` | CJ |
| POS & Inventory | `PointOfSales-main/PointOfSales-main/` | 3001 | `djs_pos` | teammate |
| Human Resources | `DJs-Human-Resource-Management-main/` | 3002 | `djs_hr` | teammate |
| Procurement (suppliers) | `eventdriven_selda-main/eventdriven_selda-main/` | 3003 | `djs_procurement` | teammate |
| Customer Logs (loyalty) | `Dj-s-Customer-Logs-main/Dj-s-Customer-Logs-main/` | 3004 | `djs_customer_logs` | teammate |

What they share, through their APIs:

- POS sales and voids post to Accounting, and customer purchases add loyalty points in Customer Logs.
- HR computes payroll from attendance (DTR) with SSS, PhilHealth, Pag-IBIG and cash advances, and
  approves it. **Accounting releases the salary** (Payroll > Release salary), which posts the entry and
  marks the payroll Paid in HR. HR's departments are used by Procurement.
- Customer Logs promo codes are applied at the POS checkout; the redemption and loyalty points are
  recorded in Customer Logs, and a void gives them back.
- Procurement deliveries and returns update POS stock. Supplier invoices become bills in
  Accounting, and their payment status is read back from Accounting.
- Accounting's **Enterprise Overview** shows live figures from all five modules.

## Requirements

- Node.js 20.12 or newer
- MySQL 8 (for example Laragon), user `root` with no password by default

## Run it on one laptop

From this folder:

```bash
npm run setup      # installs every module's dependencies
npm run migrate    # creates the five databases and the API keys; safe to re-run
npm run accounts   # one admin login (same email and password) in all five modules
npm run dev        # starts all five modules
```

The first `npm run migrate` creates `.env` from `.env.example` and fills in the generated keys.
Change database settings or ports in `.env`. `npm run check` syntax-checks every module.

## Run it across laptops (LAN mode)

The Accounting laptop is the **host**: it runs MySQL (all five databases) and Accounting. Every other
member runs only their own module on their own laptop, on the same Wi-Fi or hotspot.

| Who | What to do |
|---|---|
| Host (CJ) | Double-click **`DJs-ERP-Host.bat`**, type each member's IP. Send each member their `lan/connect-<module>.txt` and `lan/test-<module>.bat` privately. |
| Each member | Double-click `test-<module>.bat` (3 OK), then `npm run lan -- import "<path>\connect-<module>.txt"`, `npm run lan -- check`, `npm run dev -- --only=<module>`. |
| Host (CJ) | Double-click **`DJs-ERP-Monitor.bat`** to see who is connected. |

Guides: [docs/ACCOUNTING-HOST.md](docs/ACCOUNTING-HOST.md) (host),
[docs/PARA-SA-KAGRUPO.md](docs/PARA-SA-KAGRUPO.md) (members), [docs/LAN-SETUP.md](docs/LAN-SETUP.md) (details).

## Accounting features

Chart of accounts, journal entries (reversal only, never deleted), sales invoices and supplier bills with
payments, expense vouchers with receipts, fixed assets with monthly depreciation, salary release from
HR payroll with payslips and a payroll summary, bank reconciliation, budget vs actual, period closing,
reports (trial balance, income statement, balance sheet, cash flow, general ledger, aging, VAT, books)
with print and Export to Excel, audit log, roles (admin, accountant, viewer), login lockout, recycle bin,
backup and restore, light and dark mode, and the `/api/v1` integration API.

## Docker (Accounting)

```bash
cd "xianfires erp project"
docker compose up -d --build      # Accounting + its own MySQL; open http://localhost:3000
```

Details, defense demo and commands: [xianfires erp project/docs/DOCKER.md](xianfires%20erp%20project/docs/DOCKER.md).

## Tests

```bash
npm run test:accounting   # every Accounting end-to-end test, on disposable copies of the databases
```

Needs Laragon MySQL running and ports 3010 to 3012 free. The real books are never written.

## Documentation

| File | For |
|---|---|
| [COMMANDS.md](COMMANDS.md) | Every command (Taglish cheat sheet) |
| [docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md) | Branches, pull requests, merging, conflict resolution and the merge log |
| [docs/TEST-TRANSACTIONS.txt](docs/TEST-TRANSACTIONS.txt) | 23 test transactions across all five systems |
| [docs/ERP-INTEGRATION.md](docs/ERP-INTEGRATION.md) | How the modules share data and which accounts each flow posts to |
| [xianfires erp project/docs/ERP-API.md](xianfires%20erp%20project/docs/ERP-API.md) | The Accounting API the other modules use |
| [docs/ACCOUNTING-HOST.md](docs/ACCOUNTING-HOST.md) | Host laptop setup for the defense |
| [docs/PARA-SA-KAGRUPO.md](docs/PARA-SA-KAGRUPO.md) | Members: how to connect to the host |
| [docs/LAN-SETUP.md](docs/LAN-SETUP.md) | LAN mode in detail, troubleshooting |
| [docs/DEFENSE-WALKTHROUGH.md](docs/DEFENSE-WALKTHROUGH.md) | Accounting demo script and likely questions |
| [docs/SYSTEM-AUDIT.md](docs/SYSTEM-AUDIT.md) | QA, DevOps and UI/UX review of Accounting |
| [xianfires erp project/docs/DOCKER.md](xianfires%20erp%20project/docs/DOCKER.md) | Running Accounting in Docker |
| [docs/ACCOUNTING-SYSTEM-EXPLAINED.txt](docs/ACCOUNTING-SYSTEM-EXPLAINED.txt) | Plain-text explanation of every Accounting feature |
| [docs/design/](docs/design/) | ERP diagram details and the diagram base document |
