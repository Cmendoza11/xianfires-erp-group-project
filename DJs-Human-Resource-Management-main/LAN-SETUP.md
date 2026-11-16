# HR on its own laptop (LAN mode)

The **Accounting laptop is the host**. It runs Laragon MySQL with all five databases, and Accounting
runs there on port 3000. HR runs on its own laptop on the same Wi-Fi. HR's database is still its own
database, `djs_hr`, but it lives on the host. HR still reaches Accounting only through Accounting's
API, which it uses to post paid payroll.

```
 HR laptop (port 3002)  --DB_HOST:3306-->  Accounting laptop: MySQL (djs_hr, xianfires_erp, ...)
                        --ERP_URL_ERP---->  Accounting laptop: Accounting app :3000 (/api/v1)
```

## Step 1 · On the Accounting laptop (host, once)

1. Laragon → **Start All**. At the ERP root, run `npm run migrate` once, so `djs_hr` exists and
   `ERP_API_KEY_HR` is issued in the root `.env`.
2. Right-click Laragon → MySQL → `my.ini`: put `#` in front of `skip-grant-tables`, and set
   `bind-address=0.0.0.0` if a `bind-address=127.0.0.1` line exists. Save, then Stop → Start All.
3. phpMyAdmin → SQL. This account can open **only** HR's database:

   ```sql
   CREATE USER 'djs_hr'@'%' IDENTIFIED BY 'choose-a-password';
   GRANT ALL PRIVILEGES ON djs_hr.* TO 'djs_hr'@'%';
   FLUSH PRIVILEGES;
   ```

4. In PowerShell (as administrator), open the ports:

   ```powershell
   New-NetFirewallRule -DisplayName "DJs ERP MySQL" -Direction Inbound -Protocol TCP -LocalPort 3306 -Action Allow -Profile Private
   New-NetFirewallRule -DisplayName "DJs ERP modules" -Direction Inbound -Protocol TCP -LocalPort 3000-3004 -Action Allow -Profile Private
   ```

5. Wi-Fi → Properties → Network profile: **Private**. Run `ipconfig` and send the
   **Wireless LAN adapter Wi-Fi → IPv4 Address** to the HR laptop (for example 192.168.1.10).
6. Send these two values from the root `.env` privately (not in the group chat):
   `ERP_API_KEY_HR` and `ERP_INTERNAL_KEY`.

## Step 2 · On the HR laptop

1. In the HR folder: `npm install`, then copy `.env.example` to `.env`.
2. Fill in `.env`: `DB_HOST` and every `ERP_URL_*` get the host's IP. `ERP_URL_HR` gets this
   laptop's own IP. Set `DB_PASSWORD` to the password from Step 1.3, and paste the two keys.
3. Run the firewall line for ports 3000-3004 here too, so others can open HR. Set Wi-Fi to Private.
4. Test: `npm run check:lan`. It must end with `✓ HR is connected to the host`. It stops at the
   first ✗ and prints the fix.
5. Start: `npm run xian` (or `xian dev`). The console prints `LAN: http://<ip>:3002`, the address
   the others open.

Do **not** run `npm run migrate` from the HR laptop unless the host's `djs_hr` is empty. The host
already set it up.

## Problems

| Problem | Fix |
|---|---|
| Step 2 times out on school Wi-Fi | The network blocks laptop-to-laptop traffic. Use a phone hotspot |
| Worked yesterday, fails today | The host's IP changed. Run `ipconfig` again, update `DB_HOST` and `ERP_URL_*`, restart HR |
| `Access denied for user 'djs_hr'` | Run Step 1.3 again, then check `DB_PASSWORD` |
| Accounting refused HR's key | Copy `ERP_API_KEY_HR` again from the host's root `.env` |
| Payslip stays "Pending" after Mark as Paid | Accounting is not reachable. HR retries every minute, so start Accounting on the host |

**Solo mode** (everything on one laptop): delete HR's `.env` and use `npm run dev` at the ERP root,
as before.
