# Guardian linking by student code — DDL/DML rationale (SCL-080)

**These are now migrations. This file is the RATIONALE, not the queue.**

Superseded 2026-09-01 by owner ruling: the migration freeze is gone permanently, and every
DDL change lands in three places — a migration file, production, and `genesis.sql`
(`docs/plans/Stripe_Vertical_Session_Charter.md` §7). D-6..D-9 accordingly live in
`supabase/migrations/20260901000000_scl_080_guardian_link_code.sql`, and the same end state is
folded into `supabase/migrations/00000000000000_genesis.sql`. The `infra/supabase/pending-ddl/`
directory is gone; the file moved by `git mv` and nothing in the SQL changed except adding
`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` so a re-run is safe.

The earlier NOTE here — that the Charter asserted a freeze while citing a document deleted in
`aa4fd40` — is RESOLVED: the owner deleted the freeze language rather than the citation.

**Owner action:** apply the seven ordered steps in `scripts/prod-verify/SCL-080-APPLY.sql`.
Until every one is applied, guardian linking by code does not work in production — the routes
are live but the objects they need do not exist.

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
- `key` is the PRIMARY KEY of both tables, so these are inserts-once. Both seeds therefore carry
  `ON CONFLICT (key) DO NOTHING`, which is what makes the migration re-runnable; a bare INSERT
  raises 23505 on the second apply. To REVISE a seeded value later, use `DO UPDATE` in a new
  migration — `DO NOTHING` deliberately will not overwrite a value an operator has since tuned.

## Known residual — not solved, recorded

Doc 01A's ledger is keyed on `profile_id` (`rate_limit_check_and_increment(p_profile_id uuid, …)`),
so a per-IP or global limit on code entry is not expressible. An unauthenticated attacker has no
bucket. Code entry requires an authenticated guardian, which bounds exposure to accounts rather
than requests. WS-GL hit the same wall on the per-email bucket. Recorded, not designed around.

## Out of scope for SCL-080 — named, not worked

Ruled out of scope by the owner and deliberately untouched by this change: the under-13 consent
path (Doc 01 V8 §37), guardian↔student cardinality (N guardians per student stands as ruled), and
a repo-wide `@spec` annotation sweep. No code, test, or doc in this workstream addresses them.

## Dead-code sweep — the guardian-link and guardian-billing surface

Run 2026-09-01 after the migration landed. Every symbol was grepped repo-wide before it was
touched; nothing here was deleted on a reading of the code alone. Two findings were CI
failures rather than dead code, and both were reproduced before being changed.

### Deleted — within the surface

| Where | What | Why it was dead |
|---|---|---|
| `packages/shared/src/guardian-link-schema.ts` | `guardianLinkRequestSchema`, `GuardianLinkRequest`, `GuardianLinkRevoke`, `guardianLinkInitiatorSchema`, `GuardianLinkInitiator`, `PENDING_STATUS_FOR_INITIATOR`, `OCCUPYING_STATUSES` | The email-initiation request shape and the two-step status machine. Zero consumers. |
| `packages/shared/src/guardian-link-schema.ts` | `pending_student_accept` / `pending_guardian_accept` enum members | The schema was WIDER than its column. genesis now declares `('active','revoked')`, so those members made a parse that can never fail where the write already would have. |
| `packages/shared/src/guardian-link-schema.ts` | `NOT_PENDING`, `WRONG_ACCEPTOR`, and the `LY001`/`LY002` map entries | Both SQLSTATEs are raised only by `accept_guardian_link_audited`, which the migration drops. LY003/LY004 stay — their functions survive. |
| `server/lib/account.ts` | `isGuardianLinkedToStudent`, `getPrimaryGuardianLink`, the `GuardianLinkInitiator` re-export; module docblock rewritten | Zero callers each. `guardian_view_decision` is the visibility gate; the §31.3 fold replaced the oldest-link lookup. The docblock still described "create, read, **accept** and revoke". |
| `server/routes/guardian-routes.ts` | dead `isGuardianLinkedToStudent` import, `LinkedStudentRow`, `UUID_RE`, `isIsoDate` | Declared, never referenced. `UUID_RE`'s only consumer was the deleted accept-by-id path. |
| `server/middleware/guardian-link-rate-limit.ts` | `guardianLinkRateLimit`, `GUARDIAN_LINK_BUCKET`, `GUARDIAN_LINK_EMAIL_BUCKET_FAMILY`, the `rollback` import | The two-control limiter for `POST /api/guardian/link` with an email body. Zero importers; `guardianLinkCodeEntryRateLimit` replaced it. `applyHeaders` and `deny` are shared with the surviving limiter and were KEPT. |
| `packages/shared/src/services/subject-digest.ts` | `guardianLinkEmailBucketKey` | Its only importer was the limiter above. Transitively dead. |
| `server/services/guardian-link-audit.ts` | the `"guardian_link_accepted"` action | No producer remains. `auditGuardianLink` itself is KEPT — see below. |
| `client/src/pages/UserProfile.tsx` | the "Guardian Link Requests" block | **The worst of these, because it was user-visible and wrong.** It rendered `profileUser.studentLinkCode` — the LIVE SCL-080 credential, which `profile-routes.ts:153` populates — under copy telling the student to "ask your parent or guardian to send a link request to this account email" and labelling the code legacy. A working code, presented as dead, next to the flow it belongs to. |
| `client/src/pages/guardian-dashboard.tsx` | the "Connection Required" card, the `§36.1 email` comment, unused `Search`/`Loader2` imports | The card rendered for `students.length === 0` alongside the correct SCL-080 empty state — two empty states, one describing the deleted flow. The comment asserted the guardian identifies by EMAIL and that "the code mechanism appears nowhere in the locked spec corpus", directly above `const [linkCode, setLinkCode]`. |
| `client/src/components/guardian/SubscriptionPaywall.tsx`, `client/src/pages/UserProfile.tsx` | `accountId`, `plan`, `currentPeriodEnd`, `stripeSubscriptionId`, `isPaid`, `premiumSource`, `billingOwnerRole` (declaration-only) and one contradictory TODO | `premiumSource` and `billingOwnerRole` are the SAME defect as the four phantoms the paywall's own header describes: **no server route writes either**, so both could only ever be `undefined`. The rest were declared and never read. The TODO called the guardian student picker "legacy" when it is the current SCL-080 design. |
| shared types with zero consumers | `StudentLinkCode`, `RedeemLinkCodeRequest`, `StudentLinkPathKey`, `BillingCheckoutRequest`, `BillingPortalOutcome` | Inferred types nothing imports. Their schemas are live and stay. |

### Not dead — reached only through a string, do not delete

- `getGuardianLinkById` — **RETAINED, as ruled.** One production caller: `student-resources.ts:33` imports it, `:595` calls it inside `DELETE /api/students/:studentId/links/:linkId` to establish party-hood before the revoke write. The other two hits are inert `vi.mock` factory keys.
- `auditGuardianLink` — zero static importers, reached by a dynamic `await import(...)` in `guardian-reporting.contract.test.ts:552`. It is a deliberate INSTRUMENT CONTROL: it proves the `audit_logs` capture array works, so the two negative assertions downstream mean something. Deleting it would make them vacuously green.
- `create_active_guardian_link_audited` / `revoke_guardian_link_audited` — reached only as SQL name strings in `supabaseServer.rpc(...)`.
- `DELETE /api/students/:studentId/links/:linkId` — zero CLIENT callers, but a live mounted route implementing §36.3's student half and the sole consumer of `getGuardianLinkById` and `guardianLinkRevokeSchema`. Missing UI, not dead code.
- `isGuardianLinkedToStudent` in `scripts/ci/subject-resolver-chokepoint-gate.mjs:76` — a FORBIDDEN-PATTERN regex, not a usage. It must stay now that the function is gone, since it bans re-introducing the pattern.

### Reported, not touched — outside the surface

- `client/src/pages/guardian-dashboard.tsx` `StudentSummary.progress` — an unread type member on the guardian REPORTING surface.
- `packages/shared/src/billing-schema.ts` `billingPortalOutcomeSchema` — referenced only by its own unit test. General billing portal, not guardian-specific.
- The D-9 seed still writes `guardian_link_attempts_daily` and `guardian_link_email_attempts`. Both are named by Doc 01 V8 §36.2, and both are now UNCONSUMED, since the code path that read them is deleted above. Left in place: removing spec-named configuration is a spec decision, not a sweep decision.
- `.claude/worktrees/` holds four scratch checkouts that vitest globs into, producing ~770 spurious test files and hundreds of failures locally. They are gitignored and absent in CI. Not fixed here; `--exclude '.claude/**'` gives the true repo result.
- Stale references to the deleted symbols remain in `docs/**` and `audit-out/**`. Documentation history, not code.
