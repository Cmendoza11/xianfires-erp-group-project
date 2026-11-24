# Defense walkthrough: Accounting (DJ's ERP)

Script for presenting the Accounting module, about 10 to 12 minutes. Each step gives what to click,
then what to say (in quotes).

## Before the defense (15 minutes early)

- [ ] Charger plugged in, every laptop on the same Wi-Fi or hotspot
- [ ] Double-click `DJs-ERP-Host.bat`, type the teammates' IPs, and send each one their 2 files
- [ ] Every teammate's `test-<module>.bat` shows 3 OK
- [ ] Open `http://10.0.0.114:3000/admin` (or your current IP), log in, and check that **Enterprise Overview** shows the modules online
- [ ] Keep a second tab on **Trial Balance** for quick proof that the books balance

## 1. Introduction (30 seconds)

> "Ako po si CJ Mendoza. Hawak ko po ang **Accounting module** ng DJ's ERP, ang ERP ng DJ's FoodHub.
> Ang Accounting po ang **hub**: dito napupunta ang benta ng POS, ang bills ng Procurement, at ang payroll
> ng HR bilang journal entries, para nasa iisang libro ang lahat ng pera ng negosyo."

## 2. Architecture and network (1 minute)

Open **Enterprise Overview**.

> "Lima po ang module, at **may sariling database ang bawat isa**. Hindi sila direktang nagbabasa ng
> database ng iba. Nag-uusap sila sa pamamagitan ng **API na may API key**. Ang laptop ko po ang host:
> nandito ang MySQL at ang Accounting. Ang ibang module ay tumatakbo sa laptop ng mga kagrupo ko at
> kumokonekta dito sa Wi-Fi."

If a module is offline, point at the message:
> "Kapag offline ang isang module, hindi po bumabagsak ang Accounting. Ipinapakita lang nito na hindi
> maabot ang module, at kapag bumalik ito, sasabay na ulit ang data."

## 3. Login and security (2 minutes)

1. Log out. Type a wrong password **3 times**: it shows the attempts left, then locks for 1 minute with a countdown.
> "May **login lockout** po: 3 maling subok, maghihintay ng 1 minuto. Puwede itong baguhin ng admin."
2. Log in. Open **Settings → Security** and show attempts, lockout minutes and session timeout.
> "Naka-**session** po ang system: kapag 30 minutong walang galaw, automatic na logout."
3. Open **Users → Add user**, type a weak password such as `abc123`.
> "**Strong password** po ang kailangan: 8 characters o higit, may malaki at maliit na letra, numero at symbol.
> May **format validation** din ang email, pangalan, at code ng account."
4. Mention briefly:
> "May **rate limiting** po sa login at sa API, kaya hindi puwedeng i-brute-force. May **role-based
> access**: admin, accountant at viewer. Ang viewer ay hindi makakapag-edit, at server ang nagbabawal,
> hindi lang ang button."

## 4. Chart of accounts and soft delete (1 minute)

Open **Chart of Accounts**, click **Add account** (modal), then Cancel. Delete an unused test account, and open **Recycle Bin**.
> "Lahat po ng form ay **modal**, may **confirm** bago i-save, at **result** pagkatapos.
> **Soft delete** po ang gamit: hindi agad nabubura. Napupunta ito sa Recycle Bin at puwedeng i-restore."

## 5. Journal entry: double-entry (2 minutes)

Open **Journal Entries → New**. Example: Rent Expense debit ₱5,000, Cash credit ₱5,000. Save.
> "Double-entry po: dapat **pantay ang debit at credit**, kung hindi, ayaw i-save ng system."

Try saving with unequal amounts to show the error. Then open the saved entry and click **Reverse**.
> "Ang naka-post na entry ay **hindi binubura o ine-edit**. Kapag may mali, **reversal entry** ang
> ginagawa, para kumpleto ang audit trail. Ganyan po ang tamang accounting."

## 6. Sales, purchases and expenses (2 minutes)

- **Sales Invoices**: open one.
> "Kapag nag-invoice, automatic na Accounts Receivable at Sales. Kapag binayaran, Cash na."
- **Bills**: open one that came from Procurement.
> "Ito po ay galing sa Procurement, ipinasa sa API. Hindi na mano-manong ini-encode."
- **Expense Vouchers → New voucher**: attach a receipt image.
> "Ang **resibo** po ay may upload validation: larawan o PDF lang, 2 MB pababa, at sinusuri ang laman ng
> file, hindi lang ang pangalan, para hindi makapag-upload ng PHP shell o script."
- **Fixed Assets**: open one, show the monthly depreciation.
> "Straight-line depreciation po ito, buwan-buwan, automatic na naka-post sa libro."
- **Payroll → Release salary**: pick an approved payslip, choose the payment date and Cash in Bank, confirm.
> "Ang HR po ang nagkukuwenta ng payroll mula sa DTR, kasama ang SSS, PhilHealth at Pag-IBIG, at nag-a-approve.
> Ang Accounting po ang nagpapasweldo: pag-click ng Release salary, naka-post ang Dr Salaries Expense, Cr
> Government payables, Cr Cash, at kusang nagiging Paid ang payroll sa HR. Hindi na puwedeng i-Paid ng HR
> mismo, kaya hiwalay ang nag-a-approve at ang nagbabayad (segregation of duties)."

## 7. Reports (2 minutes)

Open in this order:
1. **Trial Balance**: "Pantay po ang total debit at credit, kaya balanced ang libro."
2. **Income Statement**: "Kita at gastos sa napiling petsa."
3. **Balance Sheet**: "Assets = Liabilities + Equity."
4. **Budget vs Actual**: "Pinaghahambing po ang budget at aktwal na gastos bawat account."
5. **General Ledger**, **AR/AP Aging**, **VAT Summary**: mention only.

Click **Print** on one report.

## 8. Controls (1 minute)

- **Period Closing**: "Kapag na-lock po ang isang buwan, wala nang makakapag-post sa petsang iyon."
- **Bank Reconciliation**: "Itinutugma po ang libro sa bank statement."
- **Audit Log**: "Bawat galaw ay naka-record: sino, ano at kailan."

## Likely questions

| Question | Answer |
|---|---|
| Bakit hiwalay ang database ng bawat module? | Para independent ang bawat isa: kapag may problema ang isa, hindi damay ang iba. Nag-uusap sila sa API na may key, kaya kontrolado kung ano ang puwedeng gawin ng bawat module. |
| Bakit hindi puwedeng i-delete ang journal entry? | Sa accounting, hindi binubura ang naka-post. Reversal ang ginagamit para may audit trail. |
| Paano kung sabay mag-post ang dalawang tao? | Isang database transaction ang bawat posting, at may row lock sa balance, kaya walang dobleng bayad. |
| Paano kung offline ang isang module? | Naka-outbox at retry ang mga module: itinatabi ang data, at ipinapadala kapag bumalik ang koneksyon. |
| Bakit may net loss sa Dashboard? | Sample data ito: naka-post na ang gastos tulad ng payroll, pero kaunti pa lang ang sample na benta. Kapag dumami ang benta ng POS, tataas ang revenue. |
| Paano pinoprotektahan ang password? | Naka-hash gamit ang bcrypt. Hindi naka-store ang totoong password. |
| Ano ang pumipigil sa SQL injection? | Gumagamit ng Sequelize at parameterized queries (replacements), kaya hindi naipapasok ang SQL sa input. |
| Ano ang pumipigil sa CSRF? | JSON-only ang mga write request mula sa session, at may security headers ang bawat page. |
