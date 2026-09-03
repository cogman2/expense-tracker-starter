# ImplementationPlan.md

Full-stack helpdesk on **Bun + Express + React + TypeScript**, Prisma/Postgres (pgvector), BullMQ/Redis, Claude API, SendGrid. Phases 1→2→3 are sequential; Phase 4 unblocks 5, 6, and 7 in parallel; Phase 8 threads throughout and lands last.

## 1. Project Setup 

1. Project Setup 
- [ ] Initialize monorepo structure (‘/client’, ‘/server’)
- [ ] Set up Express server with TypeScript
- [ ] Set up React app with TypeScript
- [ ] Set up PostgresSQL database


## 2. Authentication — login, sessions, route protection


- [ ] Create login page
- [ ] Implement login API endpoint
- [ ] Implement logout API endpoint
- [ ] Add route protection on the frontend
(Redirect to login if unauthenticated)

## 3. User management — admin CRUD for agents, role-based access
- Add a `role` enum (`admin`, `agent`) to `users`; add a `requireRole('admin')` middleware.
- API: list / create / update / deactivate agents, plus admin-only password reset.
- Admin UI: users table, create/edit drawer, deactivate confirmation.
- Audit log table recording admin actions on user accounts.

## 4. Ticket CRUD — core ticket operations, list/detail pages with filtering
- Ticket `status` enum with three values: `open`, `resolved`, `closed`.
- API: list tickets (pagination; filter by status/category/assignee/date), get detail with messages, update status, assign agent, post internal note, post customer reply (send stubbed until Phase 6).
- React routes `/tickets` and `/tickets/:id`.
- Tickets list page: filter bar, sortable columns, status badges.
- Ticket detail page: conversation thread, customer panel, action sidebar (status, assignee, category, tags).
- Optimistic updates for status/assignee changes.

## 5. AI Features — Claude API integration for classification, summaries, suggested replies, knowledge base
- Claude client wrapper (`@anthropic-ai/sdk`) with retries, timeouts, and Langfuse tracing.
- KB CRUD UI: list, create, edit, archive entries.
- Embedding job: on KB write, embed (Voyage AI or OpenAI `text-embedding-3-large`) and upsert into `kb_embeddings`.
- Retrieval service: embed ticket → top-K cosine search → scored matches.
- CRM lookup: resolve the sender against the CRM and fetch personalization context (name, account/plan, recent tickets); cache enrichment on the local `customers` row for use in the rewrite prompt.
- Confidence classifier with the two-tier threshold (T1/T2) → routing disposition: high (≥T1) → auto-send KB rewrite; medium (T2–T1) → human queue with a KB-rewrite draft attached; low (<T2) or no match → human queue, no draft.
- Summarizer for the agent panel.
- Suggested-reply generator (KB-rewrite only): rewrite the matched KB entry in brand voice, conditioned on the style guide + example pairs + CRM personalization context, with a faithfulness check. High confidence auto-sends; medium confidence attaches the rewrite as a human draft. No novel answer generation without a KB match.
- Style guide + raw→rewritten example pairs stored in DB, with an admin edit page.
- "Promote to KB" action on resolved tickets → reviewer queue → accept creates a KB entry.

## 6. Email Integration — inbound webhook to create tickets, outbound replies, threading
- Inbound webhook endpoint (SendGrid Inbound Parse or AWS SES — pick before starting).
- Parse RFC 5322 headers; extract `In-Reply-To`, `References`, and the `[Ticket #ID]` subject token.
- Threading: attach to an existing ticket or create new; resolve sender to a `customers` row.
- Language detection (`franc`); non-English → category `human`, skip AI.
- BullMQ queue + worker: redact PII → CRM lookup/personalization → retrieve → classify → KB rewrite → auto-send or queue to human.
- SendGrid outbound: build reply with thread headers, ticket token, and the AI-disclosure footer.
- On ticket resolution, send a post-resolution CSAT survey email (SendGrid) and capture the returned score.
- Circuit breaker on Claude/KB: when open, route all tickets to the human queue.

## 7. Dashboard — stats overview, category breakdown, quick filters
- Stats API: ticket volume, open vs. resolved, FRT, CSAT, deflection rate, by-category breakdown, top KB hits.
- Dashboard route: stat cards, time-series chart (last 7/30 days), category pie/bar.
- Quick-filter chips that deep-link into the ticket list (e.g., "Open + needs human", "AI-sent today").
- Per-agent view: assigned open, resolved this week, average handle time.

## 8. Polish & Deployment — validation, error handling, Docker
- Zod (or Valibot) request validation on every API route.
- Centralized error handler, structured error responses, and Sentry on API + web.
- Rate limiting on auth and the inbound webhook.
- Compliance: encryption at rest (RDS/disk) and in transit (TLS); confirm a signed DPA with the LLM provider.
- Data retention: scheduled 90-day purge job for raw email bodies; longer retention for ticket metadata.
- GDPR/CCPA: per-customer purge endpoint that deletes a customer's PII and email bodies on request.
- UI: form validation with accessible error states; empty/loading/error states across all pages.
- Dockerfiles: API on `oven/bun:1-alpine` (with `prisma generate`); web built with `bun run build` and served via nginx; `docker-compose.prod.yml` for Postgres, Redis, api, web.
- Health/readiness endpoints and container healthchecks.
- Env management + `.env.example`; secrets via AWS SSM/Secrets Manager.
- Deploy target on AWS (ECS Fargate or App Runner — pick before starting); smoke tests + launch runbook.
