# DJ's ERP: LAN Mode (each member runs their module on their own laptop)

For the defence, the 5 modules run on 5 laptops on the same Wi-Fi. One laptop is the **DB host**: it
runs MySQL (Laragon) with all 5 databases. Every other laptop runs only its own module and connects to
the DB host by its IP address.

```
                     Same Wi-Fi (or phone hotspot)
 ┌──────────────────────────── DB host (CJ's laptop) ───────────────────────────┐
 │  Laragon MySQL :3306                                                         │
 │  xianfires_erp · djs_hr · djs_pos · djs_procurement · djs_customer_logs      │
 │  Accounting module :3000                                                     │
 └──────────────────────────────────────────────────────────────────────────────┘
        ▲ DB_HOST=<host IP>          ▲                 ▲                 ▲
   POS laptop :3001            HR laptop :3002   Procurement :3003   Customer Logs :3004
```

What does not change: every module still has **its own database** and touches only that one. Modules
talk to each other **only through their APIs** (POS sale → Accounting journal, HR payroll → Accounting,
Procurement invoice → Accounting bill, Procurement receipt → POS stock, POS customer → Customer Logs).
LAN mode only tells each module two things: where the database server is (`DB_HOST`) and where the
other modules are (`ERP_URL_*`).

Module codes used below: `erp` Accounting, `pos` POS & Inventory, `hr` HR, `scm` Procurement,
`crm` Customer Logs.

## Step 1 · DB host (CJ's laptop)

1. **Laragon → Start All.** Keep the laptop plugged in, with sleep turned off.
2. **Wi-Fi → Private.** Click the Wi-Fi icon → your network → Properties → Network profile type:
   **Private network**. Do this again on every new Wi-Fi (school, hotspot).
3. **Open the firewall** (once). PowerShell **as administrator**:
   ```powershell
   New-NetFirewallRule -DisplayName "DJ's ERP MySQL" -Direction Inbound -Protocol TCP -LocalPort 3306 -Action Allow -Profile Private
   New-NetFirewallRule -DisplayName "DJ's ERP modules" -Direction Inbound -Protocol TCP -LocalPort 3000-3004 -Action Allow -Profile Private
   ```
4. **Get each member's IP.** Every member runs `ipconfig` and sends the **IPv4 Address under
   "Wireless LAN adapter Wi-Fi"** in the group chat (ignore `192.168.56.x`).
5. **Set up LAN mode**, giving the IP of each laptop that runs a module (leave out a module to run it on
   the DB host):
   ```bash
   npm run lan -- host --pos=192.168.1.21 --hr=192.168.1.22 --scm=192.168.1.23 --crm=192.168.1.24
   ```
   This checks MySQL, creates the MySQL account `djs_erp` that other laptops use (it can open only the
   ERP databases), sets `ERP_URL_*` in `.env`, and writes **`lan/member.env`**.
6. **Send `lan/member.env` to the members** privately (it holds the database password and the API
   keys). Never commit it; `lan/` is in `.gitignore`.
7. Start Accounting (plus any module whose owner is absent):
   ```bash
   npm run dev -- --only=erp
   ```

## Step 2 · Every other member

1. Get the **same code**: `git pull` in the group repo folder. Then install once:
   ```bash
   npm run setup
   ```
2. Wi-Fi set to **Private**, and run the **second** firewall line from Step 1.3 (so others can open
   your module).
3. Save the `member.env` you received as **`.env` in the repo root** (next to `package.json`).
4. Test it. It changes nothing and every ✗ prints the fix:
   ```bash
   npm run lan -- check
   ```
5. Start **only your module** (`pos`, `hr`, `scm` or `crm`):
   ```bash
   npm run dev -- --only=pos
   ```

**Never run `npm run migrate` on a member laptop.** Migrations run only on the DB host.

## Defence morning checklist

Do this on the Wi-Fi you will use at the defence, at least 10 minutes before your slot.

- [ ] DB host: plugged in, sleep off, Laragon **Start All**
- [ ] Everyone: Wi-Fi set to **Private**
- [ ] Everyone runs `ipconfig` and posts the Wi-Fi IPv4. IPs change on every new Wi-Fi
- [ ] DB host: `npm run lan -- host --pos=… --hr=… --scm=… --crm=…`, then re-sends `lan/member.env`
- [ ] Everyone: save the new `member.env` as `.env`, then `npm run lan -- check` (all ✓ in parts 1–3)
- [ ] Everyone: `npm run dev -- --only=<module>`
- [ ] DB host: `npm run lan -- check` again; part 4 should show all 5 modules **up**
- [ ] Demo the links: a POS sale shows up in Accounting's journal, HR "Mark as Paid" posts payroll,
      Accounting → Enterprise Overview shows all modules online

## If something fails

| Problem | Fix |
|---|---|
| `check` part 2: DB host not reachable (`timeout`) | Same Wi-Fi? DB host IP changed (run `ipconfig` again)? DB host: Laragon Start All, firewall rule for 3306, Wi-Fi Private |
| School Wi-Fi blocks laptop-to-laptop traffic | Use one phone hotspot for all laptops, then redo the checklist (new IPs) |
| `check` part 3: `ER_ACCESS_DENIED_ERROR` | The DB host re-ran `lan -- host`; get the newest `member.env` |
| A module shows **down** in part 4 | Start it on its laptop; that laptop needs the second firewall line and a Private Wi-Fi |
| `npm run dev` prints "ERP_URL points to an IP that is not this laptop" | The Wi-Fi changed. DB host: run `lan -- host` again and re-send `member.env` |
| A member's laptop dies | DB host: run `lan -- host` again **without** that module's `--code=IP`, re-send `member.env`, and start that module on the DB host too, e.g. `npm run dev -- --only=erp,pos` |
| The network fails completely | **One-laptop mode** on the DB host: `npm run lan -- reset`, then `npm run dev` (all 5 modules on localhost) |

## For the panel: how the modules connect

- **One MySQL server, five databases.** The DB host runs Laragon MySQL with one database per module
  (`xianfires_erp`, `djs_hr`, `djs_pos`, `djs_procurement`, `djs_customer_logs`). A module's `.env`
  points `DB_HOST` to the host's IP; the MySQL account `djs_erp` may open only these databases.
- **No module reads another module's database.** Everything between modules goes through REST APIs:
  Accounting's `/api/v1` with one API key per module, and the modules' internal APIs with the shared
  `X-ERP-Key`. The address of each module is in `ERP_URL_*`.
- **Nothing is lost if a laptop is offline.** POS, HR and Procurement save the record first with a sync
  status (Pending / Synced / Failed) and retry every 60 seconds, so the journal entry is posted once the
  other laptop is back.
