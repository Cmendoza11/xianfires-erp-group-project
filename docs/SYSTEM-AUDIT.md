# System audit: DJ's ERP Accounting

Date: 2026-11-17. Scope: `xianfires erp project/` (Accounting module), about 13,000 lines across 21 controllers,
24 services, 20 models, 41 views and 14 page scripts. Reviewed as QA, DevOps and UI/UX.

## Verdict

**Ready for the defense**, after one critical fix made during this audit (self sign-up gave Administrator).
The accounting core and security are solid and tested. The remaining gaps are reliability features that a
production system would have: a database-offline page, persistent sessions, backups, file logs and tests in
the repo.

| Area | Score | Summary |
|---|---|---|
| Accounting correctness | 10/10 | Double-entry enforced, one DB transaction per posting, reversal-only, period lock, TB balanced |
| Security | 9/10 | Critical sign-up hole fixed; 3 moderate npm advisories with low real risk |
| Reliability / DevOps | 8/10 | Database-offline page, real health check and MySQL sessions added; backups and file logs still open |
| QA / testing | 7/10 | Strong end-to-end results, but the test scripts are not in the repo |
| UI / UX | 8/10 | Consistent theme, responsive, modals with confirm; navigation rail is not obvious to new users |

## What was checked and how

| Check | Result |
|---|---|
| Crawl of every admin page as admin (clone database) | 106 pages, 0 errors, 0 server errors |
| Feature end-to-end (vouchers, assets, budgets) | 37 / 37 pass |
| Security end-to-end (lockout, password, rate limit, upload, RBAC, soft delete) | 77 / 77 pass |
| Layout at 1366 px and 390 px (33 pages) | 66 / 66 clean: no sideways scroll, broken images or "undefined" |
| Modals (Add / Edit on 6 pages) | All open, no JavaScript errors |
| Role limits on the live system | Accountant: Users 403. Viewer: Users 403, new journal 403 |
| SQL injection: every `${...}` inside SQL | All are fixed fragments; user input goes through `replacements` |
| XSS: unescaped `{{{ }}}` in views | None |
| Error leakage | Clients get a generic message; details stay in the server log |
| Database offline (simulated, wrong port) | App stays up; login returns 500 "Something went wrong"; health still says ok |
| `npm audit` (production) | 3 moderate: `hbs` (no fix), `uuid` via `sequelize` (fix is a breaking downgrade) |
| Trial balance on the real books | Debit 490,530.97 = Credit 490,530.97 |

## Strengths to mention in the defense

- **Layered code**: routes → controllers (HTTP and audit) → services (all accounting rules) → models.
- **Ledger integrity**: every posting checks debit = credit, runs in one `sequelize.transaction`, locks the
  row on payment, and passes the period lock. Posted entries are never edited; corrections are reversals.
- **Security**: bcrypt hashes, login lockout per email and IP (admin-adjustable), rate limits, strong
  password policy, 30-minute idle session, `httpOnly` + `sameSite` cookie, security headers, JSON-only writes
  (CSRF defence), server-side role checks, upload validation (whitelist, magic bytes, script markers, 2 MB),
  soft delete with Recycle Bin, audit log for every change.
- **Integration**: one database per module, API keys with scopes, a dashboard that survives a module being offline.

## Findings

### Critical (fixed today)

| # | Finding | Fix | Verified |
|---|---|---|---|
| C1 | `ALLOW_SIGNUP=true` and every self sign-up became **Administrator**, so anyone on the Wi-Fi could open `/admin/signup` and take full control | Only the first account ever gets Administrator; later sign-ups get **Viewer** until an admin raises the role (`controllers/authController.js`) | On a clone: new sign-up saved as `viewer` |

### High

H1 and H2 were fixed on 2026-11-17 and verified on a clone (11/11 reliability checks, plus crawl 108 pages,
features 37/37 and security 77/77 again):

- **H1**: `/api/v1/health` now runs `SELECT 1` and answers 503 `{"database":"offline"}` when MySQL is down.
  Connection errors show a **Database is offline** page (or a 503 JSON message) with a Try again button,
  and the server keeps running (`services/databaseHealth.js`, error handler in `index.js`).
- **H2**: sessions are stored in the `admin_session` table (`services/sessionStore.js`,
  `models/AdminSession.js`); users stay logged in across a restart, logout deletes the row, and expired
  rows are pruned every 15 minutes.

| # | Finding | Why it matters | Suggested fix |
|---|---|---|---|
| H1 (fixed) | Database offline gives "Something went wrong" (500), and `/api/v1/health` still answers `ok` | Users and other modules cannot tell that the database is down; the blueprint checklist asks for "Database is offline" | Health check runs `SELECT 1`; error handler shows a "Database is offline" page when the error is a connection error |
| H2 (fixed) | Sessions lived in memory (`express-session` MemoryStore) | Every restart logs everyone out; MemoryStore is documented as not for production | Store sessions in MySQL (a small Sequelize store, no new package) |
| H3 | Test scripts live outside the repo; no `npm test` | Nobody else can re-run the 37 + 77 checks; regressions go unnoticed | Move them into `tests/` and add `npm test` running on a disposable clone |

### Medium

| # | Finding | Suggested fix |
|---|---|---|
| M1 | No backup or restore inside the app; backups are manual `mysqldump` | Admin page with **Backup now** (download `.sql`) and a list of backups |
| M2 | Logs go to the console only; no timestamps or files; no auto-restart after a crash | Write errors to `storage/logs/` with timestamps; run under a restart loop |
| M3 | `ALLOW_SIGNUP=true` is still on | Turn it off for the defense unless walk-in sign-ups are wanted |
| M4 | Three Administrator accounts, two of them old (`admin@vertex.local`, `cj@xianfires.local`) | Delete the old two (they go to the Recycle Bin) |
| M5 | 3 moderate `npm audit` advisories | `hbs`: only a risk if request data is passed straight to `render` (not done here). `uuid`: needs a newer Sequelize; track, do not force |
| M6 | Partials load asynchronously at boot | A request in the first moment after start could fail; load them synchronously before `listen` |

### Low

| # | Finding | Note |
|---|---|---|
| L1 | Plain HTTP on the LAN, so the session cookie is not `Secure` | Acceptable on a private Wi-Fi demo; use HTTPS if ever hosted |
| L2 | New journal entry and new invoice are full pages, not modals | Intentional: multi-line forms need the room. Every other add/edit is a modal |

### UI / UX

| # | Finding | Suggested fix |
|---|---|---|
| U1 | The icon rail switches menu sections, but new users miss it (Customers and Users were hard to find) | Show the section name under each icon, or open the Sales menu by default |
| U2 | Dashboard shows a large net loss on sample data | Add sample sales before the demo, or explain it (see the walkthrough Q&A) |
| U3 | Error when the database is down was generic | Fixed with H1 |
| U4 | Login page right panel is mostly empty space on wide screens | Optional: a short feature list or the module status |

## Recommended order

1. Before the defense: M3 (turn off sign-up) and M4 (remove old admins); 5 minutes, no code.
2. Done: H1 (database offline page and real health check) and H2 (sessions in MySQL).
3. After the defense: H3 (tests in the repo), M1 (backups), M2 (logs), U1 (rail labels).
