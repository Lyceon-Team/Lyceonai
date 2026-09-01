# Guardian linking by student code — DDL/DML queue (SCL-080)

**Nothing here is applied, and nothing here is a migration file.**
`docs/plans/Stripe_Vertical_Session_Charter.md:79-81` reserves migrations to the owner and
directs every DDL need to a queue file with its reason: "The owner performs every one:
migrations, merges, secret rotation… Every DDL need goes to a queue file with its reason…
do not author the migration."

NOTE, reported not resolved: that passage also says "The migration freeze (WS-M) is in force",
but `docs/plans/WS-M_Migration_Integrity.md` was DELETED from `stripe` on 2026-09-01
(`aa4fd40`). The Charter's instruction stands on its own and is what this file follows; the
dangling reference to a deleted document is an owner question, not something to resolve by
guessing which way it was meant.
These are authored, runnable, and verified against a throwaway PostgreSQL 16 with the full
migration pipeline applied — but they are deliberately NOT in `supabase/migrations/`, because a
file there is applied automatically by `scripts/ci/genesis-fresh-apply.sh` and by the next person
to run the pipeline. Authoring them here keeps "author, never apply" literally true.

**Owner action:** apply D-6..D-9 in order. Until every one is applied, guardian linking by code
does not work in production — the routes are live but the objects they need do not exist.

Opened 2026-09-01 for SCL-080.

| # | Need | Blocking? |
|---|---|---|
| D-6 | Replace the link-creation function so it produces `status='active'`; drop the acceptance function | **Yes** — no path to an active link without it |
| D-7 | Re-key `unique_active_link` so a pair can be revoked more than once | **Yes** — second revocation raises 23505 |
| D-8 | `profiles.student_link_code_issued_at` so a TTL is computable | **Yes** — rotation cannot be evaluated |
| D-9 | DML: `bucket_definitions` map + `auth_runtime_config` TTL key | **Yes** — every guardian route 503s on an unseeded bucket |

---

## D-6 — link creation produces an ACTIVE link; acceptance is deleted

**Why.** `create_guardian_link_audited` hardcodes the pending status
(`supabase/migrations/20260828000000_guardian_link_audited_transitions.sql:88-91`):

```sql
v_status := CASE p_initiated_by WHEN 'guardian' THEN 'pending_student_accept'
                                ELSE 'pending_guardian_accept' END;
```

There is no path through it to `active`. It also owns the audit write and the `LY004`
duplicate guard, so bypassing it in TypeScript would fork link creation into two
implementations and lose the audit trail — which `CLAUDE.md` forbids by name. SCL-080 removes
the acceptance step entirely, so `accept_guardian_link_audited` has nothing left to settle.

```sql
-- Redeeming a code creates a LIVE link. The student's act of sharing is the consent
-- (SCL-080), so there is no second party to wait for and no pending status to pass through.
CREATE OR REPLACE FUNCTION public.create_active_guardian_link_audited(
  p_guardian_id  uuid,
  p_student_id   uuid,
  p_request_id   text DEFAULT NULL
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.guardian_links;
BEGIN
  IF p_guardian_id = p_student_id THEN
    RAISE EXCEPTION 'guardian and student must differ' USING ERRCODE = '22023';
  END IF;

  -- Edge case 2: already linked is a 409, not a duplicate row. Only 'active' is
  -- checked because SCL-080 leaves no reachable pending status.
  IF EXISTS (
    SELECT 1 FROM public.guardian_links
     WHERE guardian_profile_id = p_guardian_id
       AND student_profile_id  = p_student_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'link already exists' USING ERRCODE = 'LY004';
  END IF;

  INSERT INTO public.guardian_links
    (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at,
     accepted_at, accepted_by_profile_id)
  VALUES (p_guardian_id, p_student_id, 'active', 'student', now(), now(), p_student_id)
  RETURNING * INTO v_row;

  -- initiated_by='student' and accepted_by=the student: the student issued and shared the
  -- code, so the student is both the initiator and the consenting party. Recording the
  -- guardian as initiator would misattribute the consent.
  PERFORM public.guardian_link_audit(
    'guardian_link_initiated', p_student_id, p_guardian_id,
    jsonb_build_object('from', NULL, 'to', 'active', 'via', 'student_link_code'),
    v_row.id, p_request_id
  );

  RETURN v_row;
END;
$fn$;

-- The two-step flow's acceptance half. SCL-080 removes the step; the function is dead.
DROP FUNCTION IF EXISTS public.accept_guardian_link_audited(uuid, uuid, text);

-- Superseded by create_active_guardian_link_audited. Dropped so link creation has exactly
-- one implementation (CLAUDE.md, "One implementation per operation").
DROP FUNCTION IF EXISTS public.create_guardian_link_audited(uuid, uuid, text, text);

-- pending_* become unreachable under SCL-080. Narrow the CHECK so the database refuses a
-- status no code path can legitimately produce, rather than leaving it writable.
-- SAFE TODAY: production holds 0 guardian_links rows (verified 2026-09-01, read-only).
ALTER TABLE public.guardian_links DROP CONSTRAINT IF EXISTS guardian_links_status_check;
ALTER TABLE public.guardian_links ADD CONSTRAINT guardian_links_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text]));
```

## D-7 — a pair must be revocable more than once

**Why.** `unique_active_link` keys on `status`, so a pair may hold at most ONE revoked row
ever. Proven on a real PostgreSQL 16 with the merged pipeline applied:

```
1. link (active)         OK
2. revoke it             OK
3. RE-LINK same pair     OK
4. revoke a SECOND time  FAILED
   ERROR: duplicate key value violates unique constraint "unique_active_link"
   DETAIL: Key (guardian_profile_id, student_profile_id, status)=(…,…,revoked) already exists.
```

§36.3 says either party can revoke an active link. After one revoke/re-link cycle, neither can.
The constraint's job is "at most one ACTIVE link per pair"; including `status` in the key
overshoots into "at most one row per pair per status".

```sql
ALTER TABLE public.guardian_links DROP CONSTRAINT IF EXISTS unique_active_link;

-- Says exactly what the invariant is: one active link per pair, any number of historical
-- revoked rows. NULLS NOT DISTINCT is dropped with the constraint — neither keyed column is
-- nullable, so it was never doing anything.
CREATE UNIQUE INDEX unique_active_guardian_link
  ON public.guardian_links (guardian_profile_id, student_profile_id)
  WHERE status = 'active';
```

## D-8 — a rotation timestamp, so the TTL is computable

**Why.** `profiles.student_link_code` exists with a partial unique index and zero rows, but
carries no issue time, so "rotates every 24h" cannot be evaluated. Reused rather than
recreated (SCL-080).

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS student_link_code_issued_at timestamptz;

-- Rotation is read-path work: the code is looked up by value on redemption and by owner on
-- display. The existing profiles_student_link_code_key covers lookup by value.
COMMENT ON COLUMN public.profiles.student_link_code_issued_at IS
  'SCL-080: when the current student_link_code was issued. NULL means no code has been '
  'issued yet. TTL comes from auth_runtime_config.student_link_code_ttl_seconds.';
```

## D-9 — DML: the bucket map and the TTL key

**Why.** `rate_limit_runtime_config` holds seven legacy `tutor_*` rows in the older
one-row-per-bucket form and NO `bucket_definitions` key (verified 2026-09-01, read-only:
`SELECT ... WHERE key='bucket_definitions'` → `[]`). `packages/shared/src/services/rate-limit-ledger.ts:190-196`
treats an unseeded bucket as a denial by design, so **every guardian route 503s today**. This
is the single reason the existing email flow could never have produced a link either.

Values and their sources:

| Bucket | Limit | Window | Source |
|---|---|---|---|
| `guardian_link_attempts_daily` | 10 | 86400 | Doc 01 V8 §36.2 bullet 1, verbatim: "max 10 link attempts per day" |
| `guardian_link_email_attempts` | 3 | 86400 | Doc 01 V8 §36.2 bullet 2, verbatim: "max 3 link attempts per day". Retained for the family-keyed reader; SCL-080 removes its call site, so it will count nothing until an email path returns. |
| `guardian_link_code_entry` | 10 | 86400 | SCL-080. Deliberately equal to §36.2 bullet 1 — code entry IS a link attempt, the same quantity §36.2 bounds, so a second number would be a second unreviewed constant. |
| `student_link_code_regeneration` | 10 | 86400 | SCL-080. No spec source; chosen equal to the entry limit so the two churn surfaces share one number rather than introducing two. **Owner: confirm or set.** |

```sql
INSERT INTO public.rate_limit_runtime_config (key, value, value_type, owner, description, environment)
VALUES (
  'bucket_definitions',
  '{
     "guardian_link_attempts_daily":    {"limit": 10, "window_seconds": 86400},
     "guardian_link_email_attempts":    {"limit": 3,  "window_seconds": 86400},
     "guardian_link_code_entry":        {"limit": 10, "window_seconds": 86400},
     "student_link_code_regeneration":  {"limit": 10, "window_seconds": 86400}
   }'::jsonb,
  'object',
  'guardian',
  'Doc 01A Appendix A.3 bucket map. Doc 01 V8 §36.2 supplies the first two limits verbatim; SCL-080 supplies the code buckets.',
  'all'
);

INSERT INTO public.auth_runtime_config (key, value, value_type, owner, description, environment)
VALUES (
  'student_link_code_ttl_seconds',
  '86400'::jsonb,
  'integer',
  'guardian',
  'SCL-080: how long a student link code stays valid before rotation. 24h per the owner ruling.',
  'all'
);
```

**Column shapes verified against the live tables, read-only, 2026-09-01.** Both configs share one
shape (`key` PK, `value` jsonb NOT NULL, `value_type` NOT NULL, `owner` NOT NULL,
`description` NOT NULL, `environment` NOT NULL default `'all'`, plus nullable
`min_value`/`max_value`/`allowed_values`/`updated_by_profile_id`). Three details that a draft
written from the reader alone would have got wrong:

- `value_type` is CHECK-constrained to `integer|string|boolean|array|object|float`. `'json'` and
  `'number'` are both REJECTED — hence `'object'` for the map and `'integer'` for the TTL.
- `environment` is CHECK-constrained to `all|development|staging|production`, and every existing
  row uses `'all'`. More importantly `readConfigValue`
  (`packages/shared/src/services/rate-limit-ledger.ts:117-131`) does NOT filter on it — it is
  `.eq("key", …).maybeSingle()` — so a second row sharing a key would make the read ERROR rather
  than pick one. One row per key, `environment='all'`.
- `key` is the PRIMARY KEY of both tables, so these are inserts-once. Re-running them raises
  23505; use `ON CONFLICT (key) DO UPDATE` to revise a value later.

## Known residual — not solved, recorded

Doc 01A's ledger is keyed on `profile_id` (`rate_limit_check_and_increment(p_profile_id uuid, …)`),
so a per-IP or global limit on code entry is not expressible. An unauthenticated attacker has no
bucket. Code entry requires an authenticated guardian, which bounds exposure to accounts rather
than requests. WS-GL hit the same wall on the per-email bucket. Recorded, not designed around.
