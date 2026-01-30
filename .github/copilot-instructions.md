# Copilot Instructions for SAT Learning Copilot

## Project Overview
- **Purpose:** AI-powered SAT practice app with RAG (Retrieval-Augmented Generation), vector search, and robust admin tools.
- **Major Components:**
  - `apps/api/`: Express.js backend (TypeScript). Handles API, health, ingestion, and authentication.
  - `client/`: React frontend (TypeScript, Vite, Tailwind CSS).
  - `shared/`: Shared types and schemas.
  - `database/`: Drizzle ORM schemas and SQL setup (see `supabase-vector-setup.sql`).
  - `scripts/`: Utility scripts (e.g., embeddings backfill).

## Key Workflows
- **Dev server:** `npm run dev` (frontend/backend)
- **Build:** `npm run build` then `npm run preview`
- **Type check:** `pnpm run check`
- **DB schema sync:** `npm run db:push` (never write SQL migrations manually)
- **Embeddings backfill:** `tsx scripts/backfill-embeddings.ts`
- **Security tests:** `pnpm run test:security`
- **Health check:** `GET /healthz` (works even if DB is down)

## Patterns & Conventions
- **API routes:**
  - Public: `/api/questions`, `/api/questions/:id`, etc.
  - Admin: `/api/ingest/*`, `/api/documents/*`
  - Auth: `/auth/*` (local, session-based; no Bearer tokens)
- **Vector search:** Uses Supabase pgvector; see `database/supabase-vector-setup.sql`.
- **Logging:** Structured by channel (HTTP, AUTH, ADMIN, etc.).
- **Security:**
  - Rate limits per endpoint type
  - Helmet.js for headers, CORS via env config
  - Audit logging for admin actions
- **Graceful boot:** Server starts even if DB is down; `/healthz` always available.
- **Score projection:** See scoring constants and algorithm in README (search "Score Projection Engine").

## Integration Points
- **AI/ML:** Google Gemini & OpenAI embeddings (env keys required)
- **Supabase:** For vector search and authentication
- **PostgreSQL:** Main data store (Neon or Supabase)

## Examples
- **Add a question:** Update schema in `shared/schema.ts`, add API route in `apps/api/src/routes/`, update frontend in `client/src/`
- **Backfill embeddings:** Run `tsx scripts/backfill-embeddings.ts`
- **Check health:** `curl http://localhost:5000/healthz`

## References
- See `README.md` for full architecture, workflows, and troubleshooting.
- Security runbook: `docs/SECURITY_RUNBOOK.md`
- Supabase vector setup: `database/supabase-vector-setup.sql`

---
For new patterns, update this file and the main README to keep AI agents effective.
