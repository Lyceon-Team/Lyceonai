-- ===========================================================================
-- The tutor seven-day promise — mark conversations when entitlement lapses
--
-- @spec [Doc-03_V1.1 §14.2 + INV-03-19 (tutor retention: active + 7 days
--        post-entitlement-loss); Privacy Policy draft §9.7 (the seven-day
--        line v3 could not publish); Doc-05B §5.3 (the canonical entitlement
--        predicate); SCL-101 addendum finding 1; owner ruling 2026-09-22 C1
--        ("yes, clear deleted_at on resubscribe")]
-- @implemented 2026-09-22
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- plain English: `retention-sweep.ts:113` has documented `deleted_at` as "set
-- when entitlement lapses" since 2026-08-20. That writer did not exist, so
-- `sweep7d` has always had a permanently empty input and Privacy Policy v3 had
-- to publish the narrower "deleted when your account is deleted" instead of the
-- seven-day promise. This is the writer.
--
-- expected outcome: when a student's entitlement stops being active, their open
-- tutor conversations are stamped `deleted_at = now()`, which starts the 7-day
-- clock the existing sweep already reads. When entitlement becomes active
-- again, the stamp is CLEARED, so a returning student keeps their history.
--
-- WHY A TRIGGER AND NOT THE WEBHOOK HANDLER. `upsertEntitlement`
-- (server/lib/account.ts:560) is today the ONLY writer of `entitlements` in
-- TypeScript — the other call sites read, and the two other `status` writes in
-- the codebase belong to `account_deletion_requests` and to a return literal.
-- So hooking the handler would work today. A trigger is chosen anyway for two
-- reasons that outlast today's call graph: it fires on EVERY path including a
-- future SQL-level write, a migration, or a hand-run statement; and the
-- lapse/restore decision is a transition, which OLD/NEW gives directly and a
-- handler would have to reconstruct. This is the Phase 6 lesson (P6.2) applied
-- before it bites: a step in one function only fires on the path that calls it.
--
-- IT CALLS THE CANONICAL PREDICATE; IT DOES NOT RE-LIST STATUSES.
-- `public.entitlement_active(uuid)` is the single evaluator (SP25-001 gates
-- that there is exactly one). Its body is `status IN ('active','past_due',
-- 'trialing')`. Writing that list again here would be a second definition of
-- "entitled" and the first one to drift — so the trigger asks the predicate.
-- If the predicate's statuses change, this follows with no edit.
--
-- trade-offs:
--  - `AFTER INSERT OR UPDATE OF status`, not `AFTER UPDATE`. The predicate
--    reads `status` and nothing else, so a period-end refresh or a tier change
--    cannot alter the answer, and firing on those would mean running this on
--    every billing-cycle webhook. THE COLUMN LIST IS COUPLED TO THE
--    PREDICATE'S BODY: if `entitlement_active` ever reads `tier`, this trigger
--    silently stops covering it. `C1.7` asserts the predicate reads only
--    `status` so that coupling cannot rot unnoticed.
--  - DELETE is deliberately NOT covered. Nothing in the codebase deletes an
--    `entitlements` row; the only path is the `profiles` cascade, which takes
--    `tutor_conversations` with it, so a stamp would be written to rows being
--    removed in the same statement. Excluding it avoids that for no loss.
--  - FIRST LAPSE WINS. The stamp is written only `WHERE deleted_at IS NULL`.
--    Without that, a second inactive-to-inactive transition (canceled -> unpaid,
--    which Stripe does emit) would rewrite `deleted_at` to now() and push the
--    seven-day clock out indefinitely — a lapsed account that never expires,
--    behind a mechanism that looks like it works.
--
-- edge cases:
--  - Re-entering an inactive state while already stamped: no-op, per above.
--  - Becoming active while nothing is stamped: no-op.
--  - A student with no conversations: no rows touched, no error.
--  - `status` updated to the same value: Postgres still fires the trigger, and
--    both branches are no-ops, so it costs a predicate call and nothing else.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.sync_tutor_conversations_on_entitlement_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active boolean;
BEGIN
  -- The single evaluator. Not a re-listed status set.
  v_active := public.entitlement_active(NEW.profile_id);

  IF v_active THEN
    -- Restored. Clear the stamp so the 7-day sweep stops seeing these rows.
    -- Owner ruling 2026-09-22 C1: without this a returning student loses their
    -- tutor history on day seven of a lapse they already ended.
    UPDATE public.tutor_conversations
       SET deleted_at = NULL
     WHERE student_id = NEW.profile_id
       AND deleted_at IS NOT NULL;
  ELSE
    -- Lapsed. Start the clock, but only on conversations not already stamped.
    UPDATE public.tutor_conversations
       SET deleted_at = now()
     WHERE student_id = NEW.profile_id
       AND deleted_at IS NULL;
  END IF;

  RETURN NULL;   -- AFTER trigger; return value is ignored.
END;
$$;

COMMENT ON FUNCTION public.sync_tutor_conversations_on_entitlement_change() IS
  'Doc 03 §14.2 / INV-03-19 / owner ruling 2026-09-22 C1: stamps tutor_conversations.deleted_at when public.entitlement_active(profile_id) turns false and clears it when it turns true. Calls the canonical predicate rather than re-listing statuses. Stamps only where deleted_at IS NULL so a second inactive transition cannot push the 7-day clock out.';

DROP TRIGGER IF EXISTS entitlements_sync_tutor_conversations ON public.entitlements;

CREATE TRIGGER entitlements_sync_tutor_conversations
  AFTER INSERT OR UPDATE OF status ON public.entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tutor_conversations_on_entitlement_change();

REVOKE ALL ON FUNCTION public.sync_tutor_conversations_on_entitlement_change() FROM PUBLIC;
