-- ===========================================================================
-- crisis_review_events joins the A6 severance — the same two edges, one table later
-- ===========================================================================
-- @spec [owner ruling A6 (the crisis review record SURVIVES account deletion;
--        only the identity is severed); Doc-03_V3 §21.3; the FK-delete-action
--        guard, scripts/ci/fk-delete-action-guard.sql G1]
--        | @implemented [2026-09-22]
--
-- plain English: `crisis_review_events` arrived on `lisa`
-- (20260922000000_lisa_session_lifecycle.sql) as the per-message event log that
-- replaced one-case-per-conversation with one case plus N events. It declared
-- `student_id` and `conversation_id` ON DELETE RESTRICT, which is what
-- `crisis_review_cases` itself declared before ruling A6. The A6 severance
-- (20260918000000) landed on `cleanup` at the same time, so neither branch
-- could see the other: `lisa` had no guard to fail, and `cleanup` had no such
-- table to classify. The merge is the first moment both exist.
--
-- This applies A6 to the new table, identically to its parent.
--
-- WHY SET NULL AND NOT CASCADE. A6 ruled that the crisis review record outlives
-- the account: a safety review is not erased because its subject deleted their
-- profile. CASCADE would delete the events with the person, which is the
-- outcome A6 rejected. SET NULL keeps the record and destroys the link —
-- exactly what `crisis_review_cases.student_id` and `.conversation_id` already
-- do. `case_id` stays ON DELETE CASCADE because it points at
-- `crisis_review_cases`, not at an identity table: the events belong to their
-- case, and the case survives.
--
-- THE SECOND EDGE WAS NOT FAILING CI, AND IS THE MORE DANGEROUS ONE.
-- `student_id` is what `fk-delete-action-guard` G1 catches, because G1 only
-- looks at foreign keys into `profiles` / `auth.users`. `conversation_id`
-- points at `tutor_conversations`, so no guard covers it — and
-- `sweep7d` (server/services/retention-sweep.ts) HARD-DELETES
-- `tutor_conversations` once the 7-day window closes. Left RESTRICT, the first
-- conversation that ever carried a crisis event would make that delete fail,
-- and the 7-day promise in Privacy Policy v4 §6.1 would stop being kept for
-- every student after it. That sweep began running on a schedule today, so the
-- failure would have been live rather than theoretical. It is fixed here
-- because it is the same ruling, the same table and the same edit — not
-- because CI asked.
--
-- trade-offs: the columns lose NOT NULL, which is the cost of SET NULL having
-- somewhere to put the NULL. A severed row is then distinguishable from a live
-- one by `student_id IS NULL`, which is how the sibling tables already read.
--
-- edge cases: idempotent — an edge already SET NULL is counted and skipped, so
-- a replay is a no-op. The block REFUSES rather than silently flattening a
-- constraint carrying non-default ON UPDATE / deferrable / match properties,
-- because re-adding it would drop them.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Apply order: after 20260922000000_lisa_session_lifecycle.sql, which creates
-- the table. No data migration: severance happens at deletion time, not now.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Nullability first — SET NULL needs somewhere to put the NULL
-- ---------------------------------------------------------------------------
ALTER TABLE public.crisis_review_events ALTER COLUMN student_id      DROP NOT NULL;
ALTER TABLE public.crisis_review_events ALTER COLUMN conversation_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The two delete actions, driven by the catalog
-- ---------------------------------------------------------------------------
-- Same discipline as 20260918000000: the constraint NAME is read from
-- pg_constraint rather than reconstructed (Postgres truncates at 63 bytes), the
-- referenced table is read from the catalog rather than assumed (these two
-- edges point at different tables), and the block refuses a constraint with
-- non-default properties instead of flattening it.
DO $crisis_events$
DECLARE
  r            record;
  v_conname    text;
  v_current    "char";
  v_onupd      "char";
  v_deferrable boolean;
  v_match      "char";
  v_reftbl     text;
  v_refcol     text;
  v_changed    integer := 0;
  v_skipped    integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('crisis_review_events', 'student_id'),
      ('crisis_review_events', 'conversation_id')
    ) AS t(tbl, col)
  LOOP
    SELECT c.conname, c.confdeltype, c.confupdtype, c.condeferrable, c.confmatchtype,
           tgt.relname, ta.attname
      INTO v_conname, v_current, v_onupd, v_deferrable, v_match, v_reftbl, v_refcol
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      JOIN pg_class tgt ON tgt.oid = c.confrelid
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
      JOIN unnest(c.confkey) AS fk(attnum) ON true
      JOIN pg_attribute ta ON ta.attrelid = tgt.oid AND ta.attnum = fk.attnum
     WHERE c.contype = 'f'
       AND n.nspname = 'public'
       AND src.relname = r.tbl
       AND a.attname = r.col
     LIMIT 1;

    IF v_conname IS NULL THEN
      RAISE EXCEPTION 'CRISIS_EVENTS_FK: no foreign key found on %.% — the edge list is stale', r.tbl, r.col;
    END IF;

    IF v_onupd <> 'a' OR v_deferrable OR v_match <> 's' THEN
      RAISE EXCEPTION 'CRISIS_EVENTS_FK: %.% (%) carries non-default FK properties (ON UPDATE %, deferrable %, match %); re-adding it would silently drop them. Alter it by hand.',
        r.tbl, r.col, v_conname, v_onupd, v_deferrable, v_match;
    END IF;

    IF v_current = 'n' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, v_conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE SET NULL',
      r.tbl, v_conname, r.col, v_reftbl, v_refcol
    );
    v_changed := v_changed + 1;
  END LOOP;

  RAISE NOTICE 'CRISIS_EVENTS_FK: % edge(s) altered, % already correct', v_changed, v_skipped;
END $crisis_events$;

COMMENT ON COLUMN public.crisis_review_events.student_id IS
  'The student the crisis signal concerned. NULL once that account is deleted: owner ruling A6 keeps the safety record and severs the identity, exactly as crisis_review_cases.student_id does.';
COMMENT ON COLUMN public.crisis_review_events.conversation_id IS
  'The conversation the signal came from. NULL once that conversation is hard-deleted by the 7-day tutor sweep (Privacy Policy v4 §6.1). RESTRICT here would have made that sweep fail on the first conversation carrying a crisis event.';

COMMIT;
