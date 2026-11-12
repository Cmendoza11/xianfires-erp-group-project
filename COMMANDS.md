# DJ's ERP: mga command (cheat sheet)

Lahat ng command dito ay para sa **PowerShell** (ang default na terminal ng VS Code sa Windows).

---

## 0. Bago mag-run (lagi)

1. Buksan ang **Laragon**, tapos i-click ang **Start All** para tumakbo ang MySQL.
2. Sa VS Code, buksan ang terminal gamit ang `` Ctrl + ` ``.
3. Pumunta sa root folder ng project:

```powershell
cd "C:\Users\CJ Mendoza\Desktop\xianfires-erp-group-project"
```

> Laging dito sa **root folder** mag-run. Huwag mag-`npm start` sa loob ng folder ng isang module,
> dahil hindi nito mababasa ang root `.env` (database, ports, API keys).

---

## 1. Unang setup (isang beses lang, o pagkatapos mag-clone)

```powershell
npm run setup      # nag-iinstall ng packages ng lahat ng 5 modules
npm run migrate    # gumagawa ng 5 database (isa bawat module) at API keys (safe kahit ulitin)
npm run accounts   # gumagawa ng iisang admin account mo sa lahat ng 5 modules
```

---

## 2. Ang mga database (isa bawat system)

May **sariling database** ang bawat system sa MySQL ng Laragon. Sa API lang sila nag-uusap.

| System | Totoong database | Demo database |
|---|---|---|
| Accounting | `xianfires_erp` | `xianfires_erp_demo` |
| HR | `djs_hr` | `djs_hr_demo` |
| POS & Inventory | `djs_pos` | `djs_pos_demo` |
| Procurement | `djs_procurement` | `djs_procurement_demo` |
| Customer Logs | `djs_customer_logs` | `djs_customer_logs_demo` |

Makikita mo sila sa phpMyAdmin: http://localhost/phpmyadmin (user `root`, walang password).

**Pumili ng set:**

| Gusto mo | I-type muna ito |
|---|---|
| **Totoong data** (araw-araw na gamit) | *(wala; ito ang default)* |
| Demo data (fake data mula sa testing) | `$env:DB_SUFFIX="_demo"` |

- Naka-set lang ito sa terminal na 'yon. Pag nagbukas ka ng bagong terminal, totoong data ulit.
- Para makita kung anong set ang naka-set: `$env:DB_SUFFIX` (blank = totoong data).
- Para tanggalin ang setting: `Remove-Item Env:DB_SUFFIX`.
- May sariling API keys sa `.env` ang bawat set, kaya **hindi na kailangang mag-migrate** kapag lumilipat.

---

## 3. I-run LAHAT sa isang terminal

Totoong database:

```powershell
npm run dev
```

Demo data:

```powershell
$env:DB_SUFFIX="_demo"
npm run dev
```

Para ihinto lahat: **Ctrl + C**.

---

## 4. I-run ISA-ISA (hiwalay na terminal para hiwalay ang logs)

Pindutin ang **+** sa terminal panel ng VS Code para sa bawat bagong terminal. Sa bawat isa:

```powershell
cd "C:\Users\CJ Mendoza\Desktop\xianfires-erp-group-project"
$env:DB_SUFFIX="_demo"   # kung demo
```

Tapos isa sa mga ito:

```powershell
npm run dev -- --only=erp     # Accounting       -> port 3000
npm run dev -- --only=pos     # POS & Inventory  -> port 3001
npm run dev -- --only=hr      # HR               -> port 3002
npm run dev -- --only=scm     # Procurement      -> port 3003
npm run dev -- --only=crm     # Customer Logs    -> port 3004
```

Puwede rin ang dalawa o higit pa nang sabay: `npm run dev -- --only=erp,pos`

---

## 5. Mga link at login

**Totoong database:** iisang account sa lahat. Email **admin@djs.local**, at ang password mo
(palitan anumang oras gamit ang `npm run accounts -- --email admin@djs.local`).

| Module | Link |
|---|---|
| Accounting | http://localhost:3000/admin/login |
| POS & Inventory | http://localhost:3001/login |
| HR | http://localhost:3002/login |
| Procurement | http://localhost:3003/login |
| Customer Logs | http://localhost:3004/login |

**Demo database:** password ng lahat ay **Demo12345**

| Module | Login (demo) |
|---|---|
| Accounting | accountant@djs.demo |
| POS & Inventory | pos.admin@djs.demo / pos.cashier@djs.demo |
| HR | hr.admin@djs.demo |
| Procurement | admin@gmail.com / admin123 |
| Customer Logs | crm.staff@djs.demo |

Sa Accounting, nasa **Enterprise Overview** (`/admin/enterprise`) ang buod ng lahat ng 5 modules.

---

## 6. Iba pang command

**Gumawa ng account o magpalit ng password sa LAHAT ng 5 modules nang sabay**

```powershell
npm run accounts -- --email admin@djs.local
```

Itatanong nito ang pangalan at password mo (nakatago bilang `****`, dalawang beses). Kapag may
account na, papalitan lang ang password. Para sa ibang tao, ibang email lang ang ilagay.
Para sa demo set, idagdag ang `--suffix _demo`.

**Syntax check ng lahat ng code**

```powershell
npm run check
```

**Bagong Accounting user** (sa folder ng Accounting)

```powershell
cd "C:\Users\CJ Mendoza\Desktop\xianfires-erp-group-project\xianfires erp project"
npm run user:create -- --name "Juan Dela Cruz" --email juan@djs.test --password Secret123
npm run user:changePassword -- --email juan@djs.test --password BagongPass123
```

> Para sa demo DB, i-type muna ang `$env:DB_NAME="xianfires_erp_demo"`.

**Palitan ang password ng POS account** (sa folder ng POS)

```powershell
cd "C:\Users\CJ Mendoza\Desktop\xianfires-erp-group-project\PointOfSales-main\PointOfSales-main"
npm run user:password -- --email pos.admin@djs.demo --password BagongPass123 --db djs_pos_demo
```

> Tanggalin ang `--db ...` kung sa totoong database.

**Bumalik sa root folder**

```powershell
cd "C:\Users\CJ Mendoza\Desktop\xianfires-erp-group-project"
```

> **Huwag gamitin** ang `npm run db:reset` at `npm run db:seed` sa Procurement folder,
> dahil binubura nila ang data.

---

## 7. Git (pag-save sa GitHub)

```powershell
git status                      # ano ang nagbago
git pull                        # kunin ang changes ng teammates
git add -A                      # isama lahat ng binago
git commit -m "Ano ang ginawa"  # i-save nang may message
git push                        # i-upload sa GitHub
```

---

## 8. Kapag may error

| Error | Ibig sabihin | Gawin |
|---|---|---|
| `EADDRINUSE` / port in use | May tumatakbo na sa port na 'yan | Isara ang ibang terminal na nagpapatakbo, o tingnan sa ibaba |
| `ECONNREFUSED ... 3306` | Patay ang MySQL | Laragon, tapos **Start All** |
| `Unknown database` | Wala pa ang database | `npm run migrate` |
| Hindi lumalabas ang binago sa page | Hindi pa na-restart ang server | **Ctrl + C**, tapos `npm run dev` ulit |
| Na-logout pagkatapos mag-restart | Normal; nasa memory ang sessions | Mag-login ulit |

**Hanapin at patayin ang naiwang process sa isang port** (halimbawa, 3000):

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
Stop-Process -Id <numero_ng_OwningProcess>
```

---

*Kung Git Bash ang gamit mo imbes na PowerShell, ganito naman ang pag-set ng database:
`DB_SUFFIX=_demo npm run dev`*
