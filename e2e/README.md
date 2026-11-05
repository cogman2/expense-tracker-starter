# End-to-end tests (Playwright)

Playwright is configured but **no tests are written yet**. Add spec files here as
`e2e/*.spec.ts` — anything matching `*.spec.ts` is picked up automatically
(config: [`../playwright.config.ts`](../playwright.config.ts)).

## Isolated test database

E2E runs use a **separate Postgres database** so they never touch development
data. It is configured via `TEST_DATABASE_URL` in `server/.env` (see
`server/.env.example`); if unset, it is derived from `DATABASE_URL` by appending
a `_test` suffix. As a safety measure the database name **must contain "test"**.

Before every run, [`global-setup.ts`](./global-setup.ts):

1. Resets the test database (`prisma migrate reset --force`) — a clean schema
   each run.
2. Seeds baseline accounts: `admin@example.com` and `agent@example.com`
   (password `password123`).

One-time creation of the database (if it doesn't exist yet):

```bash
createdb helpdesk_test          # or: psql -c 'CREATE DATABASE helpdesk_test;'
```

## Running

Run from the **repo root**. Stop any `bun run dev` servers first — Playwright
starts its own server (bound to the test database) and client, and will not
reuse an already-running dev server.

```bash
bun run test:e2e          # headless
bun run test:e2e:ui       # interactive UI mode
bun run test:e2e:report   # open the last HTML report
```

## Files

- `../playwright.config.ts` — config: web servers, test DB injection, reporters.
- `global-setup.ts` — resets + seeds the test database before the run.
- `test-db.ts` — resolves `TEST_DATABASE_URL` and guards against non-test DBs.
