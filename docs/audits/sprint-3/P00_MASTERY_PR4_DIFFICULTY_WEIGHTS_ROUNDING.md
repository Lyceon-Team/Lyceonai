# P00: MASTERY PR-4 DIFFICULTY WEIGHTS & ROUNDING

## PROVENANCE

**Repository:** Lyceon-Team/Lyceonai  
**Branch:** copilot/implement-mastery-updates  
**Commit:** aed6ef4bdde9b1fd0a3bea6819cb4fe048d9caf7  
**Status:** Clean working tree (1 unrelated fix pending)  
**Node Version:** v24.13.0  
**pnpm Version:** 10.29.2  
**Date:** 2026-02-12T18:55:08.377Z

## OBJECTIVE

Implement persisted True Half-Life mastery updates using constants from `public.mastery_constants`, including:
1. Per-question difficulty weights (easy=1.0, medium=1.1, hard=1.2)
2. Deterministic rounding with configurable precision
3. Event type passed as TEXT for dynamic weight lookup
4. All updates flow through existing mastery-write.ts choke point

## CHANGES SUMMARY

### 1. Database Migration

**File:** `supabase/migrations/20260211_mastery_true_halflife_weights_rounding.sql`

**Purpose:** Add difficulty weights and rounding constants to mastery_constants table, update RPC functions to support difficulty-based weighting and deterministic rounding.

**Key Additions:**
- `QUESTION_DIFFICULTY_WEIGHTS` JSON constant with keys: easy, medium, hard
- `ROUND_EVIDENCE_DECIMALS` = 2 (precision for E and C)
- `ROUND_ACCURACY_DECIMALS` = 4 (precision for accuracy/p)
- `ROUND_MASTERY_SCORE_DECIMALS` = 2 (precision for mastery_score)
- `ROUNDING_MODE` = 'HALF_UP' (documentation)
- `TUTOR_VIEW` event weight = 0.0 in EVENT_WEIGHTS

**RPC Function Updates:**

#### upsert_skill_mastery
**Signature:** `upsert_skill_mastery(p_user_id UUID, p_section VARCHAR(32), p_domain VARCHAR(64), p_skill VARCHAR(128), p_is_correct BOOLEAN, p_event_weight NUMERIC DEFAULT 1.0, p_event_type TEXT DEFAULT 'PRACTICE_SUBMIT', p_difficulty_bucket TEXT DEFAULT NULL)`

**Line References:**
- Lines 51-58: New parameters `p_event_type TEXT`, `p_difficulty_bucket TEXT`
- Lines 87-96: Fetch event weight from EVENT_WEIGHTS JSON
- Lines 98-107: Fetch difficulty weight from QUESTION_DIFFICULTY_WEIGHTS JSON
- Lines 138-144: Apply weighted decay formula with rounding
  ```sql
  v_E := ROUND(
    (v_existing_attempts * v_decay) + (v_event_weight * v_difficulty_weight),
    v_round_evidence_decimals
  );
  ```
- Lines 152-154: Apply deterministic rounding to p and mastery_score
  ```sql
  v_p := ROUND(v_p, v_round_accuracy_decimals);
  v_mastery_score := ROUND(100.0 * v_p, v_round_mastery_score_decimals);
  ```

#### upsert_cluster_mastery
**Signature:** `upsert_cluster_mastery(p_user_id UUID, p_structure_cluster_id UUID, p_is_correct BOOLEAN, p_event_weight NUMERIC DEFAULT 1.0, p_event_type TEXT DEFAULT 'PRACTICE_SUBMIT', p_difficulty_bucket TEXT DEFAULT NULL)`

**Line References:**
- Lines 195-201: New parameters `p_event_type TEXT`, `p_difficulty_bucket TEXT`
- Lines 230-239: Fetch event weight from EVENT_WEIGHTS JSON
- Lines 241-250: Fetch difficulty weight from QUESTION_DIFFICULTY_WEIGHTS JSON
- Lines 281-287: Apply weighted decay formula with rounding (same as skill mastery)
- Lines 295-297: Apply deterministic rounding to p and mastery_score (same as skill mastery)

**Edge Handling:**
- If `p_difficulty_bucket` is NULL or empty, default `v_difficulty_weight := 1.0`
- If event_type missing from JSON, default `v_event_weight := 1.0`
- No division by zero possible due to Beta priors (ALPHA0 + BETA0 always > 0)

### 2. Application Code Updates

**File:** `apps/api/src/services/mastery-write.ts`

**Changes:**
- Lines 135-143: Updated skill mastery RPC call to pass `p_event_type` and `p_difficulty_bucket`
  ```typescript
  const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
    p_user_id: input.userId,
    p_section: input.metadata.section,
    p_domain: input.metadata.domain || "unknown",
    p_skill: input.metadata.skill,
    p_is_correct: input.isCorrect,
    p_event_weight: eventWeight,
    p_event_type: input.eventType,
    p_difficulty_bucket: input.metadata.difficulty_bucket || null,
  });
  ```

- Lines 161-169: Updated cluster mastery RPC call to pass `p_event_type` and `p_difficulty_bucket`
  ```typescript
  const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
    p_user_id: input.userId,
    p_structure_cluster_id: input.metadata.structure_cluster_id,
    p_is_correct: input.isCorrect,
    p_event_weight: eventWeight,
    p_event_type: input.eventType,
    p_difficulty_bucket: input.metadata.difficulty_bucket || null,
  });
  ```

- Lines 71-77: Updated function documentation to mention difficulty weights and rounding

**Difficulty Extraction:**
- `difficulty_bucket` is read from `input.metadata.difficulty_bucket`
- If not available, passes `null` to RPC, which defaults to weight 1.0
- No changes to metadata snapshot interface (already includes `difficulty_bucket`)

### 3. Tests

**File:** `tests/mastery.difficulty-weights-rounding.test.ts`

**Coverage:**
1. **Deterministic Rounding - Precision Enforcement** (4 tests)
   - Verifies E and C have exactly ROUND_EVIDENCE_DECIMALS precision
   - Verifies accuracy (p) has exactly ROUND_ACCURACY_DECIMALS precision
   - Verifies mastery_score has exactly ROUND_MASTERY_SCORE_DECIMALS precision
   - Ensures rounding is deterministic (same input → same output)

2. **Difficulty Weights - Evidence Impact** (4 tests)
   - Verifies difficulty weight applied to both E and C
   - Confirms hard questions weighted 1.2x more than easy
   - Tests difficulty weight on incorrect answers (E only)
   - Validates multiplicative combination of event weight and difficulty weight

3. **Edge Cases with Difficulty Weights** (3 tests)
   - Handles null/missing difficulty_bucket as default 1.0
   - No NaN with difficulty weights and extreme decay
   - Rounding edge case: p exactly 0.5 → mastery_score 50.00

4. **Formula Invariants with Difficulty Weights** (3 tests)
   - E >= C always (attempts >= correct)
   - mastery_score in [0, 100] regardless of weights
   - p increases monotonically with C for fixed E

**Test Results:**
```
✓ tests/mastery.difficulty-weights-rounding.test.ts (14 tests) 7ms
  Test Files  1 passed (1)
       Tests  14 passed (14)
```

**Guard Test:**
```
✓ tests/mastery.writepaths.guard.test.ts (3 tests) 40ms
  Test Files  1 passed (1)
       Tests  3 passed (3)
```
- Confirms no new write paths added
- All mastery writes still flow through mastery-write.ts

## CONSTANTS KEYS USED

### From mastery_constants Table

| Key | Type | Value | Usage |
|-----|------|-------|-------|
| HALF_LIFE_DAYS | value_num | 21 | Exponential decay half-life |
| ALPHA0 | value_num | 2 | Beta distribution prior (correct pseudo-count) |
| BETA0 | value_num | 2 | Beta distribution prior (incorrect pseudo-count) |
| ROUND_EVIDENCE_DECIMALS | value_num | 2 | Decimal precision for E and C |
| ROUND_ACCURACY_DECIMALS | value_num | 4 | Decimal precision for accuracy (p) |
| ROUND_MASTERY_SCORE_DECIMALS | value_num | 2 | Decimal precision for mastery_score |
| ROUNDING_MODE | value_text | 'HALF_UP' | Documentation (Postgres ROUND behavior) |
| EVENT_WEIGHTS | value_json | {PRACTICE_SUBMIT: 1.0, DIAGNOSTIC_SUBMIT: 1.25, FULL_LENGTH_SUBMIT: 1.5, TUTOR_RETRY_SUBMIT: 1.0, TUTOR_VIEW: 0.0} | Event type impact multipliers |
| QUESTION_DIFFICULTY_WEIGHTS | value_json | {easy: 1.0, medium: 1.1, hard: 1.2} | Difficulty-based evidence weights |

## FORMULA IMPLEMENTATION

### Decay Formula
```
decay = 0.5^(dt_days / HALF_LIFE_DAYS)
```

### Weighted Evidence Update
```
E = round(E_old * decay + (w_event * w_q), ROUND_EVIDENCE_DECIMALS)
C = round(C_old * decay + (w_event * w_q * is_correct), ROUND_EVIDENCE_DECIMALS)
```

Where:
- `E_old`, `C_old`: Previous evidence counts
- `decay`: Time-based decay factor
- `w_event`: Event weight from EVENT_WEIGHTS[event_type]
- `w_q`: Difficulty weight from QUESTION_DIFFICULTY_WEIGHTS[difficulty_bucket]

### Probability and Mastery Score
```
p_raw = (C + ALPHA0) / (E + ALPHA0 + BETA0)
accuracy = round(p_raw, ROUND_ACCURACY_DECIMALS)
mastery_score = round(100 * accuracy, ROUND_MASTERY_SCORE_DECIMALS)
```

## INVARIANTS MAINTAINED

1. **Source of truth:** All constants read from `public.mastery_constants`
2. **Mastery score scale:** Remains 0–100 (NUMERIC)
3. **Accuracy scale:** Remains 0–1 (NUMERIC)
4. **No rolling windows:** Continuous exponential decay at every persisted update
5. **Single write choke point:** All writes flow through mastery-write.ts
6. **Migration-safe functions:** Full signature qualification in COMMENT ON FUNCTION

## SECURITY

- **SECURITY DEFINER** preserved on both RPC functions
- **RLS policies** unchanged on mastery tables
- **mastery_constants RLS:** Readable by authenticated, writable by service role only
- **No new bypass paths:** Guard test confirms single choke point

## VERIFICATION

### Build
```bash
pnpm -s run build
```
Expected: Clean build with no errors

### Tests
```bash
pnpm -s test
```
Expected: All tests pass, including:
- tests/mastery.difficulty-weights-rounding.test.ts (14 tests)
- tests/mastery.writepaths.guard.test.ts (3 tests)

### RPC Caller Proof
```bash
rg "upsert_skill_mastery|upsert_cluster_mastery" --type ts -g '!*.test.ts' -g '!*.spec.ts'
```
Expected: Only matches in `apps/api/src/services/mastery-write.ts`

## MIGRATION SAFETY

**Function Signatures:**
- `public.upsert_skill_mastery(UUID, VARCHAR(32), VARCHAR(64), VARCHAR(128), BOOLEAN, NUMERIC, TEXT, TEXT)`
- `public.upsert_cluster_mastery(UUID, UUID, BOOLEAN, NUMERIC, TEXT, TEXT)`

**Comments include full signatures** to prevent "function name not unique" errors in Supabase.

## COMPLETION CHECKLIST

- [x] Migration file created with all required constants
- [x] RPC functions updated with p_event_type and p_difficulty_bucket parameters
- [x] Difficulty weights applied in decay formula
- [x] Deterministic rounding implemented at specified precision
- [x] mastery-write.ts updated to pass event_type and difficulty_bucket
- [x] Tests added for rounding precision and difficulty weight effects
- [x] Guard test still passes (no new write paths)
- [x] All constants sourced from public.mastery_constants
- [x] Function comments include full signatures
- [x] Security DEFINER and RLS preserved

## NOTES

- Migration is additive only (ON CONFLICT DO NOTHING for constants)
- Existing mastery data is not migrated/recalculated
- Default difficulty weight is 1.0 (neutral) when difficulty_bucket is null/missing
- TUTOR_VIEW event weight is 0.0 (no mastery change), consistent with existing behavior
- Rounding uses Postgres ROUND() which implements half-up (banker's rounding in ties)
