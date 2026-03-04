# Launch Gate E2E Matrix (Inventory + Proof Map)

## Mandatory grounding
- Repo root: `/workspace/Lyceonai`
- Active branch (`git branch --show-current`): `work`
- Git status (`git status --porcelain`): clean at collection time (verbatim in PROOFS)
- Commit (`git rev-parse --short HEAD`): `3bcc8ac`
- Node (`node -v`): `v22.21.1`
- pnpm (`pnpm -v`): `10.13.1`
- Verbatim command output: `docs/audits/LAUNCH_GATE_E2E_PROOFS.md` (Grounding + Step 0 sections)

| Gate/Feature | UI routes/components | API endpoints / middleware | DB tables/constraints/policies | Proof references |
|---|---|---|---|---|
| 1. Auth / Roles / Guardian trust | `client/src/App.tsx` routes `/login`, `/guardian`, `/dashboard`; `RequireRole` wrappers. | `/api/auth/signin`, `/api/auth/signout`, `/api/auth/user`; cookie middleware in `server/middleware/supabase-auth.ts`; guardian checks in `server/routes/guardian-routes.ts`. | `profiles.guardian_profile_id`, `profiles.student_link_code`, `guardian_link_audit`; trigger/index/FK in `supabase/migrations/20260102_guardian_link_code.sql`. | PROOFS: Grounding, Gate 1 commands, vitest regression output.
| 2. Canonical content + anti-leak | Practice pages (`/practice/*`) in `client/src/App.tsx`. | `GET /api/practice/next`, `POST /api/practice/answer` in `server/routes/practice-canonical.ts`. | Canonical id uniqueness in `supabase/migrations/20251222_add_canonical_id_to_questions.sql`; question schema in `shared/schema.ts`. | PROOFS: Gate 2 commands + grep evidence.
| 3. Practice engine session flow | `/practice`, `/structured-practice` routes in `client/src/App.tsx`. | `server/routes/practice-canonical.ts` session create/continue + answer endpoint. | `practice_sessions`, `answer_attempts`, `practice_events` tables + unique index + RLS policies in `supabase/migrations/20260110_practice_canonical_plus_events.sql`. | PROOFS: Gate 3 commands.
| 4. Mastery + adaptive | `/mastery` route in `client/src/App.tsx`. | `applyMasteryUpdate` call from practice answer flow; mastery APIs in `apps/api/src/routes/mastery.ts`. | `student_skill_mastery`, `student_cluster_mastery`, diagnostic tables/policies in `supabase/migrations/20260210_mastery_v1.sql`. | PROOFS: Gate 4 commands.
| 5. AI tutor + RAG | `/chat` route in `client/src/App.tsx`. | `/api/tutor/v2` route in `server/index.ts` + `server/routes/tutor-v2.ts`; CSRF + auth + reveal policy. | `answer_attempts` used as reveal prerequisite; tutor log SQL exists (`database/20241207_add_tutor_interactions.sql`). | PROOFS: Gate 5 commands + vitest IDOR/entitlement tests.
| 6. Full-length exams | `/full-test` route in `client/src/App.tsx`, `client/src/pages/full-test.tsx`. | `/api/full-length/sessions*` in `server/routes/full-length-exam-routes.ts`; service in `apps/api/src/services/fullLengthExam.ts`. | `full_length_exam_*` tables, unique constraints, one-active-session index, RLS in `supabase/migrations/20260213_full_length_exam_hardening.sql`. | PROOFS: Gate 6 commands.
| 7. Calendar + study plan | `/calendar`, guardian calendar route in `client/src/App.tsx`. | `/api/calendar/profile`, `/api/calendar/streak`, etc. in `apps/api/src/routes/calendar.ts`. | `student_study_profile`, `student_study_plan_days`, RLS policies in `supabase/migrations/20251227_study_calendar_tables.sql`. | PROOFS: Gate 7 commands.
| 8. KPI + reporting | `/dashboard`, `/guardian` pages. | `/api/progress/*` (`server/index.ts` mounts), `/api/guardian/students/:id/summary`. | Derived from `practice_sessions`, `answer_attempts`, `user_competencies` lookups; table existence referenced in health checks. | PROOFS: Gate 8 commands.
| 9. Stripe + entitlements | Guardian dashboard paywall components. | `/api/billing/checkout`, `/api/billing/webhook`; webhook handling in `server/lib/webhookHandlers.ts`; entitlement middleware in `server/middleware/guardian-entitlement.ts`. | Entitlement uniqueness hardening in `supabase/migrations/20260108_sprint21_hardening.sql`; `stripe_event_log` table used in webhook code (DDL not found in audited SQL set). | PROOFS: Gate 9 commands + vitest entitlements regression.
| 10. Admin ingestion + publish | `/admin` route in `client/src/App.tsx`. | Admin routes: `server/admin-review-routes.ts`, `apps/api/src/routes/admin-questions.ts`. | Question and ingestion-related tables in shared schema; explicit publish-state DDL not proven in audited SQL set. | PROOFS: Gate 10 commands.
| 11. Observability + redaction | N/A UI; requestId visible in API responses. | `requestIdMiddleware`, `reqLogger`, `server/logger.ts` redaction rules. | Audit/event tables (`guardian_link_audit`, `stripe_event_log`) where available. | PROOFS: Gate 11 commands + vitest logs.
| 12. Trust center + SEO | `/trust`, `/legal`, `/legal/:slug`, footer links. | SEO SSR/meta/canonical injection + redirects in `server/index.ts`; static route registry in client router. | N/A DB-critical. | PROOFS: Gate 12 commands.
