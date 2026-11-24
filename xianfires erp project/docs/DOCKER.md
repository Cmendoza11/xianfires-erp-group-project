# Accounting sa Docker (containerization at deployment)

Ang Accounting ng DJ's ERP ay naka-**containerize**: dalawang container na sabay tumatakbo, at
isang command lang ang kailangan.

| Container | Image | Ginagawa |
|---|---|---|
| `accounting` | `djs-erp-accounting` (galing sa `Dockerfile`) | Ang Accounting app (Node 20, port 3000 sa loob) |
| `db` | `mysql:8.4` | Sariling MySQL ng Accounting, database `xianfires_erp` |

Mga file (nasa folder na ito, `xianfires erp project/`):

| File | Para saan |
|---|---|
| `Dockerfile` | Paano binubuo ang image: Node 20, `npm ci`, mysql client para sa Backup, tumatakbo bilang `node` (hindi root), may HEALTHCHECK |
| `docker-compose.yml` | Ang dalawang service, ang network, ang mga volume, ang ports at ang settings |
| `docker/entrypoint.sh` | Sa pag-start: hinihintay ang MySQL, gumagawa ng mga table (migrate), gumagawa ng unang admin, tapos pinapatakbo ang app |
| `.dockerignore` | Hindi isinasama sa image ang `.env`, `node_modules`, `storage` at tests |
| `tests/docker.mjs` | Awtomatikong check ng tumatakbong containers (19 check) |

## Paano patakbuhin

Kailangan: **Docker Desktop** na naka-on.

```bash
cd "xianfires erp project"
docker compose up -d --build
```

Unang beses: ilang minuto (dina-download ang Node at MySQL). Pagkatapos:

```bash
docker compose ps
```

Dapat **`healthy`** ang dalawa. Buksan ang **http://localhost:3000**.

- Login: `admin@djs.local` / `DjsErp#2026` (default ng demo; **palitan pagkatapos mag-login**)
- Kapag ginagamit na ng Laragon Accounting ang port 3000, gumamit ng ibang port:
  `DOCKER_APP_PORT=3080 docker compose up -d --build` (PowerShell: `$env:DOCKER_APP_PORT=3080; docker compose up -d --build`)
- Nasa port **3307** ang MySQL ng Docker sa laptop, kaya hindi ito bumabangga sa Laragon (3306).

| Command | Ginagawa |
|---|---|
| `docker compose up -d --build` | Build at start (o `npm run docker:up`) |
| `docker compose ps` | Lagay ng mga container |
| `docker compose logs -f accounting` | Live na log ng app |
| `docker compose restart accounting` | I-restart ang app (hindi nalo-logout ang users) |
| `docker compose down` | Ihinto (naiiwan ang data sa volumes) (o `npm run docker:down`) |
| `docker compose down -v` | Ihinto **at burahin** ang database at mga file |
| `node tests/docker.mjs http://localhost:3000` | Check ng containers (o `npm run test:docker`) |

## Ano ang ipapakita sa defense (mga 3 minuto)

1. `docker compose ps`: **2 container, parehong healthy**.
   > "Dalawang container po: ang app at ang sariling MySQL. May health check ang bawat isa;
   > 'healthy' lang kapag sumasagot ang app at online ang database."
2. Buksan ang http://localhost:3000, mag-login, at magpakita ng isang page (Trial Balance).
3. `docker compose restart accounting`, tapos i-refresh ang page: **naka-login pa rin**.
   > "Naka-save po sa MySQL ang sessions, kaya hindi nalo-logout kahit i-restart ang container."
4. `docker compose stop db`, tapos i-refresh: lalabas ang **"Database is offline"**, at hindi bumabagsak ang app.
   `docker compose start db`, tapos **Try again**: bumalik na.
   > "Naka-`restart: unless-stopped` po ang mga container, kaya kusa silang bumabangon kapag nag-crash."
5. Admin → **Backup and Restore** → **Back up now**: gumagana ang backup sa loob ng container.
6. `node tests/docker.mjs http://localhost:3000`: **19 passed, 0 failed**.

## Para magsimula sa totoong data (opsyonal)

Bago ang **unang** `docker compose up`, i-dump ang Laragon database papunta sa `docker/initdb/`:

```bash
mysqldump -uroot xianfires_erp > docker/initdb/01-xianfires_erp.sql
```

Isang beses lang itong ilo-load ng MySQL container, sa unang paggawa ng database. Para ulitin:
`docker compose down -v`, tapos `docker compose up -d --build`.
Hindi kino-commit ang `.sql` dito (may totoong data).

## Settings

Lahat ay may default para sa demo. Para palitan, gumawa ng `.env.docker` (hindi kino-commit):

```
DOCKER_DB_ROOT_PASSWORD=ibang-password
DOCKER_SESSION_SECRET=mahabang-random-na-text
DOCKER_ADMIN_EMAIL=admin@djs.local
DOCKER_ADMIN_PASSWORD=Ibang#Password2026
DOCKER_APP_PORT=3000
```

```bash
docker compose --env-file .env.docker up -d --build
```

Para makonekta sa ibang module ng DJ's ERP: idagdag sa `.env.docker` ang `ERP_URL_POS`, `ERP_URL_HR`,
`ERP_URL_SCM`, `ERP_URL_CRM` at `ERP_INTERNAL_KEY` (pareho sa `connect-*.txt`).

## Napatunayan (2026-11-24)

`tests/docker.mjs`, **19/19**:
- parehong healthy ang containers
- naka-login ang admin, at bukas ang mga page
- nag-post ng balanced na entry, at tinanggihan ang hindi balanced
- gumagana ang backup at restore sa loob ng container
- naka-login pa rin pagkatapos ng restart
- "Database is offline" (503) kapag patay ang MySQL, at kusang bumabalik pag-on nito
