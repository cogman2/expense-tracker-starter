# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Bun workspace ("helpdesk"): `client/` (React + React Router + Vite) and
`server/` (Express + Better Auth + Prisma/PostgreSQL). All tooling runs on Bun.

- `bun run dev` — start both workspaces (server :3000, client :5173).
- `bun run typecheck` — type-check client, server, **and** the e2e/config files.
- `bun run test:e2e` — Playwright end-to-end suite (see below).

## End-to-end tests

Playwright specs live in `e2e/*.spec.ts` and run against an **isolated test
database** that `e2e/global-setup.ts` resets and seeds before every run. Config:
`playwright.config.ts` (`baseURL` is the client at :5173; Playwright boots both
servers itself). Seeded accounts (password `password123`):
`admin@example.com` (admin) and `agent@example.com` (agent).

Run from the repo root, with no dev server occupying ports 3000/5173
(`reuseExistingServer` is false):

```
bun run test:e2e        # headless
bun run test:e2e:ui     # interactive
```

### Use the `e2e-test-writer` agent to write e2e tests

When asked to write, add, or extend Playwright end-to-end tests — login flows,
route guards, admin gating, auth, navigation, or coverage for a newly landed
user-facing feature — use the **`e2e-test-writer`** subagent (via the Agent tool)
rather than writing the specs directly. It knows this repo's Playwright setup, the
seeded accounts, and the app's routes/guards.

- Trigger it for requests like "write an e2e test for…", "add a Playwright test
  for…", or after a UI feature merges and needs browser coverage.
- Give it the flow to cover; it reads the relevant client components to get real
  selectors, writes the spec in `e2e/`, and runs `bun run test:e2e` +
  `bun run typecheck:e2e` until green before reporting back.
- Run it synchronously (`run_in_background: false`) when you need to relay the
  pass/fail result in the same turn.
- Relay its findings — especially any real product bug it flags rather than
  weakening a test to make it pass.

For non-trivial e2e work, prefer this agent over hand-writing specs so tests stay
consistent with the conventions in existing specs (web-first, role-based locators;
no arbitrary waits; each test isolated against the freshly seeded DB).
