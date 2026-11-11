# DJ's ERP

An ERP for DJ's FoodHub restaurant, made of five systems that share **one central MySQL database**
and work together:

| Module | Folder | Port |
|---|---|---|
| Accounting | `xianfires erp project/` | 3000 |
| POS & Inventory | `PointOfSales-main/PointOfSales-main/` | 3001 |
| Human Resources | `DJs-Human-Resource-Management-main/` | 3002 |
| Procurement (suppliers) | `eventdriven_selda-main/eventdriven_selda-main/` | 3003 |
| Customer Logs (loyalty) | `Dj-s-Customer-Logs-main/Dj-s-Customer-Logs-main/` | 3004 |

Each module keeps its own login and screens. What they share:

- POS sales and voids post to Accounting, and customer purchases add loyalty points in Customer Logs.
- Paid payroll in HR posts to Accounting. HR's departments are used by Procurement.
- Procurement deliveries and returns update POS stock. Supplier invoices become bills in
  Accounting, and their payment status is read back from Accounting.
- Accounting's **Enterprise Overview** shows live figures from all five modules.

## Requirements

- Node.js 20.12 or newer
- MySQL 8 (for example Laragon), user `root` with no password by default

## Run it

From this folder:

```bash
npm run setup     # installs every module's dependencies
npm run migrate   # creates the central database (xianfires_erp) and the API keys; safe to re-run
npm run dev       # starts all five modules
```

The first `npm run migrate` creates `.env` from `.env.example` and fills in the generated keys.
Change database settings or ports in `.env`. `npm run check` syntax-checks every module.

First accounts:

- **Accounting**: `npm run user:create -- --name "Your Name" --email you@example.com --password yourpassword` in its folder
- **POS & Inventory**: the first account registered at `/register` becomes the admin
- **HR**: created by `npm run migrate` (it asks for the admin email and password)
- **Procurement**: seeded as `admin@gmail.com` / `admin123`; change it
- **Customer Logs**: register at `/register`

## Documentation

- [docs/ERP-INTEGRATION.md](docs/ERP-INTEGRATION.md): how the modules share data, which accounts each
  flow posts to, and the rules for changing the code
- [xianfires erp project/docs/ERP-API.md](xianfires%20erp%20project/docs/ERP-API.md): the Accounting API
  the other modules use
