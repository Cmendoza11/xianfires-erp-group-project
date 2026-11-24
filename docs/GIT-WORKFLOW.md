# Git workflow ng DJ's ERP

Repository: https://github.com/Cmendoza11/xianfires-erp-group-project

Iisang repository ang 5 module. May sariling folder at may-ari ang bawat module, at dumadaan sa
**branch → pull request → review → merge** ang bawat pagbabago.

| Module | Folder | May-ari (GitHub) |
|---|---|---|
| Accounting (hub) | `xianfires erp project/` | Cmendoza11 (CJ) |
| HR | `DJs-Human-Resource-Management-main/` | keiilo |
| POS & Inventory | `PointOfSales-main/PointOfSales-main/` | REACT |
| Procurement | `eventdriven_selda-main/eventdriven_selda-main/` | (Procurement member) |
| Customer Logs | `Dj-s-Customer-Logs-main/Dj-s-Customer-Logs-main/` | Lhey |
| Root scripts, LAN, docs | `scripts/`, `docs/`, root files | CJ (host) |

## 1. Mga branch

| Branch | Para saan | Patakaran |
|---|---|---|
| `main` | Ang gumaganang system na ide-demo | **Walang direktang push.** Pumapasok lang dito sa pull request |
| `feature/<module>-<paksa>` | Bagong feature o ayos | Hal. `feature/hr-withholding-tax`, `feature/pos-promo-fix` |
| `fix/<module>-<paksa>` | Mabilisang ayos ng bug | Hal. `fix/scm-po-numbering` |
| `accounting-finalize-2026-11-24` | Ang malaking update ng Accounting, LAN tools at Docker | Na-merge sa `main` sa PR (tingnan ang Merge log) |

## 2. Ang daloy (bawat pagbabago)

```bash
git switch main
git pull                                   # kunin ang pinakabago
git switch -c feature/hr-withholding-tax   # sariling branch
# ... gumawa ng pagbabago SA SARILING MODULE FOLDER LANG ...
npm run check                              # walang syntax error
git add DJs-Human-Resource-Management-main
git commit -m "HR: withholding tax on payroll (BIR table)"
git push -u origin feature/hr-withholding-tax
```

Pagkatapos, sa GitHub: **Compare & pull request** papuntang `main`. Sagutan ang template.
Kusang tatakbo ang **CI**: syntax check ng 5 module at build ng Accounting Docker image.
Kapag **berde** at na-review na, ang may-ari ng repo ang magme-merge.

### Commit messages

`<Module>: <ano ang ginawa>`, maikli at malinaw, isang paksa bawat commit:

- `Accounting: release salary from approved HR payroll`
- `HR: themed modals for edit/review/manage`
- `POS: promo code validation at checkout`

Huwag: `update`, `fix`, `asdf`, o pagsasama ng maraming walang kaugnayang pagbabago.

### Huwag i-commit kailanman

`.env`, `.env.*` (maliban sa `.env.example`), `lan/`, `node_modules/`, `storage/`, database dumps
(`*.sql`) at `TEST-ACCOUNTS.local.txt`. Hinaharangan na ito ng `.gitignore`.

## 3. Pag-merge

- **Merge commit** ang gamit (hindi squash), para kita sa history kung kailan at mula saang branch
  pumasok ang bawat pagbabago.
- Bago mag-merge: `git merge origin/main` sa feature branch, ayusin ang conflict, i-test, i-push.
- Pagkatapos mag-merge: puwedeng burahin ang feature branch sa GitHub.

## 4. Kapag may conflict

1. `git fetch origin` at `git merge origin/main` sa feature branch mo.
2. `git status`. Ang mga file na "both modified" ang may conflict.
3. Buksan ang bawat file at hanapin ang `<<<<<<<`, `=======` at `>>>>>>>`. Panatilihin ang tamang code
   mula sa **dalawang** panig; huwag basta burahin ang sa iba.
4. Kapag hindi sigurado kung kanino ang tama, **tanungin ang may-ari ng module** bago magpasya.
5. `npm run check`, patakbuhin ang module, at subukan ang binagong feature.
6. `git add <file>`, `git commit` (ipaliwanag sa message kung paano inayos), `git push`.

**Totoong halimbawa (2026-11-24):** ang `accounting-finalize-2026-11-24` ay may HR at POS na
natanggap sa labas ng git, habang may 12 commit na ang `main` mula kay keiilo (HR), REACT (POS) at
Lhey (Customer Logs). Nagkaroon ng **37 conflict** sa HR at POS. Para hindi mapatungan ang trabahong
naka-commit na ng mga may-ari, kinuha nang buo ang bersyon ng `main` para sa dalawang folder
(merge commit `9032272`). Sa hiwalay na commit (`1d1c885`), ibinalik ang tanging pagbabagong
kailangan ng Accounting, ang salary release API sa HR, at sinubukan ito (payroll suite 28/28).
Ang mga lokal na bersyon ng mga may-ari ay papasok sa sarili nilang `feature/` branch at PR.

## 5. Para sa mga kagrupo: i-push ang pinakabago ninyong code

Kung may mga pagbabago kayo sa laptop na **wala pa sa GitHub**:

```bash
cd xianfires-erp-group-project          # ang group repo sa laptop mo
git status                              # tingnan kung ano ang nabago
git switch -c feature/hr-latest         # (pos / scm / crm)
git add DJs-Human-Resource-Management-main    # SARILING module folder lang
git commit -m "HR: <buod ng mga pagbabago>"
git fetch origin
git merge origin/main                   # ayusin ang conflict kung mayroon (seksyon 4)
git push -u origin feature/hr-latest
```

Pagkatapos: sa GitHub, **Compare & pull request** → base `main`. Sasabihan ninyo si CJ para ma-review at ma-merge.

Kung ang code ninyo ay **wala sa git** (hiwalay na folder): i-clone muna ang repo, gumawa ng branch,
kopyahin ang module folder ninyo **pumapalit** sa nasa repo, tapos `git add`, `commit` at `push`
tulad ng nasa itaas.

## 6. Merge log

| Petsa | Merge | Mula → Papunta | Conflicts | Paano inayos |
|---|---|---|---|---|
| 2026-11-24 | `9032272` | `main` → `accounting-finalize-2026-11-24` | 37 (HR, POS) | Kinuha ang naka-commit na HR at POS ng mga may-ari; pumasok nang malinis ang Customer Logs |
| 2026-11-24 | `1d1c885` | (commit) | n/a | Ibinalik ang salary release API sa HR; payroll suite 28/28 |
| 2026-11-24 | PR #PR_NUMBER | `accounting-finalize-2026-11-24` → `main` | wala (naayos na sa itaas) | Merge commit; pumasa ang CI |

## 7. Mga kontribyutor

Tingnan sa GitHub: **Insights → Contributors**, o sa terminal:

```bash
git shortlog -sne --all
```
