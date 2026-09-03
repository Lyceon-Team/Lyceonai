#!/usr/bin/env bash
# ============================================================================
# 05B — KPI quarantine gate (Doc 05B §4.9; SCL-054; INV-05B-16) — HARD CI GATE
# ============================================================================
# THE OUTAGE, REPRODUCED AS A PERMANENT TEST.
#
# 2026-06-26 → 2026-08-17: 84 answered practice_session_items produced zero mastery output
# for four students. student_projection_refresh_state — written by the final statement of
# apply_mastery_event — held zero rows, proving the function never once ran to completion.
# The cause was NOT the domain the student was practising. It was refresh_overall_kpi, a
# STUDENT-WIDE validator invoked inside the per-event mastery transaction: one row with a
# NULL occurred_at anywhere in the student's history aborted every mastery write, in every
# domain, for that student, permanently.
#
# This gate seeds exactly that shape — a corrupt row in section RW, a clean event in section
# M — and asserts the M event commits anyway, with the RW row EXCLUDED from the aggregates
# and COUNTED on the KPI row.
#
# WHY THE FIXTURE DROPS A CHECK. psi_resolved_requires_occurred_at now makes this row
# unwritable in production, which is why prod carries zero of them. The gate drops the
# constraint FOR THE FIXTURE INSERT ONLY and restores it immediately, because the property
# under test is what the FUNCTIONS do with such a row, not whether the table accepts one.
# Testing only shapes the current schema permits would make this gate green by assumption:
# the constraint is the reason the class is currently absent, not a reason the class cannot
# return (a future ingress, a backfill, a restored dump).
#
# Requires a database. Skips with a stated reason when PGHOST is unreachable — a skip, not
# a pass.
set -euo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
export PATH="/usr/lib/postgresql/16/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=kpi_quarantine_gate

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "05B KPI QUARANTINE GATE: SKIPPED — no Postgres reachable at $PGHOST:$PGPORT."
  echo "  This is a skip, not a pass. The CI job that runs it provides a database."
  exit 0
fi

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
cleanup() { psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

STUDENT='cccc1111-1111-1111-1111-111111111111'

echo "==> fresh DB + role/auth stub + migration pipeline"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null
psql_db "$DB" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
for f in "$ROOT"/supabase/migrations/*.sql; do psql_db "$DB" -q -f "$f" >/dev/null; done
psql_db "$DB" -q -c "DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;" >/dev/null

echo "==> C0: the columns exist and are NOT NULL DEFAULT 0"
COLS=$(psql_db "$DB" -tAc "
  SELECT string_agg(c.relname||'='||a.attnotnull::text, ',' ORDER BY c.relname)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  WHERE a.attname='excluded_event_count' AND NOT a.attisdropped;")
if [ "$COLS" = "student_overall_kpi=true,student_section_kpi=true" ]; then
  echo "    OK excluded_event_count present and NOT NULL on both KPI tables"
else echo "  FAIL: excluded_event_count columns = $COLS"; exit 1; fi

echo "==> seed: student, questions, session"
psql_db "$DB" -q >/dev/null <<SQL
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation) VALUES
  ('SATM1QUAR00','M',1,'Algebra',ARRAY['Linear equations in one variable'],2,'stem','[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,'A','expl'),
  ('SATRW1QUAR0X','RW',1,'Information and Ideas',ARRAY['Central Ideas and Details'],2,'stem','[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,'A','expl')
  ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id,email) VALUES ('$STUDENT','quarantine@ci');
INSERT INTO public.profiles (id,email) VALUES ('$STUDENT','quarantine@ci');
INSERT INTO public.practice_sessions (id,user_id,mode,target_count,platform,client_instance_id,actor_id) VALUES
  ('cccc2222-0000-0000-0000-000000000000','$STUDENT','flow',4,'web','ci',
   (SELECT actor_id FROM public.profiles WHERE id='$STUDENT'));
SQL

echo "==> POISON: one answered RW row with NULL occurred_at (section A)"
# The CHECK is dropped for this insert only and restored on the next line. See header.
psql_db "$DB" -q >/dev/null <<SQL
ALTER TABLE public.practice_session_items DROP CONSTRAINT psi_resolved_requires_occurred_at;
INSERT INTO public.practice_session_items
  (id,session_id,user_id,ordinal,question_id,question_stem,question_options,question_correct_answer,
   question_explanation,question_domain,question_skill,question_difficulty,question_section,status,is_correct,occurred_at,actor_id)
VALUES ('cccc3333-0000-0000-0000-000000000001','cccc2222-0000-0000-0000-000000000000','$STUDENT',
   1,'SATRW1QUAR0X','stem','[]'::jsonb,'A','expl','Information and Ideas','Central Ideas and Details',
   2,'RW','answered',true,NULL,(SELECT actor_id FROM public.profiles WHERE id='$STUDENT'));
ALTER TABLE public.practice_session_items ADD CONSTRAINT psi_resolved_requires_occurred_at
  CHECK ((status <> ALL (ARRAY['answered'::text,'skipped'::text])) OR (occurred_at IS NOT NULL)) NOT VALID;
SQL
POISON=$(psql_db "$DB" -tAc "SELECT count(*) FROM public.practice_session_items WHERE user_id='$STUDENT' AND status='answered' AND occurred_at IS NULL;")
if [ "$POISON" = "1" ]; then echo "    OK 1 poisoned RW row present (the outage's shape)"
else echo "  FAIL: poison seed wrote $POISON rows (expected 1)"; exit 1; fi

echo "==> CLEAN EVENT: one answered M row, then apply_mastery_event for section M (section B)"
psql_db "$DB" -q >/dev/null <<SQL
INSERT INTO public.practice_session_items
  (id,session_id,user_id,ordinal,question_id,question_stem,question_options,question_correct_answer,
   question_explanation,question_domain,question_skill,question_difficulty,question_section,status,is_correct,occurred_at,actor_id)
VALUES ('cccc3333-0000-0000-0000-000000000002','cccc2222-0000-0000-0000-000000000000','$STUDENT',
   2,'SATM1QUAR00','stem','[]'::jsonb,'A','expl','Algebra','Linear equations in one variable',
   2,'M','answered',true,TIMESTAMPTZ '2026-03-01T00:00:00Z',(SELECT actor_id FROM public.profiles WHERE id='$STUDENT'));
SQL

# The whole point: before this change, this statement RAISED KPI_HISTORICAL_DATA_INVALID and
# rolled back, because of the RW row above — a row in a section this event never touches.
set +e
APPLY_ERR=$(psql_db "$DB" -q -v ON_ERROR_STOP=1 2>&1 >/dev/null <<SQL
BEGIN;
SET LOCAL app.mastery_refresh_trigger = 'event';
SELECT public.apply_mastery_event(
  '$STUDENT','M','Algebra','Linear equations in one variable',2::smallint,
  'practice','practice_attempt',true,TIMESTAMPTZ '2026-03-01T00:00:00Z',
  'cccc3333-0000-0000-0000-000000000002','SATM1QUAR00',NULL);
COMMIT;
SQL
)
APPLY_RC=$?
set -e
if [ "$APPLY_RC" != "0" ]; then
  echo "  FAIL: apply_mastery_event did not commit — the outage is NOT fixed."
  echo "$APPLY_ERR" | head -5 | sed 's/^/        /'
  exit 1
fi
echo "    OK apply_mastery_event committed with a corrupt row in another section"

echo "==> INV-05B-16: the mastery write is intact (skill mastery + audit + projection counter)"
INV16=$(psql_db "$DB" -tAc "
  SELECT (SELECT count(*) FROM public.student_skill_mastery WHERE student_id='$STUDENT' AND section='M')::text
    ||'|'|| (SELECT count(*) FROM public.mastery_event_audit_log WHERE student_id='$STUDENT')::text
    ||'|'|| (SELECT count(*) FROM public.student_projection_refresh_state WHERE student_id='$STUDENT')::text;")
if [ "$INV16" = "1|1|1" ]; then
  echo "    OK skill mastery + audit row + projection refresh state all written (skill|audit|refresh = $INV16)"
else echo "  FAIL: INV-05B-16 (skill|audit|refresh) = $INV16 (expected 1|1|1) — the outage shape survives"; exit 1; fi

echo "==> COUNTED: excluded_event_count persisted, and scoped to the right refresher"
COUNTS=$(psql_db "$DB" -tAc "
  SELECT (SELECT excluded_event_count FROM public.student_overall_kpi WHERE student_id='$STUDENT')::text
    ||'|'|| (SELECT excluded_event_count FROM public.student_section_kpi WHERE student_id='$STUDENT' AND section='M')::text;")
if [ "$COUNTS" = "1|0" ]; then
  echo "    OK overall counts the RW exclusion (1); section M counts none (0) — scope preserved"
else echo "  FAIL: excluded_event_count (overall|section M) = $COUNTS (expected 1|0)"; exit 1; fi

echo "==> EXCLUDED: the poisoned row is out of the aggregates, not merely tallied"
# Overall sees ONE event (the M row). If the poisoned row were counted in the aggregate the
# total would be 2 — this is what separates "excluded" from "counted".
AGG=$(psql_db "$DB" -tAc "
  SELECT (SELECT events_total FROM public.student_overall_kpi WHERE student_id='$STUDENT')::text
    ||'|'|| (SELECT sections_active FROM public.student_overall_kpi WHERE student_id='$STUDENT')::text;")
if [ "$AGG" = "1|1" ]; then
  echo "    OK overall aggregates over 1 event in 1 section — the RW row entered no aggregate"
else echo "  FAIL: overall (events_total|sections_active) = $AGG (expected 1|1) — excluded rows leaked into the numbers"; exit 1; fi

echo "05B KPI QUARANTINE GATE: PASS"
