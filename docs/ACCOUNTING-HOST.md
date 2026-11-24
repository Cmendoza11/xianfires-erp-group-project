# DJ's ERP: Accounting as the Host (gabay para kay CJ)

Ang laptop ni CJ ang **host**. Hawak nito ang MySQL (Laragon) kasama ang 5 databases, at dito tumatakbo ang
**Accounting** (port 3000). Ang 4 na ibang system (POS, HR, Procurement, Customer Logs) ay tumatakbo sa
**sariling laptop** ng mga kagrupo, at kumokonekta sa host gamit ang IP sa iisang Wi-Fi o hotspot.

```
              Iisang Wi-Fi (o phone hotspot)
┌──────────── HOST: laptop ni CJ ────────────┐
│ Laragon MySQL :3306                        │◄── POS laptop   (djs_pos lang)
│   xianfires_erp · djs_pos · djs_hr ·       │◄── HR laptop    (djs_hr lang)
│   djs_procurement · djs_customer_logs      │◄── SCM laptop   (djs_procurement lang)
│ Accounting  http://<IP ni CJ>:3000         │◄── CRM laptop   (djs_customer_logs lang)
│   /api/v1  (journal, bills, payroll ...)   │     + Accounting API gamit ang sariling API key
└────────────────────────────────────────────┘
```

**Paano sila nagkokonekta (para sa panel):**

- **Iisang MySQL server, hiwalay na database bawat module.** Bawat module ay may sariling MySQL account
  (`djs_pos`, `djs_hr`, `djs_scm`, `djs_crm`) na sa **sarili lang nitong database** may access. Kung susubukan
  ng POS na basahin ang Accounting database, `ER_TABLEACCESS_DENIED_ERROR` ang lalabas.
- **Lahat ng papunta sa Accounting ay dumadaan sa API** (`/api/v1`), at may sariling API key ang bawat module.
  Hal. ang POS sale ay nagiging journal entry, ang HR "Mark as Paid" ay nagiging payroll entry, at ang
  supplier invoice ng Procurement ay nagiging bill.
- **Hindi nawawala ang data kapag offline ang isang laptop.** Sine-save muna ng module ang record na may
  status na Pending, at inuulit ang pagpapadala kada 60 segundo hanggang maabot ang Accounting.

## Ngayong gabi (minsan lang, mga 1 minuto)

1. I-double-click ang **`DJs-ERP-Host.bat`** sa repo folder.
2. Kapag nagtanong ang Windows ng permission para sa firewall, i-click ang **Yes**, tapos i-type ang **y**.
   Minsan lang ito. Gagana ang mga rule sa kahit anong Wi-Fi o hotspot, pero para lang sa mga laptop na
   nasa parehong network.
3. Kapag tinanong ang IP ng mga kagrupo, pindutin lang ang Enter (wala pa sila ngayong gabi).
4. Bubukas ang `lan` folder at ang Accounting. Tapos na.

## Bukas, sa defense (5 minuto bago ang oras mo)

1. Isaksak ang charger. Kumonekta kayong lahat sa **iisang Wi-Fi o phone hotspot**.
2. Ipa-type sa bawat kagrupo ang `ipconfig`, at ipabasa ang **IPv4 Address** sa ilalim ng "Wireless LAN adapter Wi-Fi".
3. I-double-click ang **`DJs-ERP-Host.bat`**, at i-type ang IP ng bawat isa kapag tinanong.
   (Kung tumatakbo pa ang Accounting mula kanina, isara muna ang window nito.)
4. **Ipadala nang private** sa bawat kagrupo ang **2 file** niya mula sa bumukas na `lan` folder:
   - `connect-<module>.txt`: ilalagay nila ang laman nito sa `.env` ng system nila, at ire-restart ang app
   - `test-<module>.bat`: ida-double-click nila ito. Dapat **3 na OK** ang lalabas.
   (pos = POS & Inventory, hr = HR, scm = Procurement, crm = Customer Logs)
5. Sa Accounting → **Enterprise Overview**, dapat online ang mga module na nakakonekta na.

## Kapag may problema

| Problema | Ayos |
|---|---|
| May FAIL sa `test-<module>.bat` | Iisang Wi-Fi o hotspot ba kayo? I-double-click ulit ang `DJs-ERP-Host.bat` sa host |
| Gumana kahapon, ayaw ngayon | Nagbago ang IP mo. I-double-click ulit ang `DJs-ERP-Host.bat`, at ipadala ulit ang 2 file |
| School Wi-Fi ay ayaw mag-connect ng laptop sa laptop | Kumonekta lahat sa **iisang phone hotspot**, tapos gawin ulit ang "Bukas" |
| `Access denied` sa MySQL | Luma na ang sheet nila. Ipadala ang bago mula sa `lan/` |
| Lahat bumagsak | Plan B, sa laptop mo lang lahat: `npm run lan -- reset`, tapos `npm run dev` (lahat ng 5 module) |

Ang `lan/` folder ay may mga password at key. **Huwag i-commit at huwag i-post sa group chat na public**;
nasa `.gitignore` na ito.
