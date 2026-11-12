# DJ's ERP

An ERP for DJ's FoodHub restaurant, made of five systems. **Each system has its own MySQL database**,
and they share data only through each other's APIs:

| Module | Folder | Port | Database |
|---|---|---|---|
| Accounting | `xianfires erp project/` | 3000 | `xianfires_erp` |
| POS & Inventory | `PointOfSales-main/PointOfSales-main/` | 3001 | `djs_pos` |
| Human Resources | `DJs-Human-Resource-Management-main/` | 3002 | `djs_hr` |
| Procurement (suppliers) | `eventdriven_selda-main/eventdriven_selda-main/` | 3003 | `djs_procurement` |
| Customer Logs (loyalty) | `Dj-s-Customer-Logs-main/Dj-s-Customer-Logs-main/` | 3004 | `djs_customer_logs` |

Each module keeps its own login, screens and database. What they share, through their APIs:

- POS sales and voids post to Accounting, and customer purchases add loyalty points in Customer Logs.
- HR computes payroll from attendance (DTR) with SSS, PhilHealth, Pag-IBIG and cash advances; "Mark as
  Paid" posts it to Accounting. HR's departments are used by Procurement.
- Customer Logs promo codes are applied at the POS checkout; the redemption and loyalty points are
  recorded in Customer Logs, and a void gives them back.
- Procurement deliveries and returns update POS stock. Supplier invoices become bills in
  Accounting, and their payment status is read back from Accounting.
- Accounting's **Enterprise Overview** shows live figures from all five modules.

## Requirements

- Node.js 20.12 or newer
- MySQL 8 (for example Laragon), user `root` with no password by default

## Run it

From this folder:

```bash
npm run setup      # installs every module's dependencies
npm run migrate    # creates the five databases and the API keys; safe to re-run
npm run accounts   # one admin login (same email and password) in all five modules
npm run dev        # starts all five modules
```

The first `npm run migrate` creates `.env` from `.env.example` and fills in the generated keys.
Change database settings or ports in `.env`. `npm run check` syntax-checks every module.
An older install that kept every module inside `xianfires_erp` is split into the five databases
by `npm run migrate` (rows, indexes and each module's own foreign keys move with their tables).

Other first accounts, if you do not use `npm run accounts`:

- **Accounting**: `npm run user:create -- --name "Your Name" --email you@example.com --password yourpassword` in its folder
- **POS & Inventory**: the first account registered at `/register` becomes the admin
- **HR**: created by `npm run migrate` (it uses `ADMIN_EMAIL` / `ADMIN_PASSWORD`, or asks)
- **Procurement**: created by `npm run migrate` from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- **Customer Logs**: register at `/register`

See [COMMANDS.md](COMMANDS.md) for every command, including the `_demo` database set.

## Documentation

- [docs/ERP-INTEGRATION.md](docs/ERP-INTEGRATION.md): how the modules share data, which accounts each
  flow posts to, and the rules for changing the code
- [xianfires erp project/docs/ERP-API.md](xianfires%20erp%20project/docs/ERP-API.md): the Accounting API
  the other modules use
