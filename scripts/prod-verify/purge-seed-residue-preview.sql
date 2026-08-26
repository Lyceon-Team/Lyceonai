-- ============================================================================
-- PURGE PREVIEW — the exact rows purge-seed-residue.sql will delete
-- ============================================================================
-- READ-ONLY. One statement. Run this BEFORE purge-seed-residue.sql and keep the
-- output — it is the record of what was removed.
--
-- EXPECT 7 rows: 6 from mastery_event_audit_log, 1 from student_skill_mastery.
-- If you see anything else, do not run the purge.
--
-- WHY THE PREDICATE IS EXACT-TARGET BY CONSTRUCTION
--   'seedhash' is a literal the real function CANNOT emit. apply_mastery_event
--   computes constants_snapshot_hash as
--     encode(extensions.digest(canonicalize_mastery_constants_serialized(), 'sha256'), 'hex')
--   — a 64-character lowercase hex string. No genuine row can carry an
--   8-character word. The predicate therefore cannot reach a real mastery row
--   even in principle, which is a stronger guarantee than an id list (an id list
--   can be stale; this cannot be wrong).
-- ============================================================================

SELECT
  'mastery_event_audit_log'   AS tbl,
  al.audit_row_id::text       AS row_id,
  al.student_id::text         AS student_id,
  al.event_source_kind        AS detail_1,
  al.event_id::text           AS detail_2,
  al.applied_at               AS stamped_at
FROM public.mastery_event_audit_log al
WHERE al.constants_snapshot_hash = 'seedhash'

UNION ALL

SELECT
  'student_skill_mastery',
  sm.student_id::text,
  sm.student_id::text,
  sm.section || ' / ' || sm.domain || ' / ' || sm.skill,
  'event_count_total=' || sm.event_count_total::text,
  sm.computed_at
FROM public.student_skill_mastery sm
WHERE sm.constants_snapshot_hash = 'seedhash'

ORDER BY 1, 6;
