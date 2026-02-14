# P00 Mastery Current State Proofs

## Provenance Proofs (required)

### CMD-PROV-01
```bash
git rev-parse --show-toplevel
```
```text
/workspace/Lyceonai
```

### CMD-PROV-02
```bash
git rev-parse --abbrev-ref HEAD
```
```text
work
```

### CMD-PROV-03
```bash
git rev-parse HEAD
```
```text
4e7b0ba63d8090f13751d54d4d7578044ec7f8be
```

### CMD-PROV-04
```bash
git log -1 --oneline
```
```text
4e7b0ba Merge pull request #68 from Lyceon-Team/copilot/define-mastery-tables-schema
```

### CMD-PROV-05
```bash
git status --porcelain
```
```text

```

### CMD-PROV-06
```bash
node -v
```
```text
v22.21.1
```

### CMD-PROV-07
```bash
pnpm -v
```
```text
10.13.1
```

### CMD-PROV-08
```bash
pnpm -s run build
```
```text
vite v7.3.1 building client environment for production...
transforming...
✓ 2184 modules transformed.
rendering chunks...
computing gzip size...
... output omitted for brevity ...
✓ built in 8.58s
Building server with esbuild...
Entry: /workspace/Lyceonai/server/index.ts
Output: /workspace/Lyceonai/dist/index.js
✓ Server bundle created at /workspace/Lyceonai/dist/index.js
✓ All local files bundled, all npm packages external

  dist/index.js      384.7kb
  dist/index.js.map  771.0kb

⚡ Done in 136ms
```

### CMD-PROV-09
```bash
pnpm -s test
```
```text
TRUNCATED (full output was 2884 lines; captured in /tmp/pnpm_test_full.txt)
Last 200 lines:

  difficultyBucket: 'medium',
  excludeCount: 0,
  limit: 60
}
[AdaptiveSelector] Executing query for section: math
...
 ✓ apps/api/test/rag-service.test.ts (22 tests) 33ms
 ✓ client/src/__tests__/useShortcuts.guard.test.tsx (1 test) 20ms
 ✓ apps/api/src/lib/__tests__/canonicalId.test.ts (19 tests) 22ms

 Test Files  14 passed (14)
      Tests  138 passed (138)
   Start at  15:02:58
   Duration  11.12s (transform 1.07s, setup 0ms, import 3.55s, tests 3.11s, environment 1.46s)
```

## Mastery Discovery Proofs

### CMD-A1 Locate mastery modules and routes (broad)
```bash
rg -n --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" "mastery|skill_mastery|cluster_mastery|diagnostic|cold start|half[- ]life|decay|EMA|ELO|IRT|theta|proficiency|competenc" .
```
```text
TRUNCATED (full output was 1509 lines; captured in /tmp/rg_a1.txt)
Last 200 lines included key mastery service and route hits.
```

### CMD-A2 Locate mounted mastery endpoints and route declarations
```bash
rg -n --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" "app\.use\\(\"/api/me/mastery|/mastery\"|router\.(get|post)\('/(skills|summary|weakest|diagnostic)" .
```
```text
./SPRINT2_PR4_SUMMARY.md:57:grep -n "router.get('/skills'" apps/api/src/routes/mastery.ts
./SPRINT2_CLOSEOUT_COMPLETE.md:39:grep -n "router.get('/skills'" apps/api/src/routes/mastery.ts
./docs/proofs/sprint2_final_closeout_proofs.md:37:97:        <Route path="/mastery" component={() => <RequireRole allow={['student', 'admin']}><MasteryPage /></RequireRole>} />
./server/index.ts:64:import { masteryRouter } from "../apps/api/src/routes/mastery";
./server/index.ts:326:app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter);
./server/index.ts:327:app.use("/api/me/mastery/diagnostic", requireSupabaseAuth, requireStudentOrAdmin, diagnosticRouter);
./docs/proofs/sprint2_pr4_closeout_proofs.md:59:grep -n "/mastery" client/src/App.tsx client/src/pages/mastery.tsx
./docs/proofs/sprint2_pr4_closeout_proofs.md:76:- `server/index.ts:64`: `import { masteryRouter } from "../apps/api/src/routes/mastery"`
./docs/proofs/sprint2_pr4_closeout_proofs.md:77:- `server/index.ts:329`: `app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter)`
./docs/proofs/sprint2_pr4_closeout_proofs.md:78:- `apps/api/src/routes/mastery.ts:167`: `router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {`
./docs/audits/sprint-3/SECURITY_SUMMARY_MASTERY_V1.md:111:app.use("/api/me/mastery/diagnostic", 
./docs/audits/sprint-3/SECURITY_SUMMARY_MASTERY_V1.md:261:app.use("/api/me/mastery/diagnostic/start", diagnosticRateLimit);
./docs/audits/sprint-3/P00_MASTERY_PROOFS.md:46:325 app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter);
./docs/audits/sprint-3/P00_MASTERY_PROOFS.md:85:147 router.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
./docs/audits/sprint-3/P00_MASTERY_PROOFS.md:105:167 router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {
./docs/audits/sprint-3/P00_MASTERY_PROOFS.md:196:258 router.get('/weakest', async (req: AuthenticatedRequest, res: Response) => {
./client/src/App.tsx:40:const MasteryPage = lazy(() => import("@/pages/mastery"));
./client/src/App.tsx:97:        <Route path="/mastery" component={() => <RequireRole allow={['student', 'admin']}><MasteryPage /></RequireRole>} />
./apps/api/src/routes/mastery.ts:162:router.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
./apps/api/src/routes/mastery.ts:192:router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {
./apps/api/src/routes/mastery.ts:290:router.get('/weakest', async (req: AuthenticatedRequest, res: Response) => {
./apps/api/src/routes/weakness.ts:11:router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {
```

### CMD-B1 DB write-like calls: .insert(
```bash
rg -n --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" --fixed-strings ".insert(" .
```
```text
./tests/rls/util/supabaseTestUsers.ts:72:    .insert({
./tests/mastery.writepaths.guard.test.ts:32:  ".insert(",
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:172:     - Assert it does NOT contain: `.insert(`, `.update(`, `.upsert(`, `rpc(`
./server/routes/practice-canonical.ts:251:      .insert({
./server/routes/practice-canonical.ts:278:    await supabaseServer.from("practice_events").insert({
./server/routes/practice-canonical.ts:391:  const { error: insErr } = await supabaseServer.from("answer_attempts").insert({
./server/routes/practice-canonical.ts:414:    await supabaseServer.from("practice_events").insert({
./server/routes/supabase-auth-routes.ts:443:        .insert({
./server/routes/guardian-routes.ts:36:    const { error } = await supabaseServer.from('guardian_link_audit').insert({
./server/routes/review-errors-routes.ts:74:      .insert(insertData)
./docs/audits/sprint-3/P00_MASTERY_PROOFS.md:594:39     .insert({
./server/routes/admin-proof-routes.ts:119:      .insert([validation.cleanedRow])
./server/lib/durable-rate-limiter.ts:47:      const { error: insertError } = await supabaseServer.from('guardian_link_audit').insert({
./server/lib/account.ts:162:    .insert({ account_id: accountId, plan: 'free', status: 'inactive' })
./server/lib/account.ts:281:    .insert({
./server/lib/webhookHandlers.ts:55:    .insert({
./server/middleware/supabase-auth.ts:261:        .insert({
./database/CHAT_MESSAGES_STATUS.md:54:  await db.insert(chatMessages).values({
./database/CHAT_MESSAGES_STATUS.md:91:     const chatMessage = await db.insert(chatMessages).values({
./CLEANUP_ACTION_PLAN.md:221:    .insert({ ...job });
./scripts/canary-supabase-questions.ts:37:    .insert([row])
./scripts/dev-seed-attempt.ts:30:    .insert({
./scripts/import-approved-questions.ts:132:      await db.insert(questions).values({
./apps/api/test/mastery-writepaths.guard.test.ts:8: * - Direct .upsert() / .update() / .insert() / .delete() on mastery tables
./apps/api/test/mastery-writepaths.guard.test.ts:101:        // Pattern: .from("table_name").insert( / .update( / .upsert( / .delete(
./apps/api/scripts/seed-dev-question.ts:98:        .insert({
./apps/api/src/routes/question-feedback.ts:55:      .insert({
./apps/api/src/routes/admin-logs.ts:267:      .insert(insertData)
./apps/api/src/routes/progress.ts:68:      .insert({
./apps/api/src/routes/progress.ts:117:          .insert({
./apps/api/src/lib/canonicalId.ts:133:        .insert(rowWithCqid)
./apps/api/src/lib/tutor-log.ts:15:    .insert({
./apps/api/src/services/mastery-write.ts:104:    .insert({
./apps/api/src/services/diagnostic-service.ts:232:    .insert({
./apps/api/src/services/diagnostic-service.ts:377:    .insert({
```

### CMD-B2 DB write-like calls: .update(
```bash
rg -n --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" --fixed-strings ".update(" .
```
```text
./tests/mastery.writepaths.guard.test.ts:33:  ".update(",
./server/routes/supabase-auth-routes.ts:205:      .update(profileUpdate)
./server/routes/supabase-auth-routes.ts:513:      .update({
./server/routes/guardian-routes.ts:118:      .update({ guardian_profile_id: guardianId })
./server/routes/guardian-routes.ts:161:      .update({ guardian_profile_id: null })
./server/routes/notification-routes.ts:193:        .update({ is_read: true })
./server/routes/notification-routes.ts:238:      .update({ is_read: true })
./server/routes/profile-routes.ts:54:      .update({
./server/services/satParser.ts:153:    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
./server/admin-review-routes.ts:74:      .update({
./server/admin-review-routes.ts:293:      .update(updateData)
./server/lib/billingStorage.ts:129:      .update(stripeInfo)
./server/lib/account.ts:267:      .update({ 
./server/lib/webhookHandlers.ts:78:    .update({
./server/scripts/cleanup-question-stems.ts:124:      .update({ stem: update.stem })
./apps/api/src/routes/progress.ts:111:          .update(updates)
./apps/api/src/routes/calendar.ts:93:      .update({ completed_minutes: completedMinutes, status })
./apps/api/src/routes/admin-questions.ts:246:      .update({
./apps/api/src/routes/admin-questions.ts:283:      .update({
./apps/api/src/routes/admin-questions.ts:344:      .update(filteredUpdates)
./apps/api/src/routes/admin-questions.ts:420:      .update({
./apps/api/src/services/diagnostic-service.ts:402:    .update({
./apps/api/src/lib/profile-service.ts:28:    .update(patch)
./apps/api/test/mastery-writepaths.guard.test.ts:8: * - Direct .upsert() / .update() / .insert() / .delete() on mastery tables
./apps/api/test/mastery-writepaths.guard.test.ts:101:        // Pattern: .from("table_name").insert( / .update( / .upsert( / .delete(
./apps/api/scripts/backfill-question-classification.ts:235:        .update({ classification: item.classification })
./apps/api/scripts/seed-dev-question.ts:68:        .update({
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:172:     - Assert it does NOT contain: `.insert(`, `.update(`, `.upsert(`, `rpc(`
./scripts/migrate-users-to-supabase.ts:213:      .update(profileUpdates)
./scripts/generate-embeddings.ts:41:          .update(questions)
./scripts/backfill-embeddings.ts:58:          .update(questions)
```

### CMD-B3 DB write-like calls: .upsert(
```bash
rg -n --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" --fixed-strings ".upsert(" .
```
```text
./tests/mastery.writepaths.guard.test.ts:34:  ".upsert(",
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:172:     - Assert it does NOT contain: `.insert(`, `.update(`, `.upsert(`, `rpc(`
./docs/audits/sprint-3/P00_MASTERY_PROOFS.md:294:356       .upsert({
./server/routes/notification-routes.ts:203:        .upsert({
./server/routes/notification-routes.ts:269:          .upsert(
./server/routes/legal-routes.ts:30:      .upsert(
./server/lib/account.ts:113:    .upsert(
./server/lib/account.ts:199:    .upsert(
./server/middleware/supabase-auth.ts:346:        .upsert(
./server/middleware/supabase-auth.ts:358:          .upsert({ id: req.user.id }, { onConflict: 'id' });
./scripts/guardian-smoke-test.ts:115:      await supabase.from('profiles').upsert({
./scripts/guardian-smoke-test.ts:134:      await supabase.from('profiles').upsert({
./attached_assets/Pasted-LYCEON-PRACTICE-ENGINE-FINAL-ALL-IN-ONE-DETERMINISTIC-P_1768343029613.txt:223:  .upsert({
./apps/api/test/mastery-writepaths.guard.test.ts:8: * - Direct .upsert() / .update() / .insert() / .delete() on mastery tables
./apps/api/test/mastery-writepaths.guard.test.ts:101:        // Pattern: .from("table_name").insert( / .update( / .upsert( / .delete(
./apps/api/scripts/seed-dev-question.ts:157:        .upsert({
./apps/api/src/routes/mastery.ts:388:      .upsert({
./apps/api/src/routes/search.ts:182:          .upsert(embeddingRecords, { onConflict: 'question_id' });
./apps/api/src/routes/questions.ts:1017:      .upsert({
./apps/api/src/routes/calendar.ts:174:      .upsert(payload, { onConflict: "user_id" })
./apps/api/src/routes/calendar.ts:546:      .upsert(planDays, { onConflict: "user_id,day_date" });
./apps/api/src/lib/supabase.ts:106:    .upsert({
```

### CMD-B4 DB write-like calls: .delete(
```bash
rg -n --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" --fixed-strings ".delete(" .
```
```text
./tests/mastery.writepaths.guard.test.ts:36:  ".delete(",  // Also prevent deletes
./server/routes/guardian-routes.ts:137:router.delete('/link/:studentId', requireSupabaseAuth, requireGuardianRole, csrfProtection, async (req: Request, res: Response) => {
./server/routes/admin-proof-routes.ts:154:router.delete('/cleanup-smoke', csrfProtection, async (_req: Request, res: Response) => {
./server/routes/admin-proof-routes.ts:159:      .delete()
./server/admin-review-routes.ts:134:      .delete()
./scripts/canary-supabase-questions.ts:56:    .delete()
./scripts/dev-seed-attempt.ts:64:    .delete()
./scripts/guardian-smoke-test.ts:219:      await supabase.from('profiles').delete().eq('id', guardianId);
./scripts/guardian-smoke-test.ts:223:      await supabase.from('profiles').delete().eq('id', studentId);
./client/src/hooks/use-toast.ts:64:    toastTimeouts.delete(toastId)
./question_manager.py:48:        response = requests.delete(
./test_export.csv:124:`);return i.appendChild(t),i}function ... (csv/minified payload contains .delete() text)
./apps/api/test/mastery-writepaths.guard.test.ts:8: * - Direct .upsert() / .update() / .insert() / .delete() on mastery tables
./apps/api/test/mastery-writepaths.guard.test.ts:101:        // Pattern: .from("table_name").insert( / .update( / .upsert( / .delete(
./apps/api/src/routes/admin-questions.ts:378:      .delete()
./apps/api/src/routes/admin-questions.ts:384:      .delete()
```

### CMD-B5 DB write-like calls: rpc(
```bash
rg -n --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" --fixed-strings "rpc(" .
```
```text
./tests/mastery.writepaths.guard.test.ts:35:  "rpc(",
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:76:const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:85:const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:172:     - Assert it does NOT contain: `.insert(`, `.update(`, `.upsert(`, `rpc(`
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:256:106:      const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:257:130:      const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
./docs/audits/sprint-3/P00_MASTERY_WRITEPATHS_PR1.md:344:    │ supabase.rpc(                │  │ supabase.rpc(                │
./docs/audits/sprint-3/P00_MASTERY_PROOFS.md:622:67       const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
./docs/audits/sprint-3/P00_MASTERY_PROOFS.md:644:89       const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
./server/lib/billingStorage.ts:6:      .rpc('query_stripe_products', { product_id: productId });
./server/lib/account.ts:31:  const { data, error } = await supabase.rpc('ensure_account_for_user', {
./apps/api/test/mastery-writepaths.guard.test.ts:9: * - Direct .rpc() calls to upsert_skill_mastery or upsert_cluster_mastery
./apps/api/src/services/mastery-write.ts:135:      const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
./apps/api/src/services/mastery-write.ts:161:      const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
./apps/api/src/lib/supabase.ts:64:      const { error: funcError } = await supabase.rpc('match_questions', {
./apps/api/src/lib/supabase.ts:133:    let query = supabase.rpc('match_questions', {
```

### CMD-B6 Narrow to mastery tables/functions
```bash
rg -n --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" "student_skill_mastery|student_cluster_mastery|mastery_score|applyMastery|applyMasteryUpdate|upsert_skill_mastery|upsert_cluster_mastery|mastery_" .
```
```text
TRUNCATED (full output was 355 lines; captured in /tmp/rg_b_narrow.txt)
Includes direct hits in:
- apps/api/src/services/mastery-write.ts
- apps/api/src/services/studentMastery.ts
- apps/api/src/routes/mastery.ts
- apps/api/src/routes/diagnostic.ts
- server/routes/practice-canonical.ts
- tests/mastery.writepaths.guard.test.ts
- supabase/migrations/20251222_student_mastery_tables.sql
- supabase/migrations/20260210_mastery_v1.sql
```

### CMD-C1 Schema and migrations directory listing
```bash
ls -la supabase/migrations || true
```
```text
total 132
drwxr-xr-x 2 root root  4096 Feb 10 15:00 .
drwxr-xr-x 3 root root  4096 Feb 10 15:00 ..
-rw-r--r-- 1 root root  7708 Feb 10 15:00 20241218_competency_tables.sql
-rw-r--r-- 1 root root  4070 Feb 10 15:00 20251222_add_canonical_id_to_questions.sql
-rw-r--r-- 1 root root   488 Feb 10 15:00 20251222_dedupe_canonical_id_indexes.sql
-rw-r--r-- 1 root root  1551 Feb 10 15:00 20251222_drop_internal_id_column.sql
-rw-r--r-- 1 root root  2157 Feb 10 15:00 20251222_questions_drop_internal_id_uniqueness.sql
-rw-r--r-- 1 root root  9079 Feb 10 15:00 20251222_student_mastery_tables.sql
-rw-r--r-- 1 root root  1634 Feb 10 15:00 20251223_legal_acceptances.sql
-rw-r--r-- 1 root root   674 Feb 10 15:00 20251227_enqueue_rpc_v2_wrapper.sql
-rw-r--r-- 1 root root  3425 Feb 10 15:00 20251227_study_calendar_tables.sql
-rw-r--r-- 1 root root 16005 Feb 10 15:00 20260102_guardian_link_code.sql
-rw-r--r-- 1 root root  8132 Feb 10 15:00 20260102_practice_tables.sql
-rw-r--r-- 1 root root  3460 Feb 10 15:00 20260108_sprint21_hardening.sql
-rw-r--r-- 1 root root  4775 Feb 10 15:00 20260109_practice_canonical.sql
-rw-r--r-- 1 root root  8246 Feb 10 15:00 20260110_practice_canonical_plus_events.sql
-rw-r--r-- 1 root root  4719 Feb 10 15:00 20260113_practice_engine_competencies.sql
-rw-r--r-- 1 root root   812 Feb 10 15:00 20260202_profile_completion_fields.sql
-rw-r--r-- 1 root root  3172 Feb 10 15:00 20260203_review_error_attempts.sql
-rw-r--r-- 1 root root 10120 Feb 10 15:00 20260210_mastery_v1.sql
```

### CMD-C2 Schema grep for mastery artifacts
```bash
rg -n --hidden --glob "supabase/migrations/*.sql" "student_skill_mastery|student_cluster_mastery|create table|create or replace function|rpc|mastery" supabase/migrations
```
```text
supabase/migrations/20260210_mastery_v1.sql:4:-- Updates mastery tables and RPC functions to implement the exact Mastery v1.0
supabase/migrations/20260210_mastery_v1.sql:13:-- Step 1: Update mastery_score columns to support [0, 100] range
supabase/migrations/20260210_mastery_v1.sql:16:-- student_skill_mastery: Change mastery_score from NUMERIC(5,4) [0,1] to NUMERIC(5,2) [0,100]
supabase/migrations/20260210_mastery_v1.sql:18:ALTER TABLE public.student_skill_mastery 
... 
supabase/migrations/20251222_student_mastery_tables.sql:190:COMMENT ON TABLE public.student_skill_mastery IS 'Rollup of student accuracy by skill for weakness tracking';
supabase/migrations/20251222_student_mastery_tables.sql:191:COMMENT ON TABLE public.student_cluster_mastery IS 'Rollup of student accuracy by structure cluster for weakness tracking';
```

## File-level evidence excerpts (for audit claims)

- Canonical write choke point implementation: `apps/api/src/services/mastery-write.ts`.
- Read-only mastery service: `apps/api/src/services/studentMastery.ts`.
- Projection-only computations: `apps/api/src/services/mastery-projection.ts`, `server/services/score-projection.ts`.
- Mastery read routes: `apps/api/src/routes/mastery.ts`.
- Diagnostic flow and mastery initialization path: `apps/api/src/routes/diagnostic.ts`, `apps/api/src/services/diagnostic-service.ts`.
- Route mounting: `server/index.ts`.
- Schema and RPC definitions: `supabase/migrations/20251222_student_mastery_tables.sql`, `supabase/migrations/20260210_mastery_v1.sql`.
- Guard invariants: `tests/mastery.writepaths.guard.test.ts`.

## Evidence Ledger

| Claim | Type | Primary Evidence | Notes |
|---|---|---|---|
| Mastery APIs are mounted under `/api/me/mastery` and `/api/me/mastery/diagnostic` | Route | CMD-A2; `server/index.ts` excerpt | Confirms route wiring in server app bootstrap. |
| Canonical mastery write function exists and is named `applyMasteryUpdate` | Write | CMD-B6; `apps/api/src/services/mastery-write.ts` excerpt | Function performs attempt log + RPC rollups. |
| Mastery writes use RPCs `upsert_skill_mastery` and `upsert_cluster_mastery` | Write | CMD-B5; `apps/api/src/services/mastery-write.ts` excerpt | No direct table upserts in app code for mastery tables. |
| Authoritative mastery tables exist in schema | Schema | CMD-C2; `20251222_student_mastery_tables.sql`, `20260210_mastery_v1.sql` excerpts | Tables are `student_skill_mastery`, `student_cluster_mastery`; event log table is `student_question_attempts`. |
| Deterministic diagnostic exists | Route / Schema | `apps/api/src/routes/diagnostic.ts`; `apps/api/src/services/diagnostic-service.ts`; `20260210_mastery_v1.sql` | Uses deterministic blueprint and persists sessions/responses. |
| Half-life projection logic exists and is marked derived-only | Derived | `apps/api/src/services/mastery-projection.ts`; `apps/api/src/services/mastery-constants.ts` | Decay formula is explicit and marked non-persistent. |
| Score projection applies separate recency decay and domain weights | Derived | `server/services/score-projection.ts`; `apps/api/src/routes/progress.ts` | Display/projection path only. |
| Guard test enforces single choke point for mastery writes | Test | `tests/mastery.writepaths.guard.test.ts` | Scans source trees and fails on violations. |
| Build and tests passed in this snapshot | Build / Test | CMD-PROV-08, CMD-PROV-09 | Full suite passed. |
