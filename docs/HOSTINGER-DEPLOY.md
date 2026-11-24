# I-deploy sa Hostinger at gawing mobile app

Ang Accounting ay isa nang **installable app (PWA)**: iisang system para sa web at sa cellphone. Kapag
naka-deploy na sa Hostinger na may `https://`, puwede itong i-install sa Android o iPhone na parang app
(may sariling icon at walang address bar), at bukas pa rin sa browser ng laptop.

## 1. Ano ang kailangan sa Hostinger

| Kailangan | Saan sa hPanel |
|---|---|
| Node.js app ("Web Apps") | Websites → **Web Apps** → Create / Add |
| MySQL database | Databases → **MySQL Databases** (isa bawat module) |
| Domain o subdomain | Domains → Subdomains (hal. `accounting.yourdomain.com`) |
| HTTPS (SSL) | Security → **SSL**. Libre ito; kailangan para ma-install ang app sa cellphone |

> Kung walang "Node.js" o "Web Apps" na mapipili sa plan, hindi kaya ng plan ang Node.js at
> kailangan ng Business/Cloud plan o VPS. Lumalabas na may "Web Apps" sa hPanel mo, kaya dapat kaya.

## 2. I-deploy ang Accounting

### a. Gumawa ng database
Databases → MySQL Databases → gumawa ng database at user (hal. `u123_accounting` / `u123_acct`).
Isulat ang **database name, user, password at host** (madalas `localhost`, o ang host na ipinapakita ng hPanel).

### b. Gumawa ng Web App
Websites → Web Apps → Create, at piliin ang **Node.js / Express**:

| Setting | Ilagay |
|---|---|
| Source | **GitHub** → `Cmendoza11/xianfires-erp-group-project`, branch `main` (o i-upload ang ZIP ng folder) |
| Root / application directory | `xianfires erp project` |
| Node version | 20 o mas bago |
| Install command | `npm install` |
| Entry file / start command | `start-hosted.js` (o `npm run start:hosted`) |

Ang `start-hosted.js` ang gumagawa ng mga table (ligtas ulitin), gumagawa ng unang admin, at nagsisimula
ng server. Kaya hindi na kailangan ng terminal sa Hostinger.

### c. Environment variables
Ilagay sa Environment variables ng Web App (huwag i-commit ang mga ito):

```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=<database name mula sa 2a>
DB_USER=<database user>
DB_PASSWORD=<database password>
SESSION_SECRET=<mahabang random na text, 40+ characters>
ALLOW_SIGNUP=false
TRUST_PROXY=true
COOKIE_SECURE=true
ADMIN_NAME=Administrator
ADMIN_EMAIL=<email ng admin>
ADMIN_PASSWORD=<malakas na password>
```

Hindi kailangang ilagay ang `PORT`; ang Hostinger ang nagbibigay nito.
Pagkatapos makapasok ang admin, puwede nang burahin ang `ADMIN_PASSWORD` sa env.

### d. Domain at HTTPS
Ikabit ang subdomain (hal. `accounting.yourdomain.com`) sa Web App, at i-on ang SSL.
Buksan ang `https://accounting.yourdomain.com/admin` at mag-login.

## 3. I-install sa cellphone

| Phone | Paano |
|---|---|
| Android (Chrome) | Buksan ang site → ⋮ menu → **Install app** (o "Add to Home screen") |
| iPhone (Safari) | Buksan ang site → **Share** → **Add to Home Screen** |
| Laptop (Chrome/Edge) | May install icon sa dulo ng address bar |

Lalabas ang icon na "DJ's Accounting". Bubukas ito nang full screen, may shortcuts (pindutin nang matagal
ang icon) papunta sa Journal Entries, Sales Invoices at Payroll. Kapag walang internet, may "You are
offline" na page sa halip na error. Hindi naiimbak sa phone ang mga page na may datos, para ligtas ito
kung mawala ang cellphone.

## 4. Ang ibang module (HR, POS, Procurement, Customer Logs)

Pareho ang paraan, **isang Web App + isang database + isang subdomain bawat module**:

| Module | Root directory | Halimbawang subdomain |
|---|---|---|
| HR | `DJs-Human-Resource-Management-main` | `hr.yourdomain.com` |
| POS & Inventory | `PointOfSales-main/PointOfSales-main` | `pos.yourdomain.com` |
| Procurement | `eventdriven_selda-main/eventdriven_selda-main` | `scm.yourdomain.com` |
| Customer Logs | `Dj-s-Customer-Logs-main/Dj-s-Customer-Logs-main` | `crm.yourdomain.com` |

Para magkakonekta online, gamitin ang mga `https://` address sa halip na LAN IP:

```
# sa Accounting
ERP_URL_HR=https://hr.yourdomain.com
ERP_URL_POS=https://pos.yourdomain.com
ERP_URL_SCM=https://scm.yourdomain.com
ERP_URL_CRM=https://crm.yourdomain.com
ERP_INTERNAL_KEY=<iisang key sa lahat ng module>
```

Sa bawat ibang module, ang URL ng Accounting ay `https://accounting.yourdomain.com` at ang API key na
inisyu sa Accounting (Integrations). Ang may-ari ng bawat module ang mag-aayos ng sarili niyang env,
sa sarili niyang `feature/` branch at PR. Tingnan muna kung ilang Web Apps ang kaya ng plan; kung kulang,
uunahin ang Accounting at HR (sila ang may salary release).

## 5. Mga dapat malaman

- **Backup/Restore page**: gumagamit ito ng `mysqldump`. Kung wala ito sa Hostinger, gamitin ang
  hPanel → Databases → phpMyAdmin → Export, o ang automatic backups ng Hostinger.
- **Mga LAN tool** (`npm run lan`, monitor .bat): pang-lokal lang; hindi kailangan online.
- **Lokal pa rin gumagana**: ang mga bagong setting (`TRUST_PROXY`, `COOKIE_SECURE`) ay naka-off
  kapag hindi itinakda, kaya pareho pa rin ang Laragon, LAN at Docker.

## 6. Paano ito sinubukan (2026-11-24)

| Check | Resulta |
|---|---|
| Headless Chrome: service worker | activated, scope `/`, naka-cache ang 5 static file |
| Chrome installability check | **walang error** (manifest, icons 192 at 512, service worker) |
| Patay ang server, binuksan ang page | lumabas ang "You are offline" page |
| `start-hosted.js` sa bagong database | gumawa ng tables at admin, nakapag-login (200) |
| `npm test` | lahat pasado: crawl 114, features 37, security 77, reliability 11, payroll 28, enhancements 36 |
