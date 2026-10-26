# MaliREN  website, administration and API

Réseau National d’Éducation et de Recherche du Mali. This repository contains

| Folder | What it is |
|---|---|
| `frontend/` | React 19 + TypeScript + Vite single-page site: public pages (FR/EN) and the administration area. The approved prototype design is preserved. |
| `backend/` | Node.js 22 + Express 5 + TypeScript REST API (`/api/v1`), PostgreSQL via Drizzle ORM, background worker, OpenAPI/Swagger. |
| `docker-compose.yml` | Full stack: PostgreSQL, API, worker, nginx frontend, Mailpit (mail catcher). |
| `docker-compose.dev.yml` | Only PostgreSQL + Mailpit, for running API/frontend with `npm` on your machine. |
| `e2e/` | Real-browser smoke test (Playwright). |
| `scripts/init-env.mjs` | Creates `.env` with random secrets. |

---------------------------------------------------------------------------------------------------

## 1. Quick start with Docker (recommended)

**Prerequisites**

* **macOS**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or `brew install --cask docker`) and [Node.js 22 LTS](https://nodejs.org) (only used to generate secrets; `brew install node@22`).
* **Windows 10/11**: Docker Desktop with the WSL 2 backend enabled, and Node.js 22 LTS (`winget install OpenJS.NodeJS.LTS`). Use PowerShell or Windows Terminal.
* Git (optional – you can also just unzip the archive).

```bash
# 1. open a terminal in the project folder (the one containing docker-compose.yml)
node scripts/init-env.mjs            # creates .env with random POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build            # first build takes a few minutes
```

No Node on the machine? Copy `.env.example` to `.env` (`cp` on macOS, `Copy-Item .env.example .env` on Windows) and fill
`POSTGRES_PASSWORD` and `JWT_SECRET` with long random strings (PowerShell: `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`).

Wait until the log shows `MaliREN API listening` and the `seed` service has exited with code 0. The first start creates
the schema (migrations), loads the prototype content (flagged *demo*) and the demo accounts.

| What | URL |
|---|---|
| **Public website** | http://localhost:8080 |
| **Administration** | http://localhost:8080/admin/login |
| **API docs (Swagger UI)** | http://localhost:4000/docs  (also http://localhost:8080/docs/) |
| OpenAPI JSON | http://localhost:4000/api/v1/openapi.json |
| API health | http://localhost:4000/health |
| Mail catcher (all e-mails the system sends) | http://localhost:8025 |

Stop with `Ctrl+C` (or `docker compose down`; add `-v` to also **delete** the database and uploads).

### Demo credentials (demo data only)

Created when `ALLOW_DEMO_SEED=true` (the default in `.env.example` for local use) or when running outside production.
Password for all four: **`Maliren#Demo2026`** (change `DEMO_PASSWORD` before seeding to use another).

| Email | Role | Can do |
|---|---|---|
| `admin@maliren.ml` | Super administrateur | everything, including running/configuring automations |
| `manager@maliren.ml` | Administrateur | content, submissions, media, users (below own rank), settings, reports, audit log |
| `editor@maliren.ml` | Éditeur | create/edit/publish content, triage submissions, upload media |
| `reviewer@maliren.ml` | Lecture seule | read-only access to content, submissions, media, reports |

> **Never use demo accounts in production.** Set `ALLOW_DEMO_SEED=false` and create your real first administrator with
> `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (≥ 12 characters; you must change it at first login).

---------------------------------------------------------------------------------------------------

## 2. Local development without Docker for the app

**Prerequisites:** Node.js 22 LTS, npm 10+, and PostgreSQL 14+ (any of: Docker, Homebrew `brew install postgresql@16`,
the Windows installer from postgresql.org). The easiest database is the bundled dev compose file (Postgres + Mailpit):

```bash
docker compose -f docker-compose.dev.yml up -d        # postgres on 127.0.0.1:5432 (maliren/maliren), db maliren + maliren_test
```

Own PostgreSQL instead? Create the role/databases once:
`CREATE ROLE maliren LOGIN PASSWORD 'maliren' CREATEDB; CREATE DATABASE maliren OWNER maliren; CREATE DATABASE maliren_test OWNER maliren;`
or change `DATABASE_URL` in `backend/.env`.

**API (terminal 1)**

```bash
cd backend
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
npm install
npm run db:migrate              # apply versioned SQL migrations (migrations/)
npm run db:seed                 # prototype content (flagged demo) + demo users
npm run dev                     # http://localhost:4000  (worker embedded: EMBEDDED_WORKER=true)
```

**Frontend (terminal 2)**

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173   /api is proxied to http://localhost:4000
```

Open http://localhost:5173 (site) and http://localhost:5173/admin/login (admin). Swagger UI: http://localhost:4000/docs.

Useful commands (all in `backend/`):

| Command | Purpose |
|---|---|
| `npm test` | 65 automated tests against the test database (`TEST_DATABASE_URL`, default `…/maliren_test`  its schema is **dropped and recreated**) |
| `npm run typecheck` / `npm run build` | type-check / compile to `dist/` |
| `npm run db:generate` | create a new migration after editing `src/db/schema.ts` (commit the generated SQL) |
| `npm run db:migrate` · `db:seed` · `db:reset -- --yes` | apply migrations · load demo data (idempotent) · **drop everything**, re-migrate (dev only; refuses in production) |
| `npm run automation:run -- <name> [--dry-run] [--now=ISO]` | run an automation immediately (see §5) |

Frontend: `npm run build` (production bundle), `npm run typecheck`.

---------------------------------------------------------------------------------------------------

## 3. Architecture in one page

```
Browser ── nginx (web:80) ──/api/*──► Express API ──► PostgreSQL ◄── Worker (jobs + schedules)
   │            └─ static SPA                │  └─► uploads volume (media files)       │
   └──────────── (dev: Vite proxy) ─────────┘                                         └─► SMTP / Mailpit
```

* **Auth** – `POST /auth/login` returns a 15-minute JWT access token (kept **in memory** by the SPA) and sets a 7-day
  opaque **refresh token** as an `httpOnly` cookie scoped to `/api/v1/auth`. Refresh tokens are rotated on every use, stored
  only as SHA-256 hashes, and re-use of a rotated token revokes the whole session family. Every request re-checks the
  user and session in the database, so deactivation, role changes and logout take effect immediately. Passwords use
  scrypt (N=32768, r=8, p=3) with per-user salts; accounts lock for 15 min after 5 failures; login and the public form are
  rate-limited; the refresh/logout endpoints require an allowed `Origin` and an `X-Requested-With` header (CSRF).
* **Authorization** – server-side permission matrix (`backend/src/auth/rbac.ts`); the UI only hides what the server would refuse.
* **Data** – PostgreSQL, migrations in `backend/migrations/`. Tables: `users`, `sessions`, `pages`, `news`, `events`,
  `publications`, `institutions`, `submissions`, `submission_notes`, `media`, `settings`, `notifications`, `audit_log`,
  `jobs`, `automation_schedules`, `email_log`, `reports`.
* **Content workflow** – news/events/publications/pages: `draft → published | scheduled → archived` (invalid transitions
  are rejected, scheduled items publish themselves). Institutions: `pending / active / inactive`.
* **Public site** – reads only *published* content through `/api/v1/public/*`. Events are split into upcoming/past from their
  dates. French is the base language; English fields are optional and the UI falls back to French per field.
* **OpenAPI** – generated from the same Zod schemas that validate requests (`/docs`, `/api/v1/openapi.json`).

Everything under `/api/v1/admin/*` requires a bearer token **and** the specific permission. All writes are recorded in
`audit_log` (actor, action, entity, before/after for edits) and shown in *Administration → Activité*.

---------------------------------------------------------------------------------------------------

## 4. Admin modules

Tableau de bord (metrics computed from live data) · Contenus (editable pages, e.g. legal notices) · Actualités ·
Événements · Publications · Institutions (pilot sites / members / partners) · Demandes (triage: status, assignment,
follow-up date, internal notes, CSV export) · Médiathèque (upload, alt text, temporary uploads, delete) · Utilisateurs
(invite with one-time password, roles, activate/deactivate, reset) · Rapports (period statistics, CSV exports, saved
reports) · Activité (audit log, background jobs, e-mail log) · Paramètres (site contacts, notification recipients,
automations, integration placeholders). The bell shows in-app notifications. Destructive actions ask for confirmation.

---------------------------------------------------------------------------------------------------

## 5. Automations

A **Postgres-backed durable job queue** (`jobs` table, `FOR UPDATE SKIP LOCKED`, exponential backoff 30 s → 1 h, max
attempts, dead-letter status, stuck-job recovery) plus a **scheduler** (`automation_schedules`) run in the worker.
Everything is visible in *Administration → Activité → Tâches automatiques / E-mails* and configurable in
*Paramètres → Automatisations* (super administrator).

| Automation | Default | What it does | Anti-spam guarantees |
|---|---|---|---|
| New contact request (event-driven) | on | In-app notification to active admins/editors + one e-mail per recipient | job + e-mail dedupe keys per submission/recipient; retries never re-send to recipients already mailed. Disable: Paramètres → Notifications → “Notifier à chaque nouvelle demande”. |
| `unhandled_submission_reminder` | **on**, hourly check | Requests still *new* after 48 h (or *in progress* with a past follow-up date) → **one** summary e-mail per recipient | at most one reminder mail per recipient per day; ≥ 24 h between reminders for a request; max 3 reminders per request; stops when handled |
| `upcoming_reminder` | **on**, daily 08:00 UTC | Published events starting within 7 days, content scheduled within 48 h | each item reminded once (`reminder_sent_at`); one mail per recipient per day |
| `publish_scheduled` | **on**, every minute | Publishes scheduled content when due | idempotent status update; audit entry by `system` |
| `digest` | **off** | Daily or weekly report saved in *Rapports* and e-mailed | one per period; dedupe per recipient and day |
| `cleanup` | **on**, daily 03:00 UTC | Deletes expired temporary uploads (row + file), old sessions, finished jobs > 30 d, read notifications > 90 d | – |

* **Disable one**: toggle it off in Paramètres → Automatisations. **Disable all**: `AUTOMATIONS_ENABLED=false`.
* After downtime a schedule runs **once**, not once per missed slot.
* **E-mail**: `MAIL_MODE=log` (default for `npm run dev`) writes e-mails to the log and *Activité → E-mails*  nothing is sent.
  `MAIL_MODE=smtp` + `SMTP_*` sends for real (Docker Compose defaults to the bundled Mailpit inbox at http://localhost:8025).

**Try it locally (about 2 minutes)**

1. Open http://localhost:5173/contact (or :8080), send a message.
2. Within ~5 s: the bell in the admin shows “Nouvelle demande”, and *Activité → E-mails* lists one e-mail per recipient
   (in Docker also visible in Mailpit).
3. Simulate three days passing and **preview** the reminder without sending anything:
   ```bash
   cd backend
   npm run automation:run -- unhandled_submission_reminder --dry-run --now=2030-01-01T09:00:00Z   # use a date ≥ 3 days after your message
   npm run automation:run -- unhandled_submission_reminder --now=2030-01-01T09:00:00Z             # sends once
   npm run automation:run -- unhandled_submission_reminder --now=2030-01-01T09:00:00Z             # same day again → nothing sent
   ```
   In Docker: `docker compose exec api node dist/src/automation/cli.js unhandled_submission_reminder --dry-run`.
   Other names: `publish_scheduled`, `upcoming_reminder`, `digest`, `cleanup`, or `all`. The admin UI has the same “Simuler (dry-run)” / “Exécuter maintenant” buttons.

---------------------------------------------------------------------------------------------------

## 6. Tests

```bash
cd backend && npm test            # 65 tests: auth/sessions, RBAC, contact form, CRUD, status workflow, audit, media security, automations
```

Browser E2E (optional, see `e2e/README.md`): `python3 e2e/smoke.py`  24 steps through the real UI.

---------------------------------------------------------------------------------------------------

## 7. Backup, restore, reset

```bash
# Docker stack
docker compose exec -T db pg_dump -U maliren -d maliren -Fc > maliren-$(date +%F).dump            # database backup
docker compose exec -T db pg_restore -U maliren -d maliren --clean --if-exists < maliren-YYYY-MM-DD.dump
docker run --rm -v maliren_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads.tgz -C /data .   # uploads backup
docker compose down -v            # DESTROYS database + uploads (fresh start); then: docker compose up --build

# Local development
cd backend && npm run db:reset -- --yes && npm run db:seed
```

(Windows PowerShell: replace `$(date +%F)` with a literal date and `"$PWD"` with `${PWD}`; use `cmd /c` or a `.dump` file name without redirection issues  or run `pg_dump` inside the container to a file and `docker cp` it out.)

---------------------------------------------------------------------------------------------------

## 8. Production notes (read before going live)

1. **Secrets**: generate a unique `JWT_SECRET` (the API refuses the default in production) and database password; never commit `.env`.
2. **HTTPS is mandatory.** Terminate TLS in front of nginx (or add it to the nginx container), then set `COOKIE_SECURE=true`,
   `CORS_ORIGINS`/`PUBLIC_SITE_URL` to the real https origin, `TRUST_PROXY` to the number of proxies, and add HSTS + a tuned CSP at the proxy.
3. **No demo accounts**: `ALLOW_DEMO_SEED=false`; bootstrap with `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`; remove the Mailpit service and configure real SMTP.
4. Demo/prototype records are flagged and shown with a notice until an editor saves them; the legal pages are **placeholders that must be replaced by validated texts**.
5. Do not publish the database port; back up `pgdata` and `uploads` regularly (§7).
6. Split-domain deployment (SPA and API on different *sites*): `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true`, and build the frontend with `VITE_API_BASE_URL=https://api.example.org/api/v1`.
7. `frontend/public`/Figma config currently emits a `robots.txt` that **disallows indexing** (from `frontend/.figma/make/site.json`)  change it for launch.
8. Run `npm audit` periodically; pin and update the Docker base images.

Security controls implemented: scrypt password hashing; rotated hashed refresh tokens; immediate session revocation; lockout + rate limiting;
Helmet headers; strict CORS allow-list; request validation (Zod) with body-size limits; parameterised queries only; LIKE-wildcard escaping;
plain-text content rendering (no `dangerouslySetInnerHTML`); upload validation by magic bytes (SVG/HTML/executables rejected), random server-side names,
`nosniff` + sandbox CSP on served files; CSV formula-injection neutralisation; honeypot on the public form; audit log; last-super-admin and self-lockout protection.

---------------------------------------------------------------------------------------------------

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `POSTGRES_PASSWORD`/`JWT_SECRET` error from compose | run `node scripts/init-env.mjs` (or fill `.env`) |
| Port 8080/4000/5432 already in use | set `WEB_PORT` in `.env`; stop the other program; for dev DB change the left side of `ports:` |
| Admin login works then you are logged out on refresh (Safari / http) | Safari rejects `Secure` cookies over http  keep `COOKIE_SECURE=false` for local http, `true` on https |
| “Origin not allowed” on refresh/logout | add the exact browser origin (scheme+host+port) to `CORS_ORIGINS` |
| API exits with “Invalid environment configuration” | read the listed variables; compare with `.env.example` |
| `npm test` cannot connect | start the dev DB (`docker compose -f docker-compose.dev.yml up -d`) or set `TEST_DATABASE_URL` |
| Login says “Trop de tentatives” | rate limit/lockout (15 min); lower it locally via `LOGIN_RATE_LIMIT_MAX`, `MAX_FAILED_LOGINS` |
| No e-mails arrive | `MAIL_MODE=log` only logs (see *Activité → E-mails*); with Docker open Mailpit on :8025; for SMTP check *Activité → E-mails* for the error |
| Migration conflict after pulling | `npm run db:migrate`; in dev only, `npm run db:reset -- --yes` |
| Windows: `docker compose` cannot find files | run it from the folder containing `docker-compose.yml`; ensure Docker Desktop uses WSL 2 |
| Blank site / “service indisponible” | the API is not reachable: check `docker compose ps` / `docker compose logs api`; in dev start the API first |

---------------------------------------------------------------------------------------------------

## 10. Design decisions and known limitations

* **Drizzle ORM instead of Prisma**: Drizzle generates plain SQL migrations, has no binary engine to download (important for locked-down
  networks and Alpine images) and let the whole suite run against real PostgreSQL. It is a mature, typed ORM; the SQL in `migrations/` is the source of truth.
* **Postgres-backed queue instead of BullMQ + Redis**: one fewer service to run and back up, durable by construction, and multiple workers are safe.
  If volume ever outgrows it, the `enqueue`/`claimNext` interface in `services/jobs.ts` is the only place to swap.
* **Not verified here**: the Dockerfiles/compose file could not be executed in the environment where this was built (no Docker daemon).
  Every step they perform was reproduced manually (clean `npm ci`, build, prune, production-mode migrate/seed/API/worker, frontend build) and passed,
  but please run `docker compose up --build` once and report anything that differs. nginx config was reviewed, not executed.
* No third-party integrations (EduID, eduroam, Zoom, NOC monitoring, DNS/NTP) exist: *Paramètres → Intégrations* lists them as **“Non configuré”** placeholders only.
* Seeded events are the prototype’s dated entries; as their dates are now in the past they appear under *Passé* until new events are created.
* Media is stored on the server’s disk/volume (not object storage). No malware scanning, image resizing, or virus checks.
* No e-mail based password reset or 2FA (administrators issue temporary passwords). Logs and audit entries are kept indefinitely (cleanup trims jobs/notifications only).
* English content is optional per field; the static UI strings are translated by the prototype’s dictionary mechanism (extended for the new strings).
