# PR-2 Audit: 05D Backfill Recompute + Q4 TODO Closure + Q2 Atomicity

| Field | Value |
|---|---|
| **Audit date** | 2026-06-24 |
| **Grounded against** | Live function bodies (post-PR-1), genesis-schema.expected.sql, locked Doc 05D V1.0 §7/§8 |
| **Status** | READ-ONLY AUDIT — no code yet |

---

## 1. Live Function Inventory (Post-PR-1, Verbatim Grounded)

### 1.1 `recompute_skill_mastery` — 05A-owned
**File:** `supabase/migrations/20260610010000_ws3_mastery_formula.sql:323`
**Signature:** `(p_student_id uuid, p_section text, p_domain text, p_skill text) RETURNS student_skill_mastery`

**Body summary (grounded):**
1. `SET LOCAL lock_timeout = '5s'`
2. Advisory xact lock: `hashtext(p_student_id||'|'||p_section||'|'||p_domain||'|'||p_skill)`
3. Canonicalize constants + hash
4. `compute_mastery_for_entity(p_student_id, 'skill', p_section, p_domain, p_skill)`
5. UPSERT `student_skill_mastery`
6. NULL-state block (lines 359-365): if v_row.student_id IS NULL → UPDATE to NULL mastery
7. **TODO(05B) comment (lines 366-368):** `refresh_domain_mastery` NOT wired. Fan-out absent.
8. `RETURN v_row`

**Critical gap:** The function is skill-only. No downstream chain. The TODO is the Q4 target.

### 1.2 `apply_mastery_event` — 05A-owned
**File:** `supabase/migrations/20260613000000_lane_c_mastery_seam.sql:83`
**Signature:** `(p_student_id uuid, p_section text, p_domain text, p_skill text, p_difficulty smallint, p_source_family text, p_event_source_kind text, p_correct boolean, p_occurred_at timestamptz, p_event_id uuid, p_question_id text, p_section_state text DEFAULT NULL) RETURNS student_skill_mastery`

**Body summary (grounded):**
1. §4.2 validation (required fields, enums, cross-field, source-kind→family mapping)
2. §4.3 event-level advisory lock: `hashtext('mastery_event|'||p_event_source_kind||'|'||p_event_id)`
3. Audit-log dedup lookup
4. §4.4 student-skill advisory lock: `hashtext(p_student_id||'|'||p_section||'|'||p_domain||'|'||p_skill)`
5. Self-enforcing seam guard (LC-D1-001)
6. §4.5 constants + hash
7. §4.6 `compute_mastery_for_entity`
8. §4.7 before-state + UPSERT `student_skill_mastery`
9. §4.8 audit INSERT into `mastery_event_audit_log`
10. **§4.9 downstream chain (line 238):** `PERFORM public.refresh_domain_mastery(p_student_id, p_section, p_domain);`
11. **§4.9 projection throttle (line 239):** `PERFORM public.bump_projection_refresh_counter(p_student_id, p_section);`
12. §4.10 RETURN

**Critical gap (Q2):** Does NOT `SET LOCAL app.mastery_refresh_trigger = 'event'` before calling `refresh_domain_mastery`. The GUC resolves to NULL on the event path today.

### 1.3 `refresh_domain_mastery` — 05B-owned
**File:** `supabase/migrations/20260613010000_05b_domain_mastery_kpi.sql:840`
**Signature:** `(p_student_id uuid, p_section text, p_domain text) RETURNS student_domain_mastery`

**Body summary (grounded):**
1. §4.2 validation + §4.2/4.3 domain canonicality check
2. §4.3 advisory xact lock: `hashtext('mastery_domain|'||p_student_id||'|'||p_section||'|'||p_domain)`
3. §4.4 constants + hash
4. §4.5 `compute_mastery_for_entity('domain', p_section, p_domain, NULL)`
5. §4.6 before-state
6. §4.7 argmax last_event + UPSERT `student_domain_mastery`
7. **§4.8 audit INSERT (lines 947-956):** writes `triggered_by = current_setting('app.mastery_refresh_trigger', true)` — resolves to NULL if GUC not set
8. §4.9 downstream KPI chain: `refresh_section_kpi`, `refresh_domain_kpi`, `refresh_skill_kpi`, `refresh_overall_kpi`
9. §4.10 RETURN

**Confirmed:** Audit-write side already wired. `triggered_by` reads the GUC.

### 1.4 `bump_projection_refresh_counter` — 05C-owned
**File:** `supabase/migrations/20260613020000_05c_section_projection.sql:831`
**Signature:** `(p_student_id uuid, p_section text) RETURNS void`

Upsert-and-increment counter; fires `compute_section_projection` for both M/RW when threshold met.

### 1.5 `canonical_mastery_events` — 05A-owned (per-entity)
**File:** `supabase/migrations/20260613000000_lane_c_mastery_seam.sql:33`
**Signature:** `(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text) RETURNS TABLE(...)`

SQL function. UNION ALL of practice_session_items (answered) + review_error_attempts.

### 1.6 `canonical_mastery_events_for_student` — DOES NOT EXIST
**Required by:** §7.2 backfill driver iteration (R3 accessor)

### 1.7 `backfill_recompute_student` — DOES NOT EXIST
**Required by:** §7.2

### 1.8 `mastery_domain_refresh_audit_log` — LIVE TABLE
**File:** `supabase/migrations/20260613010000_05b_domain_mastery_kpi.sql:245`

| Column | Live | Spec §4.2 | Gap |
|---|---|---|---|
| `triggered_by` | `text` (nullable, NO CHECK) | `text NOT NULL CHECK (triggered_by IN ('event','backfill_recompute'))` | **Q2 target** |
| `last_event_id` | ABSENT | `uuid NULL` | Missing column (spec RB-05B-V1-08) |
| `last_event_occurred_at` | ABSENT | `timestamptz NULL` | Missing column (spec RB-05B-V1-08) |

**Row count:** ZERO rows in prod. No data migration needed for CHECK or NOT NULL.

---

## 2. Call-Graph Analysis

### 2.1 CURRENT: Event Path (`apply_mastery_event`)

```
apply_mastery_event(student, section, domain, skill, ...)
  │ [NO GUC SET — app.mastery_refresh_trigger = NULL]
  ├─ lock event-level
  ├─ lock skill-level  ← hashtext(student|section|domain|skill)
  ├─ compute + UPSERT student_skill_mastery
  ├─ INSERT mastery_event_audit_log
  ├─ PERFORM refresh_domain_mastery(student, section, domain)
  │    ├─ lock domain-level  ← hashtext('mastery_domain|'...|section|domain)
  │    ├─ compute + UPSERT student_domain_mastery
  │    ├─ INSERT mastery_domain_refresh_audit_log  [triggered_by = NULL ← BUG]
  │    ├─ refresh_section_kpi(student, section)
  │    ├─ refresh_domain_kpi(student, section, domain)
  │    ├─ refresh_skill_kpi(student, section, domain)
  │    └─ refresh_overall_kpi(student)
  └─ PERFORM bump_projection_refresh_counter(student, section)
       └─ (threshold-gated) compute_section_projection × 2
```

**Lock acquisition order:** event → skill → domain (consistent, no deadlock)

### 2.2 CURRENT: Recompute Path (`recompute_skill_mastery`)

```
recompute_skill_mastery(student, section, domain, skill)
  ├─ lock skill-level  ← hashtext(student|section|domain|skill)
  ├─ compute + UPSERT student_skill_mastery
  ├─ NULL-state block
  ├─ TODO(05B): refresh_domain_mastery NOT called  ← GAP
  └─ RETURN
```

**No downstream chain.** Skill/domain drift occurs when recompute updates a skill but domain mastery is stale.

### 2.3 PROPOSED (Q4 wired, UNCONDITIONAL fan-out) — REJECTED

```
recompute_skill_mastery(student, section, domain, skill)
  ├─ lock skill-level  ← hashtext(student|section|domain|skill)
  ├─ compute + UPSERT student_skill_mastery
  ├─ NULL-state block
  ├─ PERFORM refresh_domain_mastery(student, section, domain)  ← NEW
  │    └─ lock domain-level  ← HELD UNTIL COMMIT (xact lock)
  └─ PERFORM bump_projection_refresh_counter  ← NEW
```

**Backfill call graph with unconditional fan-out (K skills in domain D):**

```
backfill_recompute_student(student)
  ├─ lock backfill
  ├─ Step 1: FOR each missing (sec,dom,skl):
  │    ├─ recompute_skill_mastery(student, M, Algebra, LinearEqs)
  │    │    ├─ lock skill(M,Algebra,LinearEqs)       ← HELD
  │    │    └─ refresh_domain_mastery(student, M, Algebra)
  │    │         └─ lock domain(M,Algebra)            ← HELD
  │    ├─ recompute_skill_mastery(student, M, Algebra, Quadratics)
  │    │    ├─ lock skill(M,Algebra,Quadratics)       ← HELD
  │    │    └─ refresh_domain_mastery(student, M, Algebra)  ← 2ND FIRE (same domain)
  │    │         └─ lock domain(M,Algebra) = already held, no-op
  │    └─ ... (K fires per domain)
  ├─ Step 2: FOR each missing domain:
  │    └─ (all domain rows already created by step 1 → NOT EXISTS = false → NO-OP)
  ├─ Step 3: terminal KPI refresh
  └─ Step 4: terminal projection refresh
```

**Two problems with unconditional fan-out:**

**Problem A — K-per-domain domain refresh:** For a domain with K missing skills, `refresh_domain_mastery` fires K times (each running `compute_mastery_for_entity` + 4 KPI refreshers). Idempotent but O(K×4) redundant KPI calls per domain. For 40 skills across 4 domains: ~160 KPI refreshes instead of ~16. Violates "exactly once per entity."

**Problem B — DEADLOCK (critical):**

```
DEADLOCK SCENARIO:
  T1 (backfill): holds skill(M,Algebra,LinearEqs) + domain(M,Algebra)
                  → tries skill(M,Algebra,Quadratics)  ← BLOCKED by T2
  T2 (event):    holds skill(M,Algebra,Quadratics)
                  → tries domain(M,Algebra)             ← BLOCKED by T1
  → CIRCULAR WAIT → DEADLOCK
```

Because backfill interleaves skill + domain lock acquisitions within one long transaction, and a concurrent event for a different skill in the same domain acquires skill → domain in the normal order, the classic AB/BA deadlock arises. Postgres detects it after `deadlock_timeout` (default 1s) and aborts one transaction.

**This eliminates unconditional fan-out for backfill usage.**

### 2.4 PROPOSED (Q4 wired, CONDITIONAL fan-out) — RECOMMENDED

```
recompute_skill_mastery(student, section, domain, skill,
                        p_chain_downstream boolean DEFAULT true)
  ├─ lock skill-level
  ├─ compute + UPSERT student_skill_mastery
  ├─ NULL-state block
  ├─ IF p_chain_downstream THEN
  │    ├─ SET LOCAL app.mastery_refresh_trigger =
  │    │    COALESCE(NULLIF(current_setting('app.mastery_refresh_trigger',true),''),
  │    │            'backfill_recompute')
  │    ├─ PERFORM refresh_domain_mastery(student, section, domain)
  │    └─ PERFORM bump_projection_refresh_counter(student, section)
  │  END IF
  └─ RETURN
```

**Backfill call graph with conditional fan-out (p_chain_downstream=false):**

```
backfill_recompute_student(student, p_t_now)
  ├─ lock backfill
  ├─ SET LOCAL app.mastery_refresh_trigger = 'backfill_recompute'
  │
  ├─ Step 1: FOR each missing (sec,dom,skl):
  │    └─ recompute_skill_mastery(student, sec, dom, skl, false)
  │         ├─ lock skill(sec,dom,skl)                ← HELD
  │         ├─ compute + UPSERT student_skill_mastery
  │         └─ (no domain chain — p_chain_downstream=false)
  │
  ├─ Step 2: FOR each (sec,dom) with events but no domain row:
  │    └─ refresh_domain_mastery(student, sec, dom)
  │         ├─ lock domain(sec,dom)                   ← HELD
  │         ├─ compute + UPSERT student_domain_mastery
  │         ├─ INSERT audit (triggered_by='backfill_recompute' via GUC)
  │         └─ 4 KPI refreshers
  │
  ├─ Step 3: terminal KPI refresh
  │    ├─ refresh_section_kpi(student, 'M', p_t_now)
  │    ├─ refresh_section_kpi(student, 'RW', p_t_now)
  │    └─ refresh_overall_kpi(student, p_t_now)
  │
  └─ Step 4: terminal projection refresh
       ├─ compute_section_projection(student, 'M', p_t_now)
       └─ compute_section_projection(student, 'RW', p_t_now)
```

**Lock acquisition order:** backfill → all skills (step 1) → all domains (step 2) → KPI/projection

**No deadlock:** Skills are acquired first without any domain locks. By the time domain locks are acquired in step 2, all skill locks are already held. A concurrent event for the same student:
- Event acquires skill lock → BLOCKED (backfill holds it) → waits → backfill finishes → event proceeds
- No circular dependency possible

**Single-fire per entity:**
- Each skill: computed exactly once (step 1, NOT EXISTS filter)
- Each domain: refreshed exactly once (step 2, NOT EXISTS filter — step 1 doesn't create domain rows)
- KPI: refreshed per-domain in step 2 chain + terminal pass in step 3
- Projection: refreshed exactly once in step 4

**Standalone callers of `recompute_skill_mastery`:** get the full chain via `DEFAULT true` — matches `apply_mastery_event`'s §4.9 behavior. The function is a complete skill→domain→KPI→projection chain for non-backfill callers.

---

## 3. Gap-Closure Plan (Numbered Steps)

### STEP 1: Q4 — Close the TODO (05A-owned edit)

**Spec cite:** Doc 05A §5.1 / Q4=(a) ruling (full chain)
**File:** `supabase/migrations/20260610010000_ws3_mastery_formula.sql` — `recompute_skill_mastery`
**Edit:** CREATE OR REPLACE — surgical replacement of the exact current body

Changes to `recompute_skill_mastery`:
1. Add parameter: `p_chain_downstream boolean DEFAULT true`
2. After the NULL-state block (line 365), before RETURN:
   ```sql
   IF p_chain_downstream THEN
     SET LOCAL app.mastery_refresh_trigger = COALESCE(
       NULLIF(current_setting('app.mastery_refresh_trigger', true), ''),
       'backfill_recompute');
     PERFORM public.refresh_domain_mastery(p_student_id, p_section, p_domain);
     PERFORM public.bump_projection_refresh_counter(p_student_id, p_section);
   END IF;
   ```
3. Remove the TODO(05B) comment

**Signature change:** Additive (new optional parameter with DEFAULT). Old callers unaffected. REVOKE/GRANT must be updated to the new 5-parameter signature.

**Owner annotation needed:** Karl must annotate Doc 05A §5.1 that the function now has `p_chain_downstream` and performs the full downstream chain when true (§4.9-matching). This is a 05A spec annotation for a 05D-driven edit.

### STEP 2: Q2 — CHECK + GUC Atomic (one migration)

**Spec cite:** Doc 05D §4.2 / Q2 ruling

Three changes in ONE migration:

**2a. GUC in `apply_mastery_event` (05A-owned edit):**
Add `SET LOCAL app.mastery_refresh_trigger = 'event';` before line 238 (the `refresh_domain_mastery` call).

**2b. GUC in `backfill_recompute_student` (new function, 05D-owned):**
`SET LOCAL app.mastery_refresh_trigger = 'backfill_recompute';` at the top of the function body (before any call to refresh_domain_mastery).

**2c. Column constraint on `mastery_domain_refresh_audit_log`:**
```sql
ALTER TABLE public.mastery_domain_refresh_audit_log
  ALTER COLUMN triggered_by SET NOT NULL;

ALTER TABLE public.mastery_domain_refresh_audit_log
  ADD CONSTRAINT mastery_domain_refresh_audit_log_triggered_by_check
  CHECK (triggered_by IN ('event', 'backfill_recompute'));
```

**NULL semantics (CTO-flagged):** Using `SET NOT NULL` rather than a CHECK-only approach. A naive `CHECK (triggered_by IN ('event','backfill_recompute'))` PASSES on NULL in Postgres (CHECK only fails on explicit FALSE; NULL evaluates to UNKNOWN which passes). `SET NOT NULL` plus the enum CHECK eliminates the NULL hole. Zero rows in prod → no data migration.

**Atomicity:** All three (apply_mastery_event GUC, backfill GUC, column constraint) land in ONE migration. After the migration, every write path sets the GUC, and the column rejects NULL.

### STEP 3: `canonical_mastery_events_for_student` (R3 — new function)

**Spec cite:** Doc 05D §7.2 / §11.B

Clean additive function. Returns DISTINCT `(section, domain, skill)` tuples for a student from the same source tables `canonical_mastery_events` reads:

```sql
CREATE OR REPLACE FUNCTION public.canonical_mastery_events_for_student(p_student_id uuid)
RETURNS TABLE (section text, domain text, skill text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT DISTINCT
        pi.question_section, pi.question_domain, pi.question_skill
    FROM public.practice_session_items pi
    WHERE pi.user_id = p_student_id AND pi.status = 'answered'
    UNION
    SELECT DISTINCT
        ra.section, ra.domain, ra.skill
    FROM public.review_error_attempts ra
    WHERE ra.student_id = p_student_id;
$$;
```

REVOKE PUBLIC + GRANT service_role. Consistent with `canonical_mastery_events` source derivation.

### STEP 4: `backfill_recompute_student` (§7.2 — new function)

**Spec cite:** Doc 05D §7.2, INV-05D-17, RB-05D-V1-04, RB-05D-V1-A

```
backfill_recompute_student(p_student_id uuid, p_t_now timestamptz DEFAULT now())
```

Implementation per §2.4 call graph above. Key design decisions:
- Advisory lock: `hashtext('backfill|'||p_student_id)`
- GUC: `SET LOCAL app.mastery_refresh_trigger = 'backfill_recompute'`
- Step 1: calls `recompute_skill_mastery(... , p_chain_downstream := false)`
- Step 2: calls `refresh_domain_mastery` directly (exactly once per domain)
- Step 3: terminal KPI refresh with `p_t_now`
- Step 4: terminal projection refresh with `p_t_now`
- Idempotent: re-run is byte-identical no-op (§7.5)

### STEP 5: §8 Determinism Harness

**Spec cite:** Doc 05D §8.1-8.5

SQL fixture proving:
1. **§8.2 determinism:** backfill → snapshot → delete → re-backfill → assert byte-identical
2. **§8.3 ordering:** post-backfill assertions (domain event_count, projection vs domain consistency, skill row existence)
3. **§8.4 constants-vintage:** event-path → change constant → assert hashes unchanged → new event → only touched rows advance

---

## 4. Single-Fire Reconciliation Proof

### 4.1 Entity-level single-fire (conditional fan-out, step 2 NOT EXISTS)

| Entity | Created/refreshed by | Count |
|---|---|---|
| Skill (missing) | Step 1: `recompute_skill_mastery(... , false)` | Exactly 1 per missing skill |
| Skill (exists) | Not touched | 0 |
| Domain (missing after step 1) | Step 2: `refresh_domain_mastery` | Exactly 1 per missing domain |
| Domain (exists) | NOT EXISTS filter eliminates | 0 |
| Section KPI | Step 2 chain + Step 3 terminal | 1+1 per section (idempotent) |
| Domain KPI | Step 2 chain only | 1 per domain |
| Skill KPI | Step 2 chain only | 1 per domain |
| Overall KPI | Step 2 chain + Step 3 terminal | 1+1 (idempotent) |
| Projection | Step 4 terminal only | 1 per section |

Step 3's terminal KPI refresh is a deliberate redundant pass (RB-05D-V1-04: "terminal surfaces refreshed unconditionally"). It ensures section/overall KPIs reflect final state even if some domains had pre-existing rows (step 2 skipped them). Idempotent upserts → no incorrect state.

### 4.2 Why step 2 is NOT redundant

With `p_chain_downstream=false`, step 1 creates ONLY skill rows — it does NOT create domain rows. Step 2's `NOT EXISTS (student_domain_mastery)` correctly selects all domains that need domain mastery rows. This separation is also critical for:

- **Partial-legacy case (D14):** All skills exist but domain row missing. Step 1 creates no skills (all exist, NOT EXISTS = false). Step 2 creates the domain row.
- **Clean single-fire:** No domain is refreshed more than once.

### 4.3 Lock-ordering deadlock proof

**Within a single backfill transaction (one student):**

Lock acquisition order: `backfill` → `skill₁` → `skill₂` → ... → `skillₖ` → `domain₁` → `domain₂` → ... → `domainD` → KPI/projection locks

All locks are `pg_advisory_xact_lock` (held until commit). Within a single session, re-acquiring an already-held lock is a no-op. The ordering is strictly monotonic: all skills before all domains. No interleaving → no circular dependency → **no deadlock within the transaction**.

**Cross-transaction (backfill vs concurrent event):**

| Transaction | Lock order |
|---|---|
| Backfill | backfill → skill_a → skill_b → ... → domain_x → domain_y → ... |
| Event | skill_z → domain_x |

For deadlock, both transactions must hold one lock and wait for another in opposite order.

- If backfill holds skill_z: event cannot acquire it → event waits → backfill proceeds → no deadlock
- If event holds skill_z: backfill would have blocked on skill_z in step 1 → backfill has NOT yet reached step 2 → backfill does NOT hold domain_x → event acquires domain_x freely → event finishes → backfill acquires skill_z → no deadlock
- Key insight: backfill cannot hold domain_x while waiting for skill_z, because skills are ALL acquired before ANY domain. The AB/BA deadlock is structurally impossible.

**Cross-student:** Different student_ids → different hash values → no lock contention.

---

## 5. 05A-Owned Edits Needing Karl Spec Annotations

| # | Function | Edit | Spec cite | Annotation needed |
|---|---|---|---|---|
| 1 | `recompute_skill_mastery` | Add `p_chain_downstream boolean DEFAULT true`; wire `refresh_domain_mastery` + `bump_projection_refresh_counter` under the conditional | 05A §5.1 / Q4=(a) | Karl must annotate 05A §5.1: function now has conditional downstream chain; `DEFAULT true` = full chain matching §4.9; backfill callers pass `false` |
| 2 | `apply_mastery_event` | Add `SET LOCAL app.mastery_refresh_trigger = 'event'` before the §4.9 calls | 05D §4.2 / Q2 ruling | Karl must annotate 05A §4.9: function now sets GUC for audit provenance |

Both are CREATE OR REPLACE on the moat write path — surgical edits to the exact current body.

---

## 6. Numbered Owner Questions

### Q-PR2-1: `p_chain_downstream` parameter name and semantics
The conditional parameter on `recompute_skill_mastery` gates the full downstream chain. **Proposed name: `p_chain_downstream`** (boolean, DEFAULT true). Alternative: `p_skip_domain_refresh` (inverted semantics). Which does Karl prefer?

### Q-PR2-2: GUC value for standalone `recompute_skill_mastery` calls
When `recompute_skill_mastery` is called standalone (not from backfill), `p_chain_downstream=true` fires `refresh_domain_mastery`. The function sets the GUC to `'backfill_recompute'` as a default (since standalone recompute IS a recompute operation, not an event). **Confirm this is correct**, or should we add a third `triggered_by` value (e.g., `'standalone_recompute'`)? Adding a third value requires a spec amendment to §4.2's locked enum.

### Q-PR2-3: `last_event_id` / `last_event_occurred_at` columns on audit log
The locked spec §4.2 requires `last_event_id uuid NULL` and `last_event_occurred_at timestamptz NULL` on `mastery_domain_refresh_audit_log`. The live table is MISSING both. The live `refresh_domain_mastery` function computes `v_last_event_id`/`v_last_event_occurred_at` for `student_domain_mastery` but does NOT write them to the audit log. **Should PR-2 add these columns and wire the INSERT**, or is this a separate PR? Adding them is additive (nullable columns, zero rows → no migration).

### Q-PR2-4: Backfill driver (§7.3) — scope for PR-2?
The §7.3 bounded batch driver is an outer loop (selects never-computed students, calls `backfill_recompute_student` per student, handles failures). **Is the driver in PR-2 scope**, or is PR-2 limited to the RPC + support functions? The RPC is independently testable without the driver.

### Q-PR2-5: Terminal KPI signature reconciliation
`refresh_domain_mastery` calls `refresh_section_kpi(student, section)` and `refresh_overall_kpi(student)` — using DEFAULT `now()` for `p_t_now`. The backfill step 3 calls `refresh_section_kpi(student, 'M', p_t_now)` with an explicit `p_t_now`. Within a single transaction, `now()` = transaction start time = `p_t_now` (when `p_t_now` uses the default). For the §8 harness with a fixed `p_t_now`, these may diverge if `p_t_now ≠ now()`. **Is this acceptable**, or should `refresh_domain_mastery` be modified to accept and pass through `p_t_now`?

### Q-PR2-6: Migration file naming
This PR creates new functions AND modifies existing 05A-owned functions. **Should all changes go in one new migration file** (e.g., `20260625000000_05d_backfill_recompute.sql`), or should 05A-owned function replacements go in a separate migration to maintain ownership boundaries?

---

## 7. Adjacent Findings (Out of PR-2 Scope Unless Karl Disagrees)

| # | Finding | Impact | Recommended action |
|---|---|---|---|
| AF-1 | `mastery_domain_refresh_audit_log` missing `last_event_id`, `last_event_occurred_at` per spec §4.2 (RB-05B-V1-08) | Audit trail incomplete per locked spec | Separate PR or fold into PR-2 per Q-PR2-3 |
| AF-2 | `refresh_domain_mastery` INSERT does not write `last_event_id`/`last_event_occurred_at` to audit log (only to `student_domain_mastery`) | Data computed but not persisted to audit | Fix alongside AF-1 |
| AF-3 | `mastery_domain_refresh_audit_log` precision is `numeric(5,4)` for score columns; `mastery_event_audit_log` uses `numeric(10,9)` | Precision mismatch between audit tables | Low priority; cosmetic if scores are in [0,1] |

---

## 8. Migration Dependency Order

All changes must land in a single migration (Q2 atomicity requirement) or a strictly ordered set:

```
Migration N: PR-2 main
  1. CREATE canonical_mastery_events_for_student  (new, additive)
  2. CREATE OR REPLACE recompute_skill_mastery     (Q4 closure + conditional param)
     → REVOKE/GRANT updated to 5-param signature
  3. CREATE OR REPLACE apply_mastery_event          (Q2 GUC)
     → Signature unchanged; REVOKE/GRANT unchanged
  4. ALTER mastery_domain_refresh_audit_log
     → ALTER COLUMN triggered_by SET NOT NULL
     → ADD CHECK (triggered_by IN ('event','backfill_recompute'))
  5. CREATE backfill_recompute_student              (new, 05D-owned)
     → REVOKE/GRANT
  6. CI GUARDS: single-fire proof, lock-order assertion, GUC assertion
```

Order matters: step 2 (recompute_skill_mastery) references `refresh_domain_mastery` which is already live. Step 3 (apply_mastery_event) GUC must be in place before step 4 (CHECK constraint) — otherwise any event arriving between step 4 and step 3 would write NULL and fail the NOT NULL constraint.

**Safe order:** steps 2+3 (function replacements with GUC) BEFORE step 4 (constraint). Within a single transaction (BEGIN/COMMIT), the order doesn't matter for concurrent connections — the constraint only applies after COMMIT.

---

## 9. Spec §7/§8 Compliance Matrix

| Spec requirement | Implementation status | Notes |
|---|---|---|
| §7.1 Never-computed only, NOT constants-change | `NOT EXISTS` selection in steps 1+2 | INV-05D-13 holds |
| §7.2 Skill step calls `recompute_skill_mastery` | Step 1 calls it (RB-05D-V1-A) | NOT `compute_mastery_for_entity` |
| §7.2 Domain step calls `refresh_domain_mastery` | Step 2 calls it | With GUC 'backfill_recompute' |
| §7.2 Dependency order: skill→domain→KPI→projection | Steps 1→2→3→4 | Strict; step 2 cannot precede step 1 |
| §7.3 Bounded batch, one txn per student | Driver (if in scope) | Q-PR2-4 |
| §7.4 Ordering assertion | CI guard in migration | Post-backfill consistency check |
| §7.5 Idempotent (re-run = no-op) | NOT EXISTS + deterministic upsert | Step 1: NOT EXISTS false on re-run; step 2: same; steps 3-4: idempotent upserts |
| §8.2 Byte-identical recompute | Harness fixture | D13 scenario |
| §8.3 Ordering verification | Harness fixture | Post-backfill assertions |
| §8.4 Constants-vintage (no-recompute proof) | Harness fixture | D7/D8 scenarios |

---

**STOP. No code until this plan is audited together.**
