# P00_MASTERY_AUDIT.md

## P01 — Provenance
* Repo root (absolute path): `/workspace/Lyceonai`. (E001)
* Branch name: `sprint-3`. (E002)
* Full commit SHA: `6bc378a32827d13d935864430b9875b355ddcf4d`. (E003)
* Node version: `v22.21.1`. (E004)
* pnpm version: `10.13.1`. (E005)

## P02 — Repo Map (mastery-relevant only)
* `client/` — client mastery page calls `/api/me/mastery/skills` and renders mastery data. (E060)
* `server/` — practice answer endpoint calls mastery logging, and API router mounts mastery/practice/projection routes with auth. (E012, E013, E051)
* `apps/api/` — mastery routes, mastery services, and projection route read mastery tables. (E020, E040, E041)
* `supabase/migrations/` — defines mastery tables and RPC upsert functions. (E030)
* `docs/` — UNPROVEN (no mastery rules surfaced as code-backed sources of truth in this audit).

## P03 — Keyword Index (mastery surface area)
**Search terms:** mastery, skill, competency, proficiency, theta, irt, elo, confidence, progress, ability. (E090)

| Term | Total Hits | Top Files (by hit count) |
| --- | --- | --- |
| mastery | 1473 | docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (515), docs/sprint-3/proofs/P05_WRITE_PATHS.txt (228), docs/sprint-3/proofs/P06_DB_OBJECTS.txt (127), docs/sprint-3/mastery_audit.md (64), supabase/migrations/20251222_student_mastery_tables.sql (60). (E090) |
| skill | 1266 | generated_questions/sat_rw_200_questions.json (420), docs/sprint-3/proofs/P05_WRITE_PATHS.txt (103), docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (102), apps/api/scripts/backfill-question-classification.ts (72), attached_assets/questions_rows_(1)_1765626160591.csv (55). (E090) |
| competency | 1105 | docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (526), generated_questions/sat_rw_200_questions.json (200), apps/api/src/lib/rag-service.ts (82), apps/api/src/routes/progress.ts (33), docs/sprint-3/proofs/P05_WRITE_PATHS.txt (32). (E090) |
| proficiency | 4 | docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (2), apps/api/src/lib/rag-types.ts (1), docs/sprint-3/proofs/P05_WRITE_PATHS.txt (1). (E090) |
| theta | 4 | docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (2), docs/sprint-3/proofs/P05_WRITE_PATHS.txt (1), server/services/ocrOrchestrator.ts (1). (E090) |
| irt | 145 | docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (62), docs/sprint-3/proofs/P05_WRITE_PATHS.txt (19), client/src/pages/profile-complete.tsx (17), attached_assets/questions_rows_1765626160592.csv (12), test_export.csv (9). (E090) |
| elo | 690 | docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (304), generated_questions/sat_rw_200_questions.json (70), docs/sprint1/deploy_runbook.md (12), attached_assets/questions_rows_(1)_1765626160591.csv (11), server/logger.ts (11). (E090) |
| confidence | 248 | server/services/ocrOrchestrator.ts (57), server/admin-review-routes.ts (34), server/services/satParser.ts (32), server/services/robust-sat-parser.ts (30), shared/schema.ts (19). (E090) |
| progress | 1260 | docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (575), docs/sprint-3/proofs/P06_DB_OBJECTS.txt (93), client/src/components/progress-sidebar.tsx (26), tests/rls/rls.spec.ts (26), shared/schema.ts (24). (E090) |
| ability | 125 | generated_questions/sat_rw_200_questions.json (18), attached_assets/questions_1765626160590.csv (13), client/src/lib/legal.ts (9), docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt (8), docs/sprint0/determinism-proof.md (8). (E090) |

## P04 — API Routes (READ + WRITE)
Routes included if they serve mastery data, write mastery state, or gate mastery behind auth.

### Mastery routes (mounted at `/api/me/mastery`)
Auth middleware chain: `requireSupabaseAuth` → `requireStudentOrAdmin` (server/index.ts) → handler checks `req.user`. (E010, E020, E100)

* **GET /api/me/mastery/summary** — handler: `apps/api/src/routes/mastery.ts` (summary route). **READ** mastery summary via `getMasterySummary`. (E020)
* **GET /api/me/mastery/skills** — handler: `apps/api/src/routes/mastery.ts` (skills route). **READ** from `student_skill_mastery`. (E020)
* **GET /api/me/mastery/weakest** — handler: `apps/api/src/routes/mastery.ts` (weakest route). **READ** via `getWeakestSkills`. (E020)
* **POST /api/me/mastery/add-to-plan** — handler: `apps/api/src/routes/mastery.ts` (add-to-plan route). **WRITE** study plan data (not mastery tables). (E020)

### Projection route that reads mastery
Auth middleware chain: `requireSupabaseAuth` → `requireStudentOrAdmin` (server/index.ts). (E011, E100)

* **GET /api/progress/projection** — handler: `apps/api/src/routes/progress.ts`. **READ** `student_skill_mastery` to compute projection. (E011, E041)

### Practice route that writes mastery
Auth middleware chain: `requireSupabaseAuth` → `requireStudentOrAdmin` (server/index.ts) → route-level `requireSupabaseAuth` + `csrfProtection`. (E012, E013, E100)

* **POST /api/practice/answer** — handler: `server/routes/practice-canonical.ts`. **WRITE** mastery via `logAttemptAndUpdateMastery`. (E013, E051)

## P05 — Write Paths (the critical section)

1. **Practice answer → mastery logging (service call)**
   * **Endpoint:** `POST /api/practice/answer` → `logAttemptAndUpdateMastery`. (E013, E051)
   * **Operation type:** INSERT into `student_question_attempts`. (E050)
   * **Operation type:** RPC calls `upsert_skill_mastery`, `upsert_cluster_mastery`. (E050)
   * **Tables/objects affected:** `student_question_attempts`, `student_skill_mastery`, `student_cluster_mastery` (via RPC). (E030, E050)
   * **Call chain context:** practice route triggers `logAttemptAndUpdateMastery` after answer submission. (E051)

2. **Database RPC definitions (write logic)**
   * **Operation type:** `INSERT ... ON CONFLICT DO UPDATE` in `upsert_skill_mastery`. (E030)
   * **Operation type:** `INSERT ... ON CONFLICT DO UPDATE` in `upsert_cluster_mastery`. (E030)
   * **Objects affected:** `public.student_skill_mastery`, `public.student_cluster_mastery`. (E030)

3. **Triggers/functions**
   * **No mastery triggers found** in the mastery migration. (E052)

## P06 — DB Objects (schema truth)

**Tables (writable):**
* `public.student_question_attempts` — defined in `20251222_student_mastery_tables.sql`. (E030)
* `public.student_skill_mastery` — defined in `20251222_student_mastery_tables.sql`. (E030)
* `public.student_cluster_mastery` — defined in `20251222_student_mastery_tables.sql`. (E030)

**Functions (writable via RPC):**
* `public.upsert_skill_mastery` — defined in `20251222_student_mastery_tables.sql`. (E030)
* `public.upsert_cluster_mastery` — defined in `20251222_student_mastery_tables.sql`. (E030)

**Views / Materialized Views:**
* None found in mastery migration. (E031)

**Triggers:**
* None found in mastery migration. (E052)

## P07 — Read Paths (client + server)

### Client reads
* `client/src/pages/mastery.tsx` → React Query fetches `/api/me/mastery/skills` and expects `MasteryResponse { sections: SectionNode[] }`. (E060)

### Server/API reads
* `GET /api/me/mastery/skills` reads `student_skill_mastery` with columns `section, domain, skill, attempts, correct, accuracy, mastery_score`. (E020)
* `getWeakestSkills` reads `student_skill_mastery` (same columns) and orders by `accuracy`. (E040)
* `getWeakestClusters` reads `student_cluster_mastery` with `structure_cluster_id, attempts, correct, accuracy, mastery_score`. (E040)
* `getMasterySummary` reads `student_skill_mastery` with `section, domain, attempts, correct, accuracy`. (E040)
* `GET /api/progress/projection` reads `student_skill_mastery` with `section, domain, skill, mastery_score, attempts, updated_at`. (E041)

## P08 — Build Status (mastery code included)
* Build command executed: `pnpm run build` — succeeded. (E080)
* Mastery bundle present in build output (`mastery-*.js`). (E080)

## P09 — Test Coverage
* `apps/api/src/services/__tests__/adaptiveSelector.test.ts` uses `mastery_score` in mocked weakest skill/cluster results. (E070)
* `tests/rls/rls.spec.ts` covers `/api/progress` read/write isolation (progress-related). (E071)

## P10 — Findings Summary (facts only)
1. **Current mastery sources of truth:** `student_skill_mastery` and `student_cluster_mastery` tables with RPC upsert functions, written by `logAttemptAndUpdateMastery` invoked from the practice answer route. (E030, E050, E051)
2. **Explicitly not implemented (proven absence):** No mastery views/materialized views and no mastery triggers in the mastery migration. (E031, E052)
3. **Sprint-3 blockers / smallest next changes needed:** UNPROVEN (no sprint-3 mastery blockers are documented in code; requirements not surfaced in audited sources).
