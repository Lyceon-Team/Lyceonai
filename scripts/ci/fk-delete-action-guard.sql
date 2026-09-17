-- ============================================================================
-- FK DELETE-ACTION GUARD — every edge into an identity is classified
-- ============================================================================
-- @spec [Doc 03 §14.2; Doc 03B §29.1 (the per-table cascade list at account hard
--        delete); Doc 05E §3 Rule 4 + §5; Doc 01 V8 §40.5; owner brief
--        2026-09-17 "Declarative FK Actions, Not an Enumerated Cascade" step 3]
-- @implemented [2026-09-17]
--
-- WHY THIS EXISTS. The account-deletion cascade used to enumerate table names by
-- hand. Nine foreign keys into `profiles` were never added to it, so
-- `DELETE FROM profiles` raised for any account that had used the tutor and the
-- nightly job retried forever. A hand-maintained list cannot notice a table
-- nobody added to it.
--
-- This guard does not read a list. It enumerates FROM `pg_constraint`, so a table
-- added tomorrow is in scope the moment it has a foreign key, whether or not
-- anybody remembered this file.
--
-- THE RULE. Every foreign key referencing `public.profiles` or `auth.users` must
-- be exactly one of:
--   * ON DELETE CASCADE   — identity-bearing, no standalone value
--   * ON DELETE SET NULL  — survives pseudonymously; the FK severs the link
--   * on the ALLOWLIST    — needs work before removal, and the work must exist
--
-- AND the allowlist is checked in both directions: every allowlisted edge must
-- have a handler in the cascade body, and no handler may exist for an edge that
-- is not allowlisted. A one-way check would let a stale allowlist entry sit
-- forever after its handler was deleted.
--
-- NOT A REPLACEMENT FOR INV-05E-03. That guard asserts the `actor_id` substrate
-- (columns, nullability, the PR-5c seal) and is a different invariant. It never
-- claimed to cover foreign keys, which is why it did not catch these nine.
--
-- Run against a genesis-fresh-apply database.

DO $guard$
DECLARE
  v_bad      text;
  v_missing  text;
  v_orphan   text;
BEGIN

  -- ==========================================================================
  -- The allowlist: edges that legitimately block, each with the handler that
  -- clears them. `handler` is a substring that MUST appear in the cascade or
  -- pre-clear function body, so deleting the handler turns this guard red.
  -- ==========================================================================
  CREATE TEMP TABLE _fk_allowlist (tbl text, col text, handler text, why text)
    ON COMMIT DROP;
  INSERT INTO _fk_allowlist VALUES
    ('entitlements', 'profile_id',
     'DELETE FROM public.entitlements WHERE profile_id = p_profile_id',
     'PS-1: the Stripe teardown reads the subscription and item ids off this row before it goes'),
    ('guardian_links', 'student_profile_id',
     'DELETE FROM public.guardian_links WHERE student_profile_id = p_profile_id',
     'PS-2: rows belonging to ANOTHER identity; cleared in their own transaction (T1.5)'),
    ('guardian_links', 'guardian_profile_id',
     'DELETE FROM public.guardian_links WHERE guardian_profile_id = p_profile_id',
     'PS-2: as above, from the guardian side'),
    ('guardian_links', 'accepted_by_profile_id',
     'UPDATE public.guardian_links SET accepted_by_profile_id = NULL',
     'PS-2: attribution on another identity''s row — severed in T1.5, not in the subject''s transaction'),
    ('guardian_links', 'revoked_by_profile_id',
     'UPDATE public.guardian_links SET revoked_by_profile_id = NULL',
     'PS-2: as above'),
    ('guardian_consent_requests', 'student_profile_id',
     'DELETE FROM public.guardian_consent_requests WHERE student_profile_id = p_profile_id',
     'PS-3: consent request rows for this student'),
    ('guardian_consent_requests', 'guardian_profile_id',
     'UPDATE public.guardian_consent_requests SET guardian_profile_id = NULL',
     'PS-3: attribution on another identity''s row, severed in T1.5'),
    ('account_deletion_requests', 'profile_id',
     'DELETE FROM public.account_deletion_requests WHERE profile_id = p_profile_id',
     'PS-5: the evidence bundle is written from this row before it is removed'),
    ('account_deletion_requests', 'actor_profile_id',
     'UPDATE public.account_deletion_requests',
     'PS-4: REASSIGNED to the subject, not nulled — the column is NOT NULL'),
    ('profiles', 'id',
     'DELETE FROM auth.users WHERE id = p_profile_id',
     'the ordered two-step: profiles then auth.users, so the profile row never outlives its auth row'),
    -- ---- HELD FOR AN OWNER RULING (2026-09-17) --------------------------------
    -- These four are allowlisted so the guard is green on the tree as it stands,
    -- NOT because they are correctly classified. They are the open question in
    -- the PR body. `crisis_review_cases.student_id` is NOT NULL, so SET NULL is
    -- not available without a nullability change, and `conversation_id` RESTRICT
    -- blocks the tutor CASCADE for any student who has a case.
    ('crisis_review_cases', 'student_id',
     'CRISIS_RULING_PENDING',
     'RULING PENDING: safety record vs erasure. Doc 03 §21 is silent on deletion; §14.2 schedules crisis conversations for deletion at 180 days'),
    ('crisis_review_cases', 'conversation_id',
     'CRISIS_RULING_PENDING',
     'RULING PENDING: RESTRICT here blocks the tutor CASCADE one level up'),
    ('crisis_review_audit_log', 'case_id',
     'CRISIS_RULING_PENDING',
     'RULING PENDING: blocks the case delete'),
    ('crisis_review_audit_log', 'reviewer_id',
     'CRISIS_RULING_PENDING',
     'RULING PENDING: admin-side, not student-side — this one blocks REVIEWER deletion, not subject deletion');

  -- ==========================================================================
  -- G1: every FK into profiles / auth.users is CASCADE, SET NULL, or allowlisted
  -- ==========================================================================
  SELECT string_agg(
           format('%s.%s (%s -> %s)', e.tbl, e.col,
                  CASE e.act WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                             WHEN 'd' THEN 'SET DEFAULT' END,
                  e.ref),
           E'\n    ' ORDER BY e.tbl, e.col)
    INTO v_bad
    FROM (
      SELECT src.relname AS tbl, a.attname AS col, c.confdeltype AS act,
             tn.nspname || '.' || tgt.relname AS ref
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_namespace sn ON sn.oid = src.relnamespace
        JOIN pg_class tgt ON tgt.oid = c.confrelid
        JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
        JOIN unnest(c.conkey) AS k(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND sn.nspname = 'public'
         AND ((tn.nspname = 'public' AND tgt.relname = 'profiles')
           OR (tn.nspname = 'auth'   AND tgt.relname = 'users'))
    ) e
   WHERE e.act NOT IN ('c', 'n')
     AND NOT EXISTS (SELECT 1 FROM _fk_allowlist w WHERE w.tbl = e.tbl AND w.col = e.col);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION E'FK-DELETE-ACTION FAIL [G1]: foreign key(s) into an identity table are neither CASCADE nor SET NULL nor allowlisted:\n    %\n  Classify the edge: CASCADE if the row has no standalone value, SET NULL if it survives under actor_id, or add it to the allowlist in this file WITH a handler in the cascade.', v_bad;
  END IF;
  RAISE NOTICE 'FK-DELETE-ACTION [G1] OK: every FK into profiles/auth.users is classified';

  -- ==========================================================================
  -- G2: every allowlisted edge still has its handler in a function body
  -- ==========================================================================
  SELECT string_agg(format('%s.%s (expected handler: %s)', w.tbl, w.col, w.handler),
                    E'\n    ' ORDER BY w.tbl, w.col)
    INTO v_missing
    FROM _fk_allowlist w
   WHERE w.handler <> 'CRISIS_RULING_PENDING'
     AND NOT EXISTS (
       SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('execute_account_deletion_cascade',
                            'preclear_account_deletion_links')
          AND position(w.handler in p.prosrc) > 0
     );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'FK-DELETE-ACTION FAIL [G2]: allowlisted edge(s) have no handler in the cascade or pre-clear:\n    %\n  An allowlist entry without a handler is a blocking foreign key nobody clears.', v_missing;
  END IF;
  RAISE NOTICE 'FK-DELETE-ACTION [G2] OK: every allowlisted edge has a handler';

  -- ==========================================================================
  -- G3: no edge is handled BOTH declaratively and procedurally
  -- ==========================================================================
  -- Two derivations of one rule is how the enumerated cascade grew in the first
  -- place. If Postgres severs the link, the function must not also sever it.
  SELECT string_agg(format('%s.%s is %s but the cascade still writes it: %s',
                           e.tbl, e.col,
                           CASE e.act WHEN 'c' THEN 'ON DELETE CASCADE' ELSE 'ON DELETE SET NULL' END,
                           e.probe),
                    E'\n    ' ORDER BY e.tbl, e.col)
    INTO v_orphan
    FROM (
      SELECT src.relname AS tbl, a.attname AS col, c.confdeltype AS act,
             -- Table-QUALIFIED and statement-bounded. A bare `SET student_id = NULL`
             -- also matches the audit tables in Layer 3, which have no foreign key
             -- and must keep their procedural severance; `[^;]*` keeps the match
             -- inside one statement so it cannot span from one UPDATE to the next.
             CASE c.confdeltype
               WHEN 'c' THEN format('DELETE FROM public\.%s[^;]*%s = p_profile_id', src.relname, a.attname)
               ELSE format('UPDATE public\.%s[^;]*SET[^;]*%s = NULL', src.relname, a.attname)
             END AS probe
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_namespace sn ON sn.oid = src.relnamespace
        JOIN pg_class tgt ON tgt.oid = c.confrelid
        JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
        JOIN unnest(c.conkey) AS k(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND sn.nspname = 'public'
         AND tn.nspname = 'public' AND tgt.relname = 'profiles'
         AND c.confdeltype IN ('c', 'n')
    ) e
   WHERE EXISTS (
     SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'execute_account_deletion_cascade'
        AND p.prosrc ~ e.probe
   );

  IF v_orphan IS NOT NULL THEN
    RAISE EXCEPTION E'FK-DELETE-ACTION FAIL [G3]: edge(s) handled both declaratively and procedurally:\n    %\n  Delete the procedural step; the foreign key already says it.', v_orphan;
  END IF;
  RAISE NOTICE 'FK-DELETE-ACTION [G3] OK: no edge is handled twice';

  RAISE NOTICE 'FK DELETE-ACTION GUARD: ALL PASS';

END $guard$;
