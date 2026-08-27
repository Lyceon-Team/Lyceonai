# WS-GL Phase B — referrals out

Two pieces of work Phase B identified, scoped, and did **not** do. Each is referred with a written
scope because handing over "there's a problem here" without the boundary is how a finding becomes
nobody's job.

Neither is a spec change. Neither needs an SCL. Both need an owner.

---

## 1. Rate-limit config alignment — the seven live `tutor_*` rows

**Referred because it is LISA's surface, not WS-GL's.** WS-GL's substituted authority (Charter §0)
covers the guardian surface. LISA's config read path is out of it, and this work cannot be split
across the boundary without breaking something.

### The divergence

The owner has ruled spec canonical without exception. Doc 01A Appendix A.3 (heading verified:
`## **A.3 `rate_limit_runtime_config`**`) makes `bucket_definitions` — one row holding a
`bucket_key → { limit, window_seconds }` map — the canonical shape.

Production holds a different shape: **seven rows, all `tutor_*`, one row per bucket**, with the
limit as a scalar `value`. That form is not in the spec.

```
-- observed 2026-08-25, production
tutor_burst_5min        30   integer  product  'Doc 03B §15.2: …'   all
tutor_turns_daily      120   integer  product  …                    all
…  (7 rows, all tutor_*)
```

### Why the two halves must land together

| Half | Who | What |
|---|---|---|
| DML | **Owner** | Move the seven rows into `bucket_definitions` as a map; delete the ad-hoc rows |
| Code | **A LISA-scoped workstream** | Repoint LISA's config read at the canonical shape; remove every non-spec-aligned reference to the retired form; rebuild the tests spec-first |

Landing either alone breaks LISA's config reads. **That coordination is the entire risk**, and it is
why this is one referral rather than two.

### The timing argument — true now, false later

LISA has never served a production turn. Those seven rows have therefore never rate-limited anything,
and there is no live behaviour to preserve across the migration. That makes this the cheapest it will
ever be. It stops being true at the first real tutor turn, after which the same migration has to
preserve in-flight quota state.

### WS-GL is the working reference

WS-GL's own buckets — `guardian_link_attempts_daily` and the `guardian_link_email_attempts:<digest>`
family — are built against `bucket_definitions` and are therefore already spec-shaped.
**WS-GL is the first correct consumer of this primitive.** The canonical wrapper
(`packages/shared/src/services/rate-limit-ledger.ts`) and its consumer
(`server/middleware/guardian-link-rate-limit.ts`) are the pattern the LISA alignment should be built
against, not a second parallel approach.

### What Phase B deliberately did NOT do

- Did not migrate the seven rows.
- Did not reshape any live config.
- Did not touch LISA's config read path.
- Did not silently convert either side.

### One value in those rows is separately contested

`tutor_turns_daily` reads **120** in production and in Doc 03 §13.1 ("V1 Locked"), and **100** in
Doc 01A Appendix A.3's launch seed. SCL-053 (`docs/SpecAudit/SPEC_CHANGES_LOG.md`, `PROPOSED`)
records Doc 03 as canonical and identifies the defect as Appendix A.3 **restating a constant another
document owns**. The amendment it asks for is removal of the tutor constant from A.3, not a change of
its value. Whoever performs this migration should carry 120 and should not treat A.3's seed as a
source for it.

---

## 2. CI — PG-requiring tests are enrolled by memory, not by configuration

**Referred as a CI-workstream item.** Phase B added the required job step by hand
(`.github/workflows/ci.yml`, "Guardian link surface → real PG proof"), so this referral is about the
mechanism, not about one test.

### The defect

Every PG-requiring test is named **individually** as its own workflow step:

```
294: run: pnpm exec vitest run tests/ci/diagnostic.handler-pg.ci.test.ts
307: run: pnpm exec vitest run tests/ci/entitlement-write-path.ci.test.ts
```

No job runs `tests/ci/` as a directory with Postgres available. So a new PG-requiring test executes
in **no job at all** until a human remembers to add a step for it — and CI reports green either way,
because the job it belongs in passed without it.

This is not hypothetical. `tests/ci/guardian-link.pg.ci.test.ts` was added in Stage 3 Phase A and sat
unexecuted; the `practice-integration` job — the one job with a live Postgres service — went green
across multiple runs without ever running it. **A gate that reports green while not running is worse
than no gate**, because it is counted as coverage.

It is the same defect class as G-42's five orphaned billing tests, reached the same way: enrolment by
memory rather than by configuration.

### A second instance, found the same way — `server/__tests__/` runs in NO CI job

`package.json` defines `"test:ci": "vitest run tests/ci"`. The workflow runs `test:ci`,
`test:security` (two named files), `test:shared` and `test:integration`. Nothing runs bare
`vitest run`.

So **`server/__tests__/` — 6 files, 89 tests — executes in no CI job at all.**

Phase B found this by accident: a fixture in `server/__tests__/guardian-payment-access.test.ts`
still used `guardian_links.student_user_id`, a column that exists on no table. The test had been
passing on the wrong branch of the resolver — it asserted the "linked but not premium" reason string
while the fixture actually produced the "no linked student" path. Nothing caught it because nothing
ran it. Phase B fixed the fixture and the assertion now exercises the path it names.

Whatever fixes the PG-enrolment problem should fix this at the same time: the suite roster belongs in
configuration, not in whoever last remembered to add a script.

### Proposed fix

One job that runs the PG-requiring suite **as a directory**, so new tests are covered by existing
configuration:

- A naming convention that identifies the suite (`*.pg.ci.test.ts` is already emerging), and a single
  step running the glob with `PGHOST` set.
- Tests that do not need PG keep skipping themselves via `PG_AVAILABLE`, which they already do.
- The individually-named steps can then go, or stay as fast-fail shortcuts — either is fine once the
  directory run exists.

Whoever takes this should confirm the fix by adding a throwaway PG test that fails, pushing, and
observing CI red **without editing the workflow**. If that does not go red, the fix is not done.

### Folded into the same referral — two `pg-supabase.ts` consolidation candidates

`tests/helpers/pg-supabase.ts` was extracted in Stage 3 Phase A because two independent copies of the
same Supabase-over-pg shim already existed with no shared helper. The extraction was made; the two
copies were **reported, not edited**, because they belong to other surfaces:

| `file` | Surface | Note |
|---|---|---|
| `tests/ci/entitlement-write-path.ci.test.ts` | Entitlement / Stripe | Out of WS-GL's edit scope (Charter §0) |
| `tests/ci/diagnostic.handler-pg.ci.test.ts` | Diagnostic | Out of WS-GL's edit scope |

Both can now consume `tests/helpers/pg-supabase.ts`. Three copies of one shim is a divergence
`CLAUDE.md` forbids by name; it survives only because no single workstream owns all three.

### Also folded in — a second `rate-limit-ledger` implementation

`apps/api/src/lib/rate-limit-ledger.ts` exists and writes the ledger through its own RPC calls
(`p_student_user_id` at :167, :197, :227, :258). Doc 01A §47's deviation box names it directly —
*"`apps/api/src/lib/rate-limit-ledger.ts` exists and implements the core ledger pattern"* — and
migration-path step 3 is "migrate all call sites", with cutover criterion (c) requiring that
`RateLimitLedger` be **the only path writing the `rate_limit_ledger` table**.

Phase A completed step 1 (the canonical wrapper) and step 2 (deleting `durable-rate-limiter.ts`).
Step 3 is not done: this second implementation still writes the table. It is LISA/practice surface,
so it belongs with referral 1 rather than with WS-GL.

### Also folded in — two sha256-truncate digest copies

The same shape, one layer down. `packages/shared/src/services/subject-digest.ts` was extracted in
Phase B for the per-email bucket key. Two prior copies remain:

| `file:line` | Surface | Note |
|---|---|---|
| `server/routes/guardian-consent-routes.ts:18` (`digest8`) | Guardian consent | WS-GL Phase **D**'s surface, not Phase B's |
| `server/lib/stripe/redact.ts:27` | Stripe | Out of WS-GL's edit scope |

The consent one is WS-GL's to consolidate in Phase D. The Stripe one needs an owner.
