# tech-stack.md

Stack for the email-based support helpdesk described in `ProjectScope.md`, aligned to the phased build in `ImplementationPlan.md`. The whole stack runs on **Bun** as the single runtime, package manager, test runner, and bundler.

## Runtime & tooling
- **Bun** — one binary for runtime, package manager (lockfile `bun.lock`), test runner (`bun test`, Jest-compatible), and script execution. Argon2id password hashing comes built in via `Bun.password`, so no third-party hashing dependency.
- **TypeScript** — across backend, frontend, and the shared `packages/types`.
- **Bun workspaces** — monorepo layout (`apps/api`, `apps/web`, `packages/types`); internal deps linked with `workspace:*`.

## Frontend
- **React + TypeScript** — the custom agent helpdesk UI (ticket list/detail, user management, KB editor, dashboard).
- **Vite** — dev server and production build, executed via `bun run`.
- **Tailwind CSS** — styling without fighting a component library.
- **React Router** — client-side routing with a `RequireAuth` wrapper for protected routes.
- **React Testing Library + `bun test`** — component tests with HappyDOM preloaded via `--preload`.

## Backend
- **Express on Bun** — runs unmodified; Bun implements the `node:http` / `node:https` modules Express depends on.
- **Database sessions for authentication** — session records in Postgres, session ID in an httpOnly secure cookie; rotation on privilege change. CSRF protection via double-submit cookie on state-changing routes. (Chosen over JWT for server-side revocation.)
- **Zod (or Valibot)** — request validation on every route, with a centralized error handler and structured error responses.

## Database & ORM
- **PostgreSQL** — relational data (users, sessions, customers, tickets, messages, categories, KB entries) maps cleanly to tables with foreign keys; good for the list/detail filtering and sorting in Phase 4.
- **pgvector** — vector column on `kb_embeddings` for semantic KB search (top-K cosine), keeping retrieval in Postgres with no extra infra.
- **Prisma** — type-safe access and migrations, using the `prisma-client` generator with `engineType = "client"` and `runtime = "bun"` plus the `@prisma/adapter-pg` driver adapter (query compiler runs as WASM on the JS thread — no native query-engine binary in the image).

## Background jobs
- **BullMQ + Redis** — the inbound pipeline (redact PII → classify → generate/rewrite → send or queue) runs in a worker, not synchronously inside the webhook. `ioredis` runs cleanly on Bun.

## AI & retrieval
- **Claude API (Anthropic SDK)** — classification, summaries, and brand-voice suggested replies; strong instruction-following and structured output. Wrapped with retries, timeouts, and a circuit breaker (open → all tickets to the human queue).
- **Embeddings** — Voyage AI or OpenAI `text-embedding-3-large`. **Pick before starting Phase 5.**
- **Langfuse** — LLM tracing plus prompt versioning and eval runs, needed to tune the T1/T2 confidence thresholds. TypeScript SDK.
- **PII redaction** — card numbers, SSNs, and similar redacted before content reaches the LLM. Implemented as targeted TypeScript regex redaction, or Presidio as a sidecar service if coverage proves insufficient.
- **Language detection** — `franc` on the Node/Bun side; non-English tickets route straight to the human queue.
- **CRM client** — resolves the sender and fetches personalization context (name, account/plan, recent tickets) to inject into the rewrite prompt; enrichment cached on the local `customers` row. **Provider/API to pick before Phase 5.**

> Reply policy: the AI only ever **rewrites a matched KB entry** (brand voice + faithfulness check). High-confidence (≥T1) rewrites auto-send; medium-confidence (T2–T1) attach as a human draft; low/no-match go to a human with no draft. There is no novel answer generation without a KB match.

## Email
- **Outbound: SendGrid** — replies built with thread headers, the `[Ticket #ID]` token, and the AI-disclosure footer.
- **Inbound: SendGrid Inbound Parse or AWS SES** (+ Lambda/SNS hook). **Pick before starting Phase 6.**
- **CSAT survey** — post-resolution survey sent via SendGrid; score captured back into the ticket and surfaced on the dashboard.

## Observability & reliability
- **Sentry** — application error tracking on both API and web.
- **Langfuse** — see AI section; doubles as the LLM observability layer.
- Retries with exponential backoff on transient API errors; queue depth/age alerts at SLA thresholds.

## Deployment
- **Docker** — API image on `oven/bun:1-alpine` (runs `prisma generate`); web built with `bun run build` and served via nginx. `docker-compose.prod.yml` for Postgres, Redis, api, web.
- **AWS** — ECS Fargate or App Runner. **Pick before starting Phase 8.** Also decide managed Postgres (RDS / Aurora) and managed Redis (ElastiCache) vs. self-hosted. Secrets via AWS SSM / Secrets Manager.

## Compliance & data handling
- **Encryption** — at rest (RDS/disk encryption) and in transit (TLS everywhere).
- **DPA** — signed Data Processing Agreement with the LLM provider before launch.
- **Retention** — scheduled 90-day purge job for raw email bodies; longer retention for ticket metadata.
- **GDPR / CCPA** — per-customer purge endpoint that deletes the customer's PII and email bodies on request.
- **PII redaction** — see AI & retrieval; runs before any content reaches the LLM.

## Alternatives considered (and rejected)
- **Node.js instead of Bun** — Bun consolidates runtime, package manager, test runner, and password hashing into one toolchain. (See Bun-specific risks below.)
- **Next.js instead of React + Express** — would give SSR and a unified app, but adds complexity for what is essentially a back-office tool.
- **MongoDB** — the relational data (tickets ↔ users, tickets ↔ customers, tickets ↔ categories) is clearer in Postgres, and pgvector keeps retrieval in the same database.
- **JWT auth** — server-side sessions give straightforward revocation and rotation; chosen over stateless tokens.

## Bun-specific risks to watch
- **Prisma CLI + npm** — Prisma's dynamic subcommand loader still expects `npm` present alongside Bun for some CLI operations; install Node/npm in any image that runs migrations (`apk add --no-cache nodejs npm` on the `oven/bun` base).
- **`Bun.password` limits** — no `secret` parameter and no override of hash length / parallelism vs. standalone argon2. Fine for greenfield; would block migrating an existing hash store that uses a `secret`.
- **Native modules** — anything shipping a `.node` binary should be verified on Bun before committing (e.g. `sharp`, Sentry profiling addons). Core libs — Express, Prisma adapters, ioredis, BullMQ, `@anthropic-ai/sdk` — are clean.

## Helpdesk: custom build (decided)
We **build** a custom agent helpdesk — ticket CRUD, user management, KB editor, and dashboard — rather than integrating Zendesk/Help Scout/Freshdesk. `ProjectScope.md` → Tooling is aligned to this. The trade-off: we own queue, assignment, SLA tracking, audit trail, and the "Promote to KB" review step ourselves instead of getting them off the shelf.
