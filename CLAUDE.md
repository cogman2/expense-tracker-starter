# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Bun workspace ("helpdesk"): `core/` (shared zod contracts), `client/` (React +
React Router + Vite) and `server/` (Express + Better Auth + Prisma/PostgreSQL).
All tooling runs on Bun.

`core/` is imported by both other workspaces as the bare specifier `core`
(`import { createUserSchema } from "core"`). It ships TypeScript source, not a
build: `core/package.json` exports `./src/index.ts`, and Bun and Vite both compile
it through the workspace symlink. Keep it runtime-agnostic — no Express, React,
Prisma or DOM — or one side will fail to import it.

- `bun run dev` — start the client and server (server :3000, client :5173);
  `core/` has no dev step.
- `bun run typecheck` — type-check core, client, server, **and** the e2e/config
  files.
- `bun run test:e2e` — Playwright end-to-end suite (see below).

## Validation

Untrusted input is validated with **zod** at the boundary it enters.

**Define every schema that describes an API payload in `core/`, and import it from
both the client and the server.** Never restate the same rules on both sides — that
duplication is what the package exists to prevent. In practice:

- **`core/src/*.ts`** owns the schema, its messages, and the types inferred from it
  (`createUserSchema`, `CreateUserInput`, `ROLES` in `core/src/users.ts`). Word the
  messages for the API, since the server returns them verbatim and the form shows
  the same strings. Unit-test the rules next to the schema
  (`core/src/users.test.ts`) — no database or DOM needed.
- **Server (the authority)** — routes live in `server/src/routes/` (one module per
  resource, an `express.Router` mounted by `server/src/index.ts`, which keeps only
  the wiring and the `/health` + `/ready` ops endpoints). They `safeParse` the body
  against the core schema and answer `400 { error }` with
  `firstIssueMessage(parsed.error)`
  (`server/src/schemas.ts`); field order in the schema decides which message a
  multiply-invalid body gets. Schemas normalize (trim the name, lowercase the
  email) and narrow enums, so handlers work with clean, typed values. Where a core
  union must match a Prisma enum, assert it at compile time — see
  `RolesMatchPrisma` in `server/src/schemas.ts`.
- **Client (UX only)** — pass the same core schema to `zodResolver` and type
  `useForm` with the inferred type (`client/src/UsersPage.tsx`). Client validation
  never stands in for the server's; it just fails faster.
- **Client-only schemas may stay local.** `loginSchema` in `client/src/LoginPage.tsx`
  describes no payload this server validates (Better Auth owns sign-in), so it
  lives with its component and keeps UI wording.
- API **responses** are typed but not parsed (`client/src/lib/api.ts` casts them) —
  a deliberate current limit, worth revisiting if the payloads start to drift.
- The 400 messages are part of the API: `e2e/user-creation.spec.ts` asserts their
  wording and `core/src/users.test.ts` pins the parsing rules, so changing a
  message means updating both.

## Testing

The repo has three kinds of tests:

- **Core / server unit tests** — `bun test` inside `core/` or `server/` (or
  `bun run --filter core test` / `--filter server test`) covers pure logic: the
  shared schemas in `core/src/users.test.ts`, the server's error mapping in
  `server/src/schemas.test.ts`. No database needed.
- **Component / unit tests** — `bun test`, run in the client workspace with
  happy-dom preloaded (`client/bunfig.toml`). Specs are `client/src/*.test.tsx`
  (e.g. `App.routing.test.tsx`). Run with `bun run --filter client test` from the
  root, or `bun test` inside `client/`.
- **End-to-end tests** — Playwright, described below.

**Always type-check after changing tests:** `bun run typecheck` covers core, the
client (including component specs), the server and the e2e/config files.

### End-to-end tests (Playwright)

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

### Writing tests — use the `e2e-test-writer` agent

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
