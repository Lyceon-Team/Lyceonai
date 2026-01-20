# Runtime Route Map (Authoritative)

This is the complete, authoritative map of all reachable HTTP routes as mounted in `server/index.ts`.

**Legend**

* **Owner**: student | guardian | admin | public | internal
* **Auth required?**: yes | no
* **Role required**: explicit role or “none”
* **Entitlement required?**: yes | no (usage limits and paid entitlements are called out)
* **Idempotent?**: yes/no (+ key if applicable)

---

## Practice

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /api/practice/next | student | yes | student/admin | yes (usage limit) | no | **read** questions, answer_attempts; **write** practice_sessions, practice_events | Creates/continues in-progress session, serves question without answers. |
| POST | /api/practice/answer | student | yes | student/admin | no | yes (session_id + question_id tolerated) | **read** questions; **write** answer_attempts, practice_events, student_question_attempts, user_competencies | Returns correctness + explanation after submission; tolerates duplicate attempts. |
| GET | /api/me/weakness/skills | student | yes | student/admin | no | yes | **read** user_competencies | Weakness rollup by skill. |
| GET | /api/me/weakness/clusters | student | yes | student/admin | no | yes | **read** user_competencies | Weakness rollup by cluster. |
| GET | /api/me/mastery/summary | student | yes | student/admin | no | yes | **read** student_skill_mastery | Mastery summary by section/domain. |
| GET | /api/me/mastery/skills | student | yes | student/admin | no | yes | **read** student_skill_mastery | Mastery taxonomy/skills breakdown. |
| GET | /api/me/mastery/weakest | student | yes | student/admin | no | yes | **read** student_skill_mastery | Weakest skills list. |
| POST | /api/me/mastery/add-to-plan | student | yes | student/admin | no | no | **read/write** student_study_plan_days | Adds skill to a study plan day. |
| GET | /api/calendar/profile | student | yes | student/admin | no | yes | **read** student_study_profile | Load study profile. |
| PUT | /api/calendar/profile | student | yes | student/admin | no | no | **write** student_study_profile | Upsert study profile. |
| GET | /api/calendar/streak | student | yes | student/admin | no | yes | **read** student_study_plan_days, student_study_profile | Computes streak from plan days. |
| GET | /api/calendar/month | student | yes | student/admin | no | yes | **read** student_study_plan_days, student_question_attempts | Calendar month view with attempt stats. |
| PATCH | /api/calendar/day/complete | student | yes | student/admin | no | yes (returns 410) | none | Deprecated (manual completion removed). |
| POST | /api/calendar/generate | student | yes | student/admin | no | no | **read** student_study_profile, user_competencies; **write** student_study_plan_days | Generates study plan (LLM or heuristic). |
| GET | /api/progress/projection | student | yes | student/admin | no | yes | **read** practice_sessions, answer_attempts, questions | Score projection KPIs. |
| GET | /api/progress/kpis | student | yes | student/admin | no | yes | **read** answer_attempts, questions | Recency KPIs. |
| POST | /api/rag | internal | yes | none (Bearer API_USER_TOKEN or Supabase user) | no | no | **read** vector index (match_questions RPC), questions | RAG response. CSRF enforced for cookie auth. |
| POST | /api/rag/v2 | public | no | none | no | no | **read** RAG data sources | Returns structured context for tutor. |
| POST | /api/tutor/v2 | student | yes | student/admin | yes (usage limit) | no | **read/write** tutor_logs, profiles | AI tutor response w/ RAG v2. |
| POST | /api/student/analyze-question | student | yes | student/admin | no | no | none | Gemini vision analysis for uploaded question. |
| GET | /api/notifications | student | yes | student/guardian/admin | no | yes | **read** notifications, notification_reads | Notifications feed. |
| GET | /api/notifications/unread-count | student | yes | student/guardian/admin | no | yes | **read** notifications, notification_reads | Unread count. |
| PATCH | /api/notifications/:id/read | student | yes | student/guardian/admin | no | yes | **read/write** notifications, notification_reads | Marks one notification read. |
| PATCH | /api/notifications/mark-all-read | student | yes | student/guardian/admin | no | yes | **write** notifications, notification_reads | Marks all read. |

## Questions

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /api/questions | student | yes | student/admin | no | yes | **read** questions | Secure list (no answers). |
| GET | /api/questions/recent | student | yes | student/admin | no | yes | **read** questions | Secure list (no answers). |
| GET | /api/questions/random | student | yes | student/admin | no | yes | **read** questions, user_competencies | Supports focus=weak. |
| GET | /api/questions/count | student | yes | student/admin | no | yes | **read** questions | Count only. |
| GET | /api/questions/stats | student | yes | student/admin | no | yes | **read** questions | Summary stats. |
| GET | /api/questions/feed | student | yes | student/admin | no | yes | **read** questions | Feed view (no answers). |
| GET | /api/questions/:id | student | yes | student/admin | no | yes | **read** questions | Single question (no answers). |
| POST | /api/questions/validate | student | yes | student/admin | no | no | **read** questions | Returns correctness; MC returns key, FR never returns answer. |
| POST | /api/questions/feedback | student | yes | student/admin | no | no | **write** question_feedback | Feedback on question. |

## Review Errors

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /api/review-errors | student | yes | student/admin | no | yes | **read** practice_sessions, answer_attempts, questions | Review queue for most recent session. |
| POST | /api/review-errors/attempt | student | yes | student/admin | no | yes | none | Stub to avoid 404; no-op. |

## Guardian

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /api/guardian/students | guardian | yes | guardian/admin | no | yes | **read** profiles | List linked students. |
| POST | /api/guardian/link | guardian | yes | guardian/admin | no | no | **read/write** profiles, guardian_link_audit | Link student by code. |
| DELETE | /api/guardian/link/:studentId | guardian | yes | guardian/admin | no | no | **write** profiles, guardian_link_audit | Unlink student. |
| GET | /api/guardian/students/:studentId/summary | guardian | yes | guardian/admin | yes (guardian entitlement) | yes | **read** profiles, practice_sessions, answer_attempts | Student summary (read-only). |
| GET | /api/guardian/students/:studentId/calendar/month | guardian | yes | guardian/admin | yes (guardian entitlement) | yes | **read** student_study_plan_days, student_question_attempts, student_study_profile | Calendar month rollup. |
| GET | /api/guardian/weaknesses/:studentId | guardian | yes | guardian/admin | yes (guardian entitlement) | yes | **read** user_competencies, profiles | Weakness rollups (read-only). |

## Billing

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | /api/billing/webhook | internal | no | none | no | yes (Stripe event id) | **write** entitlements, billing-related tables | Stripe webhook (raw body). |
| POST | /api/billing/checkout | guardian | yes | student/guardian | no | no | **write** accounts, entitlements, billing profiles | Creates Stripe checkout session. |
| GET | /api/billing/status | guardian | yes | student/guardian | no | yes | **read/write** entitlements, accounts | Entitlement status; may self-heal via Stripe. |
| GET | /api/billing/products | guardian | yes | guardian/admin | no | yes | **read** billing products | Lists products. |
| GET | /api/billing/prices | public | no | none | no | yes | none | Public price list from env. |
| GET | /api/billing/prices/authenticated | guardian | yes | student/guardian | no | yes | none | Authenticated price list (same data). |
| GET | /api/billing/products/:productId/prices | guardian | yes | student/guardian | no | yes | **read** billing prices | Product prices. |
| GET | /api/billing/portal | guardian | no | none | no | yes (405) | none | Method guard: use POST. |
| POST | /api/billing/portal | guardian | yes | student/guardian | no | no | **read** entitlements | Creates Stripe billing portal session. |
| GET | /api/billing/publishable-key | public | no | none | no | yes | none | Returns Stripe publishable key. |
| GET | /api/billing/debug/env | guardian | yes | guardian/admin | no | yes | none | Stripe env diagnostics. |
| GET | /api/billing/debug/validate | guardian | yes | guardian/admin | no | yes | none | Stripe price validation. |
| GET | /api/account/bootstrap | student | yes | student/guardian | no | yes | **write** accounts | Ensures account exists. |
| GET | /api/account/status | student | yes | student/guardian | no | yes | **read** accounts, entitlements, usage | Account + entitlement status. |
| POST | /api/account/select | guardian | yes | guardian | no | no | **write** guardian account selection | Guardian selects account context. |

## Auth

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | /api/auth/signup | public | no | none | no | no | **write** auth.users, profiles | Email/password signup. |
| POST | /api/auth/signin | public | no | none | no | no | **read** auth.users; **write** auth cookies | Email/password signin. |
| POST | /api/auth/signout | public | no | none | no | yes | none | Clears auth cookies. |
| GET | /api/auth/user | public | no | none | no | yes | **read/write** profiles | Returns authenticated user + profile. |
| POST | /api/auth/consent | student | yes | student | no | yes | **write** profiles | Guardian consent for under-13. |
| POST | /api/auth/refresh | public | no | none | no | no | **read** auth.users; **write** auth cookies | Refresh session. |
| GET | /api/auth/debug | public | no | none | no | yes | **read** profiles | Auth diagnostics. |
| GET | /api/auth/google/debug | public | no | none | no | yes | none | OAuth diagnostics. |
| GET | /api/auth/google/start | public | no | none | no | no | none | Starts Google OAuth; sets state cookie. |
| GET | /auth/google/callback | public | no | none | no | no | **read/write** auth.users, profiles | OAuth callback and redirect. |
| POST | /api/legal/accept | student | yes | student/guardian/admin | no | yes (user_id + doc key/version) | **write** legal_acceptances | Records acceptance (upsert). |
| GET | /api/legal/acceptances | student | yes | student/guardian/admin | no | yes | **read** legal_acceptances | Returns acceptances. |

## Ingestion

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | /api/ingest | admin | yes | ingest admin token | no | no | **write** questions, question_embeddings | MVP ingest pipeline (Bearer INGEST_ADMIN_TOKEN). |
| POST | /api/ingest-llm | admin | yes | admin or ingest admin token | no | no | **write** ingestion_runs, questions | Starts ingestion v3 job. |
| POST | /api/ingest-llm/test | admin | yes | admin or ingest admin token | no | no | **read/write** ingestion_runs, questions | Test ingestion with limited questions. |
| GET | /api/ingest-llm/status/:jobId | admin | yes | admin or ingest admin token | no | yes | **read** ingestion_runs | Job status. |
| GET | /api/ingest-llm/jobs | admin | yes | admin or ingest admin token | no | yes | **read** ingestion_runs | List jobs. |
| POST | /api/ingest-llm/retry/:jobId | admin | yes | admin or ingest admin token | no | no | **write** ingestion_runs | Retry failed job. |
| GET | /api/ingest/jobs | admin | yes | admin or ingest admin token | no | yes | **read** ingestion_runs | Legacy alias for jobs. |
| POST | /api/ingest-v2/upload | public | no | none | no | yes (410) | none | Deprecated (410 Gone). |
| GET | /api/ingest-v2/status/:jobId | public | no | none | no | yes (410) | none | Deprecated (410 Gone). |
| GET | /api/ingest-v2/jobs | public | no | none | no | yes (410) | none | Deprecated (410 Gone). |
| POST | /api/ingest-v2/retry/:jobId | public | no | none | no | yes (410) | none | Deprecated (410 Gone). |
| DELETE | /api/ingest-v2/cancel/:jobId | public | no | none | no | yes (410) | none | Deprecated (410 Gone). |
| GET | /api/ingest-v2/stats | public | no | none | no | yes (410) | none | Deprecated (410 Gone). |
| GET | /api/ingest-v2/debug/qa/:jobId | public | no | none | no | yes (410) | none | Deprecated (410 Gone). |
| POST | /api/ingestion-v4/test | admin | yes | admin | no | no | **write** ingestion_v4_drafts | V4 pipeline test. |
| POST | /api/ingestion-v4/jobs | admin | yes | admin | no | no | **write** ingestion_v4_jobs | Create v4 job. |
| GET | /api/ingestion-v4/jobs | admin | yes | admin | no | yes | **read** ingestion_v4_jobs | List jobs. |
| GET | /api/ingestion-v4/jobs/active | admin | yes | admin | no | yes | **read** ingestion_v4_jobs | Active job summary. |
| GET | /api/ingestion-v4/jobs/:jobId | admin | yes | admin | no | yes | **read** ingestion_v4_jobs | Fetch job. |
| POST | /api/ingestion-v4/jobs/:jobId/dry-run | admin | yes | admin | no | no | **write** ingestion_v4_jobs, ingestion_v4_drafts | Dry-run sample draft. |
| POST | /api/ingestion-v4/jobs/:jobId/run-once | admin | yes | admin | no | no | **write** ingestion_v4_jobs, ingestion_v4_drafts, questions | Generate 1 question. |
| POST | /api/ingestion-v4/jobs/:jobId/run-batch | admin | yes | admin | no | no | **write** ingestion_v4_queue, ingestion_v4_jobs | Batch generation. |
| POST | /api/ingestion-v4/style-library | admin | yes | admin | no | no | **write** ingestion_v4_style_library | Create style library entry. |
| GET | /api/ingestion-v4/style-library | admin | yes | admin | no | yes | **read** ingestion_v4_style_library | List style entries. |
| POST | /api/ingestion-v4/queue/tick | admin | yes | admin | no | no | **write** ingestion_v4_queue, ingestion_v4_jobs | Process next queued batch. |
| GET | /api/ingestion-v4/queue | admin | yes | admin | no | yes | **read** ingestion_v4_queue | List queue items. |
| GET | /api/ingestion-v4/style-bank/scan | admin | yes | admin | no | yes | **read** storage metadata | Scan style bank PDFs. |
| POST | /api/ingestion-v4/style-bank/sync | admin | yes | admin | no | no | **write** ingestion_v4_style_library | Sync storage to library. |
| POST | /api/ingestion-v4/style-bank/render | admin | yes | admin | no | no | **write** ingestion_v4_queue | Enqueue render jobs. |
| GET | /api/ingestion-v4/style-bank/pages | admin | yes | admin | no | yes | **read** ingestion_v4_style_pages | List rendered pages. |
| GET | /api/ingestion-v4/style-bank/pages/stats | admin | yes | admin | no | yes | **read** ingestion_v4_style_pages | Usage stats. |
| GET | /api/ingestion-v4/clusters | admin | yes | admin | no | yes | **read** ingestion_v4_style_clusters | List clusters. |
| GET | /api/ingestion-v4/clusters/:clusterId | admin | yes | admin | no | yes | **read** ingestion_v4_style_clusters | Cluster detail. |
| GET | /api/ingestion-v4/clusters/:clusterId/pages | admin | yes | admin | no | yes | **read** ingestion_v4_style_pages | Cluster pages. |
| POST | /api/ingestion-v4/style-bank/pages/:pageId/cluster | admin | yes | admin | no | no | **write** ingestion_v4_style_pages | Cluster a page. |
| POST | /api/ingestion-v4/style-bank/cluster | admin | yes | admin | no | no | **write** ingestion_v4_style_pages, ingestion_v4_style_clusters | Cluster batch. |
| POST | /api/ingestion-v4/style-bank/repair-links | admin | yes | admin | no | no | **write** ingestion_v4_style_pages, ingestion_v4_style_clusters | Repair unlinked pages. |
| POST | /api/ingestion-v4/clusters/sample-pack | admin | yes | admin | no | no | **read/write** ingestion_v4_style_pages, ingestion_v4_style_clusters | Sample a coherent pack; increments usage. |
| GET | /api/ingestion-v4/style-bank/unclustered | admin | yes | admin | no | yes | **read** ingestion_v4_style_pages | Unclustered pages. |
| POST | /api/ingestion-v4/queue/tick-worker | admin | yes | admin | no | no | **write** ingestion_v4_queue | Worker tick (batch or render). |
| GET | /api/ingestion-v4/admin/dashboard | admin | yes | admin | no | yes | **read** ingestion_v4_jobs, ingestion_v4_queue, ingestion_v4_style_pages, ingestion_v4_style_clusters | Admin dashboard stats. |
| GET | /api/ingestion-v4/worker/status | admin | yes | admin | no | yes | **read** worker state | Always-on worker status. |
| POST | /api/ingestion-v4/worker/start | admin | yes | admin | no | no | **write** worker state | Starts worker. |
| POST | /api/ingestion-v4/worker/stop | admin | yes | admin | no | no | **write** worker state | Stops worker. |
| GET | /api/ingestion-v4/worker/config | admin | yes | admin | no | yes | **read** worker config | Worker config (env + db). |
| POST | /api/ingestion-v4/worker/config | admin | yes | admin | no | no | **write** worker config | Toggle worker enabled. |
| POST | /api/ingestion-v4/admin/fanout-pdfs | admin | yes | admin | no | no | **write** ingestion_v4_queue | Admin fanout. |
| POST | /api/ingestion-v4/admin/proof | admin | yes | admin | no | no | **read/write** ingestion_v4_queue, ingestion_v4_style_pages, ingestion_v4_style_clusters | End-to-end proof. |
| GET | /api/ingestion-v4/catalog/status | admin | yes | admin | no | yes | **read** ingestion_v4_style_pages, ingestion_v4_style_clusters, ingestion_v4_queue | Catalog status. |
| GET | /api/ingestion-v4/domains | admin | yes | admin | no | yes | **read** ingestion_v4_style_pages | Domains/skills list. |
| POST | /api/ingestion-v4/generate | admin | yes | admin | no | no | **write** ingestion_v4_jobs, ingestion_v4_queue | Enqueue generation. |
| POST | /api/ingestion-v4/jobs/:jobId/cancel | admin | yes | admin | no | no | **write** ingestion_v4_jobs, ingestion_v4_queue | Cancel job + queued batches. |
| POST | /api/ingestion-v4/queue/:itemId/retry | admin | yes | admin | no | no | **write** ingestion_v4_queue | Retry queue item. |
| DELETE | /api/ingestion-v4/queue/:itemId | admin | yes | admin | no | no | **write** ingestion_v4_queue | Delete queue item. |
| GET | /api/ingestion-v4/errors/recent | admin | yes | admin | no | yes | **read** ingestion_v4_queue | Recent failures. |
| POST | /api/ingestion-v4/catalog/reset | admin | yes | admin | no | no | **write** ingestion_v4_queue, ingestion_v4_style_pages, ingestion_v4_style_clusters | Debug reset. |

## Admin

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /api/admin/stats | admin | yes | admin | no | yes | **read** questions, ingestion_runs, practice_sessions | Admin dashboard stats. |
| GET | /api/admin/kpis | admin | yes | admin | no | yes | **read** questions | Ingestion KPIs. |
| GET | /api/admin/database/schema | admin | yes | admin | no | yes | none | Schema info (static response). |
| GET | /api/admin/questions-proof | admin | yes | admin | no | yes | **read** questions | Proof of questions data. |
| GET | /api/admin/proof/questions | admin | yes | admin or ingest admin token | no | yes | **read** questions | Proof endpoint (service role). |
| POST | /api/admin/proof/insert-smoke | admin | yes | admin or ingest admin token | no | no | **write** questions | Inserts smoke row. |
| DELETE | /api/admin/proof/cleanup-smoke | admin | yes | admin or ingest admin token | no | no | **write** questions | Deletes smoke rows. |
| GET | /api/admin/ingest-summary | admin | yes | ingest admin token | no | yes | **read** questions, ingestion_jobs | Ingestion quality summary. |
| GET | /api/admin/db-health | public | no | none | no | yes | **read** supabase connection | DB health check. |
| GET | /api/admin/questions/needs-review | admin | yes | admin | no | yes | **read** questions | Pending review list. |
| GET | /api/admin/questions/statistics | admin | yes | admin | no | yes | **read** questions | Parsing stats. |
| POST | /api/admin/questions/:id/approve | admin | yes | admin | no | no | **write** questions | Approve question. |
| POST | /api/admin/questions/:id/reject | admin | yes | admin | no | no | **write** questions | Reject/delete question. |
| GET | /api/admin/supabase-debug | admin | yes | admin | no | yes | **read** questions | Supabase debug. |
| GET | /api/admin/worker/status | admin | yes | admin | no | yes | **read** worker state | Ingestion worker status. |
| POST | /api/admin/worker/stop | admin | yes | admin | no | no | **write** worker state | Stop ingestion worker. |

## Health / Debug

| Method | Full Path | Owner | Auth required? | Role required | Entitlement required? | Idempotent? | DB Impact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /healthz | public | no | none | no | yes | none | Basic health check. |
| GET | /api/health | public | no | none | no | yes | none | Legacy alias. |
| GET | /api/health/practice | public | no | none | no | yes | **read** information_schema | Practice schema health report. |
| GET | /debug/env/ingest | public | no | none | no | yes | none | Env presence only. |
| GET | /api/_whoami | public | no | none | no | yes | none | Version + route list. |
| GET | /privacy | public | no | none | no | yes | none | 301 redirect to /legal/privacy-policy. |
| GET | /terms | public | no | none | no | yes | none | 301 redirect to /legal/student-terms. |
| GET | / | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /digital-sat | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /digital-sat/math | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /digital-sat/reading-writing | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /blog | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /blog/is-digital-sat-harder | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /blog/digital-sat-scoring-explained | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /blog/quick-sat-study-routine | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /blog/sat-question-bank-practice | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /blog/common-sat-math-algebra-mistakes | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /legal | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /legal/privacy-policy | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /legal/student-terms | public | no | none | no | yes | none | SSR public page (SEO). |
| GET | /* (non-/api) | public | no | none | no | yes | none | SPA fallback (index.html). |
