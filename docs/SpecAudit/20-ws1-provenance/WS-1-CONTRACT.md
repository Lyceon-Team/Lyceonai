# WS-1 — Provenance Baseline · Implementation Contract (finalized)

> ## ⚠️ SUPERSEDED (2026-06-09) — retained as provenance, not the active plan
> This contract executed the **provenance-baseline** strategy (invariant **I-1**:
> `0000` reproduces deployed prod verbatim; exit proof = fresh-apply *== prod*).
> The owner has since directed a **clean-slate teardown + genesis-from-spec
> rebuild**, which **reverses I-1** (`0000` is built *from `docs/Spec/`*; prod is
> *replaced*). The active governing contract is
> [`../30-genesis-recut/RECUT-CONTRACT.md`](../30-genesis-recut/RECUT-CONTRACT.md).
> Delta dispositions: **D1** Drizzle-severance survives · **D2** archive survives ·
> **D3** baseline-from-prod **replaced** · **D4** deployed-schema drops **mooted**
> (RECUT-CONTRACT §8). This file is kept per Doc 00 V6 §15 (supersession retains the
> prior record); do not execute it.

> **Phase model:** A (finalize contract — *this doc*) → B (spec-auditor inner loop)
> → C (owner + Codex approval gate — **STOP**) → D (implementation, only after C)
> → E (owner-proven closure). Nothing in Phase D is built until C approves.

## 0. Grounding (re-run every task; STOP on capture-hash mismatch)

```
git rev-parse origin/cleanup = 40ced0e9bb6c26474d197833d1b4502f912c7b7e
git rev-parse origin/main     = 34255356e0f728647b6ab224b199b3ccd96e1800   (cleanup→main merge, PR #347)
git rev-parse HEAD            = a5d491770c1c44fc6036abf202a91aab169f42ac   (this branch; updated per commit)
git hash-object docs/SpecAudit/0000-supabase-live-20260607.csv
                             = 5bb0ffe15d52ef45a6706caaa1fd108dc5a82a2a   ✓ (required prefix 5bb0ffe1)
```

**Citation convention (LF-counted, pasted proof).** The capture has **no trailing
newline**: `wc -l` = 8182 (newline count), `grep -c ''` = 8183 (lines), and
`sed -n`/`git grep -n` LF line numbers run **1..8183** (line 8183 =
`==== END OF REPORT ====`). All capture citations below are `sed -n` LF line
numbers. (The continuation prompt stated 8181/8182; this byte-identical copy —
same blob hash — measures 8182/8183, so the measured values are cited.) CR-aware
tools (PowerShell) are prohibited for citation work. The frozen
`00-supabase-live-state.csv` (blob `21ecaf66…`) is audit evidence only — WS-1 is
**never** reconciled against it.

## 0.1 The two invariants governing this entire workstream

**I-1 — The baseline is deployed reality, NOT the spec target.** `docs/Spec/` is
the *upgrade destination* implemented by later waves (WS-4 mastery, WS-5 scoring).
WS-1 does **not** move the schema toward the spec. Baseline `0000` reproduces the
**current post-WS-0 production schema exactly** — every legacy table, every
wrong-generation function (incl. `apply_learning_event_to_mastery`, the Doc-02C
EMA writer), every quirk in `0000-supabase-live-20260607.csv`. "Improving"
anything toward the spec is out of scope and breaks the exit proof: the empty
diff is only achievable if `0000` == prod. Faithfulness is the whole job.

**I-2 — After WS-1 there is exactly ONE schema-change path.** Today the deployed
DB was built through an entangled mix of ~60 never-tracked `supabase/migrations`
files **and** externally hand-run SQL (`database/*.sql`,
`database/supabase-vector-setup.sql`, the `scripts/apply_migrations.ts` second
applier). These are competing, untracked sources of truth — the provenance
defect itself (GAP-OP-05). WS-1 collapses them: `supabase/migrations` becomes the
sole pipeline; everything else is inventoried (§4), proven redundant (its effects
already live in `0000` because `0000` IS current prod) or dead, and archived as
historical. After WS-1, no schema change reaches production except as a numbered
migration through the pipeline.

## 1. Scope (registry GAPs)

| GAP | Sev | Role | Closure mechanic |
|---|---|---|---|
| **GAP-OP-05** | HIGH | primary | `0000` baseline of deployed `public` state; collapse to one pipeline; retire Drizzle + competing external SQL; CI no-object-without-source |
| **GAP-MA-03** | HIGH | primary | `0000` gives `apply_learning_event_to_mastery(...)` a tracked definition (captured in full — §10). **Captured as-is; not fixed — that is WS-4.** |
| **GAP-TU-09** | LOW | carried-in | `DROP TABLE public.tutor_interactions` — folded into the WS-1 forward migration |
| **GAP-HY-02** | MEDIUM | carried-in | Drop the 16 caller-free orphan functions — folded into the same migration |

Registry status flips to **CLOSED only in Phase E** (owner-proven). This contract
phase edits no registry status.

## 2. Locked scope boundary (owner, 2026-06-08)

**Option 1: `public` + documented platform-managed boundary** — full detail in
[`BASELINE-BOUNDARY.md`](./BASELINE-BOUNDARY.md). Diff scope = `--schema public`;
owned cross-schema deps = `create extension if not exists vector`/`pgcrypto`,
`auth.uid()` touchpoints; 14 platform-managed schemas + platform extensions +
role provisioning excluded.

## 3. §8 rulings — RESOLVED (folded in)

1. **Drizzle removal — APPROVED, conditioned on Codex re-verification.** Before
   the deps are dropped, **Codex** must independently confirm zero *runtime*
   importers of the `drizzle-orm`/`drizzle-zod`/`pgTable` exports — not just
   `import type`; check re-exports, dynamic `import()`, and scripts outside
   `src`. CC's blast-radius finding (§5) is the input, not the authority. On
   confirmation: reduce `shared/schema.ts` to pure types, delete
   `drizzle.config.ts`, remove `migrations/meta/_journal.json`, drop the three
   deps.
2. **Legacy migrations — ARCHIVE, do not delete.** Move the ~60 never-tracked
   `supabase/migrations` files out of the apply path to
   `docs/SpecAudit/_legacy-migrations/` (unambiguously outside any CLI scan).
   They are the only written record of historical *intent* on a platform whose
   core defect was intent-vs-reality drift; deleting destroys provenance
   evidence. An `_legacy-migrations/README.md` states why they are retained and
   that none are canonical.
3. **HY-02 function/table split — CORRECTED (owner, 2026-06-08).** The original
   "coupled to the `ingestion_v4_*` HY-01 tables / would orphan triggers" premise
   is refuted by ground truth: the `ingestion_v4_*` tables are **ABSENT** from prod
   (A1), **no** D1 trigger references either `update_ingestion_v4_*` function
   (D1 LF 7990-8048), and both have **zero** repo callers — identical orphan status
   to the other 14. **WS-1 drops all 16 caller-free functions** (the 14 standalone +
   the 2 `update_ingestion_v4_*` trigger fns, B1 L4133/L4134, `RETURNS trigger`,
   no args) + `tutor_interactions`. WS-7 retains **only** the genuine
   `ingestion_v4_*` **table** cleanup (none exist in prod today; tracked under
   HY-01). Each of the 16 carries a pasted `git grep` zero-caller proof and must
   exist in the `0000` capture before its DROP is authored.
4. **The 16-fn drop-set — CONFIRMED; bare `vectors` is a NO-OP.** Drop only
   objects that (a) exist in the `0000` capture AND (b) carry a pasted `git grep`
   zero-caller proof. The registry's bare `vectors` has **no matching object in
   the capture** — the `vectors` *table* is **ABSENT** from prod (proof §4); only
   the `create_vectors_table_if_not_exists` *function* (which would create it)
   exists and is already in the 16. Record at closure: `vectors` was a registry
   over-enumeration (a name containing "vectors", not a distinct object); **no
   DROP authored.** Never author a DROP for an object absent from the capture.

## 4. External-SQL & competing-pipeline inventory (Phase A deliverable)

**Method (pasted proof).** `find . -name '*.sql'` outside `supabase/migrations`
→ 25 files (all under `database/`). DDL-issuing non-SQL scripts via
`grep -rIlE 'CREATE …|ALTER TABLE|DROP …'` outside tests → 2
(`scripts/apply_migrations.ts`, `scripts/ci/check_rls_enabled.ts`). Each file's
`CREATE`/`ALTER` targets were presence-checked against the capture (tables in A1,
functions in B1/B2, sample policies in C1). Classification: **(a)** effect already
in `0000` (object PRESENT in prod) → archiving loses nothing; **(b)** dead (object
ABSENT from prod) → archiving loses nothing. **Every file resolves to ARCHIVE; no
file is a unique source of a needed, un-baselined prod object** — because `0000`
== prod, any in-prod object is in the baseline by definition.

| Path | Key objects | Capture presence | Class | Disposition |
|---|---|---|---|---|
| `database/20241207_add_tutor_interactions.sql` | tbl `tutor_interactions` | PRESENT A1 L88 | a | archive (table itself dropped in D4) |
| `database/20241207_fix_question_embeddings_vector_768.sql` | tbl `question_embeddings` + idx | PRESENT A1 L59 | a | archive |
| `database/courses-memberships-rls-fix.sql` | policies on `courses`/`memberships` | tbls PRESENT (L22/L49); `*_v2` policies superseded | a/b | archive |
| `database/migrations/0001_core_schema.sql` | ext pgcrypto/uuid-ossp/vector; idx on attempts/jobs/chunks/… | ext PRESENT F1; `idx_attempts_user` PRESENT, `idx_jobs_status`/`idx_chunks_course` ABSENT | mixed | archive |
| `database/migrations/0002_rls_policies.sql` | legacy policy set | superseded generation | a/b | archive |
| `database/migrations/0003_practice_idempotency.sql` | `idx_answer_attempts_idempotency` | ABSENT | b | archive |
| `database/policies/{attempts,chat_messages,exam_attempts,notifications,practice_sessions,progress,users}.sql` | RLS policies on present tables | `attempts_select_own`/`chat_messages_select_own`/`users_select_self` PRESENT C1 | a | archive |
| `database/policies/{jobs_audit,orgs_courses,questions,storage_policies}.sql` | policies on `jobs`/`batch_jobs`/`doc_chunks`/storage + superseded `questions_*` | `jobs`/`batch_jobs`/`doc_chunks` ABSENT; `questions_select_authenticated` ABSENT | b | archive |
| `database/postgresql-rls-policies.sql` | fns `get_current_user_id`/`is_current_user_admin`/`set_current_user_id` + policies | all 3 fns ABSENT B1 | b | archive |
| `database/profiles-rls-audit.sql` | (no DDL — audit script) | n/a | b | archive |
| `database/profiles-rls-fix.sql` | policies `profiles_self_select`/… | `profiles_self_select` PRESENT C1 | a | archive |
| `database/seeds/0003_seed_sat_taxonomy.sql` | tbls `difficulty_levels_ref`,`sat_*_ref` + seed rows | tbls PRESENT A1 L23/66/67/68; **rows 0** (GAP-HY-08) | a (schema); seed never applied | archive |
| `database/supabase-auth-migration-simple.sql`, `database/supabase-auth-only.sql` | tbls `profiles`,`practice_sessions`,`answer_attempts`,`admin_audit_logs`; fns `handle_new_user`,`update_updated_at` | profiles/practice_sessions/answer_attempts PRESENT; `admin_audit_logs` ABSENT; fns PRESENT | mixed | archive |
| `database/supabase-profiles-setup.sql` | tbl `profiles`; fns `handle_new_user`,`set_updated_at` | PRESENT | a | archive |
| `database/supabase-vector-setup.sql` | tbls `question_embeddings`,**`vectors`**; fns `create_vectors_table_if_not_exists`,`match_questions`,`match_vectors` | `question_embeddings` PRESENT; **`vectors` ABSENT**; fns PRESENT (2 dropped in D4) | mixed | archive |
| `scripts/apply_migrations.ts` | **competing applier** → `database/migrations` + `database/seeds`; own `_migrations` table | `_migrations` **ABSENT** (never run on prod); unwired in package.json/CI | b | **archive (neutralize 2nd pipeline, I-2)** |
| `scripts/ci/check_rls_enabled.ts` | read-only RLS guard (`SELECT rowsecurity`; the `ALTER TABLE` is a `console.error` hint, not executed) | n/a — issues no DDL | — | **KEEP** (guard, not a source) |

**Pasted proof (excerpt):**
```
ABSENT   table vectors                 |  ABSENT  fn get_current_user_id
PRESENT  table tutor_interactions A1 88 |  ABSENT  fn is_current_user_admin
PRESENT  table difficulty_levels_ref 23 |  ABSENT  fn set_current_user_id
ABSENT   table jobs / batch_jobs / admin_audit_logs / doc_chunks
_migrations tracking table: ABSENT → apply_migrations.ts never run against prod
idx_attempts_user PRESENT | idx_jobs_status ABSENT | idx_answer_attempts_idempotency ABSENT
```

## 5. Drizzle severance (D1; ruling 1)

**CC blast-radius finding (input to Codex re-verification).** All six
`@shared/schema` importers are `import type` of plain interfaces only:
`apps/api/src/services/fullLengthExam.ts:24-30` (`import type { FullLengthExam* }`;
audit guard: the `import type` opener is at :24 — grepping the closing `} from`
line alone misreads it as a plain import),
`client/src/components/{progress-sidebar,NotificationDropdown}.tsx`,
`client/src/hooks/use-adaptive-practice.ts`,
`client/src/pages/{UserProfile,flow-cards}.tsx`. The `users`/`questions`
`pgTable` exports (`shared/schema.ts:35,52`) and the `drizzle-orm` imports
(`:1-2`) have **zero importers** repo-wide; the only `drizzle-*` references are
`shared/schema.ts`, `drizzle.config.ts`, `package.json`. **Codex must
independently confirm** (re-exports, dynamic imports, non-`src` scripts) before
deps drop. Edits then: trim `shared/schema.ts` to types; delete
`drizzle.config.ts`; remove `migrations/meta/_journal.json`; remove `db:push` +
the 3 deps + lockfile. Severance regression lint added in §8.

## 6. Baseline 0000 generation (D3; owner-run — agents never get `service_role`)

CC produces the exact command + sanitization/repair runbook; **owner executes**
against prod and returns the dump; CC commits it as
`supabase/migrations/00000000000000_baseline.sql` + the golden snapshot.

```
# owner runs, linked to prod:
supabase db dump --linked --schema public -f supabase/migrations/00000000000000_baseline.sql
```
**Sanitization:** scope to `public`; prepend owned deps
(`create extension if not exists vector; … pgcrypto;`); emit GRANTs to
anon/authenticated/service_role but **no** `CREATE ROLE`; keep
`SET search_path TO 'public'` on SECURITY DEFINER fns verbatim; patch
`pg_dump`'s origin-enabled triggers to the captured `ENABLE ALWAYS` state
(D1, LF 7990). **Verification gate:** the committed `0000` must match the
`0000-supabase-live-20260607.csv` capture object-for-object in `public` scope
(I-1). **Repair:** owner runs `supabase migration repair --status applied
00000000000000` so prod marks the genesis applied without re-running; a fresh DB
runs it in full.

## 7. Folded drops (D4; TU-09 + HY-02) — exact SQL in Appendix A

- **TU-09:** `DROP TABLE IF EXISTS public.tutor_interactions;`. Dependents
  verified clean — only `tutor_interactions_pkey` (A3 L1527 / A4 L1841); no
  inbound FK, no C1 policy, no D1 trigger; A1 L88 `rls_enabled=true` + zero
  policies ⇒ inert grants. Runtime already reads `tutor_messages`
  (`review-session-routes.ts:893`). Full-table drop strictly supersedes the
  never-applied column-ALTER.
- **HY-02:** drop the 16 caller-free fns (Appendix A; signatures from B1
  LF 4090-4148; zero repo callers verified) — the 14 standalone + the 2
  `update_ingestion_v4_*` trigger fns (B1 L4133/L4134, `RETURNS trigger`, no args;
  orphaned: no `ingestion_v4_*` table in A1, no D1 trigger references them). WS-7
  keeps only the `ingestion_v4_*` **table** cleanup (ruling 3, corrected).
  **`vectors`: no DROP** — absent from prod (ruling 4 / §4).
- **CI-test coordination (mandatory):** rewrite assertion #3 of
  `tests/ci/tutor-interactions.no-verbatim.contract.test.ts` (currently L77-84,
  reads the soon-archived `20260606_tutor_interactions_drop_verbatim.sql`) to
  target `…_ws1_provenance_drops.sql` and assert
  `/DROP TABLE\s+(IF EXISTS\s+)?public\.tutor_interactions/i`. Assertions
  #1/#2/#4 unchanged.

## 8. CI gate (D5) + exit proof (E)

**CI gate (no prod creds) — schema self-consistency + lint:**
- *Self-consistency:* fresh-apply the committed pipeline (`0000` →
  `…_ws1_provenance_drops`) to a throwaway Postgres; `pg_dump --schema public`;
  compare normalized to the committed golden `public-schema.expected.sql`. Drift
  fails CI — this is the durable "no DB object without repo SQL" guard going
  forward.
- *Structural/severance lint:* every `supabase/migrations/*.sql` matches
  `^[0-9]{14}_.*\.sql$` (plus the `00000000000000` genesis); no stray `.sql` in
  the pipeline dir; `drizzle.config.ts` absent; no `drizzle-*` in `package.json`;
  no DDL-issuing script outside the pipeline except the kept read-only guard.

**Exit proof (owner-run, executable — *fresh-apply reproduces prod*, NOT
prod-vs-prod):**
1. Owner spins up a **fresh throwaway Supabase project**.
2. Applies `00000000000000_baseline.sql` then `…_ws1_provenance_drops.sql`
   through the pipeline (`supabase db push`).
3. `supabase db diff --linked --schema public` between the throwaway project and
   **production** → must return **empty** (modulo data). *(Prod must have had the
   D4 drops applied first; a prod-vs-prod diff proves nothing — the proof is that
   a from-scratch apply equals prod.)*
4. Tears the throwaway project down. The diff output is captured and embedded in
   the closure commit.

## 9. Implementation arc (phased; each gated)

- **A — finalize contract** *(this doc; complete)*: rulings + invariants +
  exit-proof procedure + §4 inventory.
- **B — spec-auditor inner loop**: hand this finalized contract to the
  `spec-auditor` subagent. Settled artifacts only.
- **C — approval gate (STOP)**: owner + Codex review; Codex re-verifies the §5
  drizzle blast radius (ruling 1) and the §4/Appendix-A caller-free proofs. **No
  Phase D until both approve.**
- **D — implementation** (post-C, dependency order, each a reviewable annotated
  unit): D1 severance · D2 archive (legacy migrations + external SQL +
  `apply_migrations.ts`) + `_legacy-migrations/README.md` · D3 owner-run baseline
  `0000` + golden snapshot · D4 folded drops + CI-test rewrite · D5 CI gate.
- **E — owner-proven closure**: owner runs §8 exit proof; CC flips
  GAP-OP-05/MA-03/TU-09/HY-02 → CLOSED with the empty-diff output + drop proofs in
  the commit; a fresh post-WS-1 capture becomes ground truth for WS-2/WS-3.

## 10. MA-03 closure note

`apply_learning_event_to_mastery(...)` full body is captured (B2 LF 4234 header /
LF 4236 `CREATE OR REPLACE FUNCTION public.apply_learning_event_to_mastery`; B1
tagline LF 4087). It enters the repo **verbatim** via `0000`. Do **not** correct
the Doc-02C EMA formula here (I-1) — the Doc-05 rebuild is WS-4.

## Appendix A — WS-1 forward drop SQL (draft; owner-applied)

```sql
-- @spec [Gap-Registry_V1.1, GAP-TU-09] [Gap-Registry_V1.1, GAP-HY-02]
-- @implemented [2026-06-08] | plain English: fold the two proven-dead DB drops
-- carried into WS-1 onto the provenance baseline. Idempotent.

-- TU-09 — verbatim-bearing dead table (no FK/RLS/trigger dependents; 0 rows)
DROP TABLE IF EXISTS public.tutor_interactions;

-- HY-02 — 16 caller-free orphan functions (14 standalone + 2 update_ingestion_v4_*
-- trigger fns, all orphaned: no ingestion_v4_* table, no D1 trigger, zero callers).
-- WS-7 retains only the ingestion_v4_* TABLE cleanup. No DROP for `vectors`
-- (absent from prod — registry over-enumeration).
DROP FUNCTION IF EXISTS public.create_vectors_table_if_not_exists();
DROP FUNCTION IF EXISTS public.enqueue_render_pages_if_missing(uuid, text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.enqueue_render_pages_if_missing(uuid, jsonb);
DROP FUNCTION IF EXISTS public.enqueue_render_pages_if_missing(uuid, boolean, jsonb);
DROP FUNCTION IF EXISTS public.enqueue_render_pages_if_missing_v2(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.match_vectors(vector, double precision, integer);
DROP FUNCTION IF EXISTS public.v4_acquire_worker_lock(text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.v4_debug_queue_schema();
DROP FUNCTION IF EXISTS public.v4_increment_cluster_usage(uuid, integer);
DROP FUNCTION IF EXISTS public.v4_mark_style_pages_used(uuid[]);
DROP FUNCTION IF EXISTS public.v4_queue_reset_stale_locks(integer);
DROP FUNCTION IF EXISTS public.v4_release_worker_lock(text);
DROP FUNCTION IF EXISTS public.v4_renew_worker_lock(text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.v4_set_primary_cluster(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.update_ingestion_v4_jobs_updated_at();
DROP FUNCTION IF EXISTS public.update_ingestion_v4_queue_updated_at();

-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback = re-create from 0000 baseline /
-- capture B2 history. Proven-dead objects; rollback is provenance-restore only.
```

## Appendix B — Key capture citations (LF + verbatim anchor)

- MA-03 RPC: LF 4234 `### apply_learning_event_to_mastery(...)`; LF 4236 `CREATE OR REPLACE FUNCTION public.apply_learning_event_to_mastery(...)`; tagline LF 4087.
- 0 applied migrations: LF 8096-8099 `(0 applied migrations recorded)`.
- Audit scope public: LF 8163 `## I5 — Schema inventory (context only; audit scope remains public)`.
- `vector` ext in public: LF 8078 `| vector | 0.8.0 | public |`.
- `vectors` table: **absent** (no `^| vectors | table |` row in A1).
