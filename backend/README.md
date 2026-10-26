# MaliREN API

Express 5 + TypeScript + PostgreSQL (Drizzle ORM). Setup, commands, automations and security notes are in the
[root README](../README.md). Quick reference:

```bash
cp .env.example .env && npm install
npm run db:migrate && npm run db:seed && npm run dev      # http://localhost:4000  (docs: /docs)
npm test                                                  # needs PostgreSQL (TEST_DATABASE_URL)
```

Layout: `src/routes` (HTTP + OpenAPI), `src/auth` (JWT/RBAC), `src/services` (audit, jobs, mailer, notifications, reports),
`src/automation` (schedules, handlers, worker, CLI), `src/db` (schema, migrations runner, seed), `migrations/` (SQL), `tests/`.
