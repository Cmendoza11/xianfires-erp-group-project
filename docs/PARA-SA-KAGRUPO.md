# Paano kumonekta sa DJ's ERP host (para sa kagrupo)

Ang host ay ang laptop ni CJ. Doon tumatakbo ang **MySQL (lahat ng database)** at ang **Accounting**.
Sa sarili mong laptop, ang **module mo lang** ang patatakbuhin mo, at ikokonekta mo ito sa host.

| Module | File na matatanggap mo kay CJ | Port mo |
|---|---|---|
| POS & Inventory | `connect-pos.txt` + `test-pos.bat` | 3001 |
| HR | `connect-hr.txt` + `test-hr.bat` | 3002 |
| Procurement | `connect-scm.txt` + `test-scm.bat` | 3003 |
| Customer Logs | `connect-crm.txt` + `test-crm.bat` | 3004 |

## 1. Kumonekta sa parehong Wi-Fi o hotspot ni CJ

Iisang Wi-Fi o iisang phone hotspot dapat kayong lahat. Kapag hinarang ng school Wi-Fi, gumamit kayo ng isang phone hotspot.

## 2. Ibigay ang IP mo kay CJ

Buksan ang PowerShell o Command Prompt at i-type:

```
ipconfig
```

Ibigay kay CJ ang **IPv4 Address** sa ilalim ng "Wireless LAN adapter Wi-Fi" (halimbawa `10.0.0.25`).
Gagawa si CJ ng 2 file para sa iyo at ipapadala niya ang mga ito nang private.

## 3. Subukan ang koneksyon

I-double-click ang **`test-<module>.bat`**. Dapat **3 na OK** ang lalabas:

```
OK    Database (MySQL) reachable on port 3306
OK    Accounting reachable on port 3000
OK    Accounting API answers
```

May FAIL? Basahin ang "Kapag may problema" sa ibaba bago tumuloy.

## 4. Ilagay ang settings sa `.env` mo

Buksan ang `connect-<module>.txt`. Kopyahin ang mga linya mula `DB_HOST=` hanggang `PORT=`, at ilagay
sa `.env` ng system mo. Palitan ang lumang value kapag may kapareho nang pangalan.

**Kung ang group repo ang gamit mo** (iisang folder na may 5 module), isang command lang. Sa root ng repo,
ilagay ang tamang path ng file na ibinigay ni CJ:

```
npm run lan -- import "C:\Users\ikaw\Downloads\connect-hr.txt"
npm run lan -- check
```

Isinusulat ng `import` ang settings sa root `.env` at sa `.env` ng module mo, at hindi ginagalaw ang iba
mong setting. (Puwede ring ang `member.env` ang i-import.)

## 5. I-restart ang system mo

Patayin ang app (Ctrl+C), tapos patakbuhin ulit. Halimbawa sa group repo:

```
npm run dev -- --only=pos
```

(Palitan ang `pos` ng `hr`, `scm` o `crm`.)

Buksan ang module mo sa browser. Sa laptop ni CJ, makikita sa Accounting → **Enterprise Overview**
na **online** na ang module mo.

## Kapag may problema

| Nakikita mo | Gawin |
|---|---|
| FAIL sa port 3306 o 3000 | Magkaiba ang Wi-Fi ninyo, o hinaharang ng network. Lumipat kayong lahat sa iisang hotspot, at ipa-double-click kay CJ ulit ang `DJs-ERP-Host.bat`. |
| `Access denied for user` | Mali ang DB_USER o DB_PASSWORD. Kopyahin ulit nang buo mula sa connect file, walang dagdag na space. |
| `Unknown database` | Mali ang DB_NAME. Gamitin ang nakasulat sa connect file. |
| Gumana kanina, ayaw na ngayon | Nagbago ang IP ni CJ. Kunin ulit kay CJ ang bagong connect file. |
| Offline ang module sa Enterprise Overview | Hindi pa naibibigay kay CJ ang IP mo, o hindi pa na-restart ang app mo pagkatapos palitan ang `.env`. |

**Huwag i-post sa group chat ang connect file.** May password at API key ito.
