# WS-1 — Provenance Baseline · Implementation Contract

> **Phase:** contract-first (this doc) → CC implements → Codex audits → owner
> applies/proves → registry closure. This contract is the reviewable artifact
> that precedes implementation; nothing in §"Implementation deliverables" is
> built until this contract is approved and the open decisions in §8 are resolved.

## 0. Grounding

- Code: `git rev-parse HEAD` = `34255356e0f728647b6ab224b199b3ccd96e1800` (branch `claude/sleepy-heisenberg-fKZvh`)
- Ground truth: `docs/SpecAudit/0000-supabase-live-20260607.csv` — git blob `5bb0ffe15d52ef45a6706caaa1fd108dc5a82a2a` — **8182 LF** — 462104 bytes. Post-WS-0, pre-WS-1-drops.
- Frozen audit evidence (NOT reconciled against, per program rule): `00-supabase-live-state.csv` — blob `21ecaf668a6d0c04f460334f13a2f9ae25892d7f` — 8404 LF.
- Registry: `docs/SpecAudit/10-gap-registry/gap-registry.md` V1.1; closure-plan WS-1 (LF 22–29).

## 1. Scope

| GAP | Sev | Role in WS-1 | Closure mechanic |
|---|---|---|---|
| **GAP-OP-05** | HIGH | primary | Capture deployed `public` state as baseline `0000`; collapse to one pipeline (`supabase/migrations`); retire Drizzle; CI no-object-without-source gate |
| **GAP-MA-03** | HIGH | primary | Baseline 0000 gives `apply_learning_event_to_mastery(...)` a tracked SQL definition (it is captured in full — see §6) |
| **GAP-TU-09** | LOW | carried-in | `DROP TABLE public.tutor_interactions` (verbatim-bearing, 0 rows, dead) — **folded into the WS-1 forward migration, not separate-PR'd** |
| **GAP-HY-02** | MEDIUM | carried-in | Drop the caller-free orphan function families — folded into the same WS-1 forward migration |

Registry status flips to **CLOSED only at the closure step** (after owner applies
+ proves). This contract PR does **not** edit registry status.

## 2. Locked decision — baseline scope boundary (owner, 2026-06-08)

**Option 1: `public` + documented platform-managed boundary.** Full detail in
[`BASELINE-BOUNDARY.md`](./BASELINE-BOUNDARY.md). Summary: baseline owns all of
`public` (tables/defaults/constraints/indexes/views/matviews, SECURITY DEFINER
functions with pinned `search_path`, `ENABLE ALWAYS` trigger state, RLS
enable-state + policies, grants to anon/authenticated/service_role, the
`profile_role` enum) plus explicitly-owned cross-schema deps
(`create extension if not exists vector`/`pgcrypto`, `auth.uid()` touchpoints).
A committed boundary doc enumerates and excludes the 14 platform-managed schemas,
platform extensions, and role provisioning. Exit proof: `supabase db diff`
scoped to the owned surface returns empty on fresh-apply against a clean
Supabase project.

## 3. Implementation deliverables & gate sequence

| # | Deliverable | Built by | Gate before next |
|---|---|---|---|
| D1 | `BASELINE-BOUNDARY.md` | CC (done, this PR) | owner/Codex review |
| D2 | Drizzle severance (§4) | CC | **dep-removal approval (§8.1)** |
| D3 | Baseline `0000` generation runbook + sanitization rules (§5) | CC writes runbook; **owner runs the dump** (service_role / prod — never an agent) | owner produces `0000_baseline.sql` |
| D4 | WS-1 forward drop migration TU-09 + HY-02 (§6) + CI-test coordination (§6.3) | CC drafts SQL + test edit; **owner applies to prod** | Codex audit of diff |
| D5 | CI gate: no-object-without-source (§7) | CC | green in CI |
| D6 | Registry closure: OP-05/MA-03/TU-09/HY-02 → CLOSED with evidence | CC, in the closure PR, after owner proof | — |

Agents never receive `service_role`; all prod dumps/migrations/diffs are
owner-applied. CC produces SQL/tooling/runbooks; the owner executes against prod.

## 4. D2 — Drizzle severance ("sever `shared/schema.ts` Drizzle wiring first")

**Blast radius (verified, HEAD 3425535).** Every consumer of `@shared/schema`
imports only the **plain TS interfaces** via `import type` — never the Drizzle
table objects:

| Importer | Symbols (all `type`-only) |
|---|---|
| `apps/api/src/services/fullLengthExam.ts:29` | `FullLengthExam*` types |
| `client/src/components/progress-sidebar.tsx:7` | `ProgressStats` |
| `client/src/components/NotificationDropdown.tsx:28` | `Notification` |
| `client/src/hooks/use-adaptive-practice.ts:4` | `StudentQuestion` |
| `client/src/pages/UserProfile.tsx:30` | `NotificationDigestFrequency`, `UserNotificationPreferences` |
| `client/src/pages/flow-cards.tsx:11` | `StudentQuestion`, `StudentMcQuestion` |

The Drizzle exports `users` and `questions` (`pgTable`, `shared/schema.ts:35,52`)
and the `drizzle-orm` / `drizzle-orm/pg-core` imports (`:1–2`) have **zero
importers anywhere** in the tree, despite the inline comments claiming "used by
active scripts." The only `drizzle-*` references in the entire repo are
`shared/schema.ts`, `drizzle.config.ts`, and `package.json`.

**Edits:**

1. `shared/schema.ts` → remove lines 1–2 (`drizzle-orm` imports) and the two
   `pgTable` blocks (`users` :35–49, `questions` :52–74), leaving a pure-types
   module — exactly what all six importers actually consume.
2. Delete `drizzle.config.ts`.
3. Remove the empty Drizzle journal: top-level `./migrations/meta/` (the
   `out: "./migrations"` target; confirmed empty-but-wired, carried from
   GAP-HY-11's note).
4. `package.json` → remove the `db:push` script (`:26`) and the
   `drizzle-orm` / `drizzle-zod` / `drizzle-kit` deps (`:89,90,159`); update
   `pnpm-lock.yaml`. **Dependency change → owner approval required (§8.1).**

**Severance regression guard:** add a CI assertion that `drizzle.config.ts` is
absent and no `drizzle-*` appears in `package.json` dependencies (§7, lint layer),
so the wiring cannot silently return.

## 5. D3 — Baseline 0000 generation (owner-run runbook)

**Method.** Owner runs, against prod, with service_role/DB creds (not an agent):

```
supabase db dump --linked --schema public -f supabase/migrations/00000000000000_baseline.sql
# (equivalently: pg_dump --schema-only --no-owner --no-privileges=false --schema=public)
```

**Sanitization rules (so the dump matches the locked boundary):**

- Scope strictly to `public`. Strip any emitted `auth`/`storage`/`realtime`/…
  objects (boundary §2).
- Prepend owned cross-schema deps: `create extension if not exists vector;`
  and `create extension if not exists pgcrypto;` (boundary §1). Do **not** emit
  `CREATE ROLE` — keep `GRANT … TO {anon,authenticated,service_role}` only.
- Preserve `SET search_path TO 'public'` on every SECURITY DEFINER function
  exactly as captured.
- Preserve `ALTER TABLE … ENABLE ALWAYS TRIGGER …` state for governance triggers
  (capture D1, LF 7990) — `pg_dump` defaults to origin-enabled and must be
  patched to match the captured `ENABLE ALWAYS` rows.

**Legacy-migration disposition (the "collapse" half of OP-05).** The current
`supabase/migrations/` holds ~60 date-named files (`20241218…` → `20260607_ws0…`)
and **0 are recorded applied** in prod (capture H1, LF 8096–8099:
`(0 applied migrations recorded)`). Baseline `0000` becomes the genesis; the
pre-baseline files must leave the active pipeline so the CLI does not attempt to
re-apply 60 overlapping, never-tracked files. **Recommendation (§8.2):**
`git mv` them to `docs/SpecAudit/20-ws1-provenance/legacy-migrations-preBaseline/`
(preserve as audit evidence — they include the never-applied
`20260606_tutor_interactions_drop_verbatim.sql`, a direct OP-05 datapoint), NOT
delete. The `20260607_ws0_stop_the_bleed.sql` migration **is applied in prod**
(WS-0) so its effects are already folded into the live state the baseline
captures — it moves to the archive with the rest.

**Repair (mark baseline applied on prod without re-running):** prod already
holds every baseline object, so the owner runs
`supabase migration repair --status applied 00000000000000` after committing the
baseline, recording it as the applied genesis. A fresh/clean DB instead runs the
baseline in full. This is the standard Supabase baseline pattern.

## 6. D4 — WS-1 forward drop migration (TU-09 + HY-02, folded)

One migration `supabase/migrations/20260608_ws1_provenance_drops.sql`, applied by
the owner **after** the baseline. Exact SQL in **Appendix A**.

### 6.1 TU-09 — drop `tutor_interactions`

- Capture: table at A1 LF 88 (`| tutor_interactions | table | true | false | 0 | 72 kB |`), columns `message` (col 8, NOT NULL, LF 1153) + `answer` (col 9, NOT NULL, LF 1154).
- **Dependents (verified clean):** only `tutor_interactions_pkey` (A3 LF 1527 / A4 LF 1841). **No** inbound FK, **no** RLS policy (C1), **no** trigger (D1). A1 (LF 88) shows `rls_enabled=true` + zero C1 policies ⇒ RLS deny-all for non-bypass roles; the broad anon/auth grants (A7 LF 1923–1936) are inert under that posture and vanish with the table.
- Runtime is already repointed: `review-session-routes.ts:893` reads canonical `tutor_messages`, not `tutor_interactions`.
- Statement: `DROP TABLE IF EXISTS public.tutor_interactions;` (RESTRICT-safe; no `CASCADE` needed). A full-table drop strictly supersedes the never-applied column-ALTER and satisfies the no-verbatim invariant (Coding Standards §12.2) more completely.

### 6.2 HY-02 — drop caller-free orphan functions (and the function/table split)

Verified zero repo callers (grep over `*.ts|*.tsx|*.js`, HEAD 3425535; the only
hits are the dead `database/supabase-vector-setup.sql` definitions and test
fixtures). **Drop these 14 (signatures from capture B1, LF 4090–4148):**

| Function (signature) | B1 LF |
|---|---|
| `create_vectors_table_if_not_exists()` | 4095 |
| `enqueue_render_pages_if_missing(uuid, text, text, text, text, integer)` | 4097 |
| `enqueue_render_pages_if_missing(uuid, jsonb)` | 4098 |
| `enqueue_render_pages_if_missing(uuid, boolean, jsonb)` | 4099 |
| `enqueue_render_pages_if_missing_v2(uuid, jsonb, boolean)` | 4100 |
| `match_vectors(vector, double precision, integer)` | 4121 |
| `v4_acquire_worker_lock(text, timestamptz)` | 4140 |
| `v4_debug_queue_schema()` | 4141 |
| `v4_increment_cluster_usage(uuid, integer)` | 4142 |
| `v4_mark_style_pages_used(uuid[])` | 4143 |
| `v4_queue_reset_stale_locks(integer)` | 4144 |
| `v4_release_worker_lock(text)` | 4145 |
| `v4_renew_worker_lock(text, timestamptz)` | 4146 |
| `v4_set_primary_cluster(uuid, uuid, numeric)` | 4147 |

**Function/table split — two functions deferred to WS-7, by design.** The
registry's `ingestion_v4_*/v4_* (10)` = the 8 `v4_*` above **plus** the two
**trigger** functions `update_ingestion_v4_jobs_updated_at()` and
`update_ingestion_v4_queue_updated_at()` (B1 LF 4133–4134). Those two are **not
caller-free** — they back `updated_at` triggers on the `ingestion_v4_jobs` /
`ingestion_v4_queue` tables, which are **GAP-HY-01 / WS-7** legacy tables, out of
WS-1 scope. Dropping them now would require `CASCADE` (orphaning triggers on
surviving tables) and leave a half-dropped family. They are therefore dropped
**with their tables in WS-7**, where the table drop removes the triggers first.
This keeps WS-1 to genuinely caller-free, table-uncoupled objects. (Bodies of the
14 above *reference* the dead `ingestion_v4_*` tables but Postgres does not
hard-track plpgsql body references, so their drops do not block.)

**Registry discrepancies to record (not silently resolved):**
- The registry names a bare `vectors` function; capture B1 has only `match_vectors`
  and `create_vectors_table_if_not_exists` — **no `vectors()` exists**. The
  drop-set is the 14 enumerated; `vectors` is treated as a registry shorthand for
  the `vector`-family, not a missing object.
- `match_questions` (×3 overloads, B1 LF 4118–4120) is **kept** — it is the RAG
  question-search path, not in HY-02's list.

### 6.3 CI-test coordination (mandatory, or CI breaks)

`tests/ci/tutor-interactions.no-verbatim.contract.test.ts` assertion #3 (L77–84)
`read()`s `supabase/migrations/20260606_tutor_interactions_drop_verbatim.sql` and
asserts the `ALTER TABLE … DROP COLUMN message/answer`. Once that file is archived
(§5) the `read()` throws → CI fails. WS-1 **must** rewrite assertion #3 to target
`20260608_ws1_provenance_drops.sql` and assert the full-table drop
(`/DROP TABLE\s+(IF EXISTS\s+)?public\.tutor_interactions/i`). Assertions #1
(flag gone), #2 (dead writer gone), #4 (bridge reads `tutor_messages`) are
unchanged and already pass. The rewritten guard is strictly stronger (no table ⇒
no verbatim columns).

## 7. D5 — CI gate: no object without source

CI **cannot** hold `service_role`/prod creds (standing rule), so it proves
self-consistency from scratch; the prod comparison is the owner's exit proof.

**Layer A — schema self-consistency (every PR, throwaway Postgres):**
apply the full pipeline (`00000000000000_baseline.sql`, then the WS-1 drops, then
any later) to a fresh DB; dump `public`; compare (normalized) to a committed
golden snapshot `public-schema.expected.sql`. Drift between the applied schema
and the committed snapshot fails CI — this is the durable
"no DB object without repo SQL" guard going forward: any prod object added later
without a migration cannot reproduce the snapshot.

**Layer B — structural lint (every PR):** every `supabase/migrations/*.sql`
matches `^[0-9]{14}_.*\.sql$`; no stray `.sql` in the pipeline dir; `drizzle.config.ts`
absent; no `drizzle-*` in `package.json` deps (severance guard, §4).

**Exit proof (owner-run, recorded once at apply — NOT a CI job):**
`supabase db diff --linked --schema public` after applying the WS-1 drops to prod
returns **empty**. Output is attached to the closure PR as evidence. This is the
GAP-OP-05 / closure-plan WS-1 exit proof (LF 29: "between a from-scratch migration
apply and production = empty (modulo data)").

## 8. Open decisions for owner / Codex (resolve before D2–D4 land)

1. **§8.1 Dependency removal approval.** Severance removes `drizzle-orm`,
   `drizzle-zod`, `drizzle-kit` from `package.json` (+ lockfile). CLAUDE.md bars
   dependency changes without approval. Confirm removal.
2. **§8.2 Legacy-migration disposition.** Archive the ~60 pre-baseline files to
   `…/legacy-migrations-preBaseline/` (recommended — audit evidence) vs delete
   (rely on git history). Confirm.
3. **§8.3 HY-02 function/table split.** Confirm deferring
   `update_ingestion_v4_jobs_updated_at` / `update_ingestion_v4_queue_updated_at`
   to WS-7 (dropped with their HY-01 tables), so WS-1 drops the 14 caller-free
   functions only. Registry footnote to be added at closure.
4. **§8.4 `vectors` reconciliation.** Confirm the 14-function drop-set is complete
   and the registry's bare `vectors` is shorthand (no such object in the capture).

## Appendix A — WS-1 forward drop SQL (draft, owner-applied)

```sql
-- @spec [Gap-Registry_V1.1, GAP-TU-09] [Gap-Registry_V1.1, GAP-HY-02]
-- @implemented [2026-06-08] | plain English: fold the two proven-dead DB drops
-- carried into WS-1 onto the provenance baseline. tutor_interactions is a dead,
-- 0-row, verbatim-bearing audit side-table (runtime already reads tutor_messages);
-- the orphan v4_*/vector/enqueue functions have zero callers. Idempotent.

-- TU-09 — verbatim-bearing dead table (no FK/RLS/trigger dependents)
DROP TABLE IF EXISTS public.tutor_interactions;

-- HY-02 — caller-free orphan functions (14). The two update_ingestion_v4_* trigger
-- functions are intentionally NOT dropped here — they back triggers on the HY-01
-- ingestion_v4_* tables and are retired with those tables in WS-7.
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

-- ----------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED (INV-06: every-migration-has-rollback)
-- Rollback: re-create from baseline source (the dropped objects' definitions
-- live in 00000000000000_baseline.sql history / capture B2). These are proven-dead
-- objects; rollback is provenance-restore only, not a runtime dependency.
-- ----------------------------------------------------------------------------
```

## Appendix B — Key capture citations (LF + verbatim anchor)

- MA-03 RPC body present: LF 4234 `### apply_learning_event_to_mastery(...)`; LF 4236 `CREATE OR REPLACE FUNCTION public.apply_learning_event_to_mastery(...)`; B1 tagline LF 4087 `Canonical DB-owned mastery/KPI/projection writer.`
- 0 applied migrations: LF 8096–8099 `(0 applied migrations recorded)`.
- Audit scope public: LF 8163 `## I5 — Schema inventory (context only; audit scope remains public)`.
- `vector` in public: LF 8074 `| vector | 0.8.0 | public |`.
