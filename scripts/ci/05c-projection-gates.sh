#!/usr/bin/env bash
# ============================================================================
# 05C — Section Projection (State A) gates (Doc 05C §4/§5/§6/§7/§8/§13;
#       contract ws3-05b-05c §D/§E/§G3) — HARD CI GATES
# ============================================================================
# Against a THROWAWAY Postgres with the full migration pipeline applied (genesis..05b..05c):
#   G3 PROJECTION PARITY — compute_section_projection (States A/B/C) over seeded domain mastery +
#      section KPI + completed full-lengths == Python reference (scripts/ci/projection_parity.py)
#      == Doc 05C §6 worked examples and §13.1 P1-P5, bit-exact (mid/low/high exact integers after
#      round-to-10; denominator, fl_count and the two exams picked), incl. Example 1 Math 630
#      (610-660), Example 2 Math 480 (380-580), a zero-evidence widest-band case, a high-mastery
#      case, and P4 (a third, older exam ignored) / P5 (an abandoned exam ignored). SCL-206.
#      The real view behind the full-length terms is proven end to end, with real exams, by
#      scripts/ci/projection-full-length-gates.sh.
#   SNAPSHOT — every compute appends an immutable snapshot row (Q6 audit trail, INV-05C-17).
#   GATE — below the Q4 8-domain gate the projection columns are ALL NULL (INV-05C-14); the row
#      is still upserted ("not enough evidence yet").
#   RLS / GRANT STRUCT (§7.4/§7.5) — RLS enabled on all 4 projection tables; NO read policy on
#      projections + snapshots (SCL-196); NO authenticated read policy on refresh-state/outbox;
#      snapshots append-only (no UPDATE/DELETE policy); authenticated holds NO column grant on
#      projections or snapshots (SCL-198: every read is the service role's).
#   INV-05C-16 — the projection constant keys are NOT in canonicalize_mastery_constants's hash list.
set -euo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5433}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
export PATH="/usr/lib/postgresql/16/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=projection_05c_gates
PSQL_OUT="$(mktemp /tmp/05c.XXXX.out)"
psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
cleanup() { psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; rm -f "$PSQL_OUT"; }
trap cleanup EXIT

echo "==> fresh DB + role/auth stub + migration pipeline (genesis..05b..05c)"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null
psql_db "$DB" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
for f in "$ROOT"/supabase/migrations/*.sql; do psql_db "$DB" -q -f "$f" >/dev/null; done
# This gate seeds auth.users directly to satisfy the profiles FK; it does NOT test auth profile
# creation (that is genesis-fresh-apply A.2/A.3). Drop the handle_new_user trigger so the seed's
# explicit profiles rows are authoritative and not pre-empted by the trigger's default insert.
psql_db "$DB" -q -c "DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;" >/dev/null

# G3's full-length terms need exact section scores (560, 600, 640, ...), which only a
# controlled seed gives. In THIS throwaway database the 04B view full_length_section_scores is
# replaced by a table of its exact columns (SCL-157 / 05D §12.2), so the fixtures can insert the
# rows the formula reads. Nothing else depends on the view; compute_section_projection binds the
# name at call time. The real view is exercised by projection-full-length-gates.sh.
psql_db "$DB" -q >/dev/null <<'SQL'
DROP VIEW public.full_length_section_scores;
CREATE TABLE public.full_length_section_scores (
  student_id uuid NOT NULL, section text NOT NULL, section_scaled_score integer NOT NULL,
  is_complete boolean NOT NULL, completed_at timestamptz, id uuid NOT NULL PRIMARY KEY);
SQL

echo "==> G3: projection parity (States A/B/C == Python reference == Doc 05C §6 / §13.1)"
python3 "$ROOT/scripts/ci/projection_parity.py" gen | psql_db "$DB" -q -tA -f - > "$PSQL_OUT"
python3 "$ROOT/scripts/ci/projection_parity.py" check --psql-out "$PSQL_OUT"

echo "==> SNAPSHOT: each compute appended an immutable snapshot row (Q6 / INV-05C-17)"
# Nine fixtures computed once each => 9 current rows and 9 snapshot rows (one per compute).
SNAP=$(psql_db "$DB" -tAc "
  SELECT (SELECT count(*) FROM public.student_section_projections WHERE projected_score_mid IS NOT NULL)::text
    ||'|'|| (SELECT count(*) FROM public.student_section_projection_snapshots WHERE projected_score_mid IS NOT NULL)::text;")
if [ "$SNAP" = "9|9" ]; then echo "    OK 9 current rows + 9 snapshot rows (current|snapshot = $SNAP)"
else echo "  FAIL: current|snapshot rows = $SNAP (expected 9|9)"; exit 1; fi

echo "==> Q4 GATE: below the 8-domain gate the projection columns are ALL NULL (INV-05C-14)"
psql_db "$DB" -q >/dev/null <<'SQL'
INSERT INTO auth.users (id,email) VALUES ('9a7e0000-0000-0000-0000-000000000000','gate@ci') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id,email) VALUES ('9a7e0000-0000-0000-0000-000000000000','gate@ci') ON CONFLICT DO NOTHING;
-- Seed only 7 of 8 domains at >= MIN_EVENTS (1 M domain absent) => whole-student gate FAILS.
INSERT INTO public.student_domain_mastery
  (student_id, section, domain, mastery_score, mastery_pct, mastery_level, event_count_total,
   mastery_model_version, constants_snapshot_hash, computed_at) VALUES
  ('9a7e0000-0000-0000-0000-000000000000','M','Algebra',0.5,50.00,2,5,'v1.0','ci',now()),
  ('9a7e0000-0000-0000-0000-000000000000','M','Advanced Math',0.5,50.00,2,5,'v1.0','ci',now()),
  ('9a7e0000-0000-0000-0000-000000000000','M','Problem Solving and Data Analysis',0.5,50.00,2,5,'v1.0','ci',now()),
  -- Geometry and Trigonometry intentionally ABSENT (gate must hold the projection NULL)
  ('9a7e0000-0000-0000-0000-000000000000','RW','Information and Ideas',0.5,50.00,2,5,'v1.0','ci',now()),
  ('9a7e0000-0000-0000-0000-000000000000','RW','Craft and Structure',0.5,50.00,2,5,'v1.0','ci',now()),
  ('9a7e0000-0000-0000-0000-000000000000','RW','Expression of Ideas',0.5,50.00,2,5,'v1.0','ci',now()),
  ('9a7e0000-0000-0000-0000-000000000000','RW','Standard English Conventions',0.5,50.00,2,5,'v1.0','ci',now());
SELECT public.compute_section_projection('9a7e0000-0000-0000-0000-000000000000','M', TIMESTAMPTZ '2026-06-13T00:00:00Z');
SQL
GATE=$(psql_db "$DB" -tAc "
  SELECT (projected_score_mid IS NULL AND projected_score_low IS NULL AND projected_score_high IS NULL
          AND range_width IS NULL AND relevant_question_count IS NULL)::text
    ||'|'|| fl_count_used::text ||'|'|| blend_denominator::text
  FROM public.student_section_projections
  WHERE student_id='9a7e0000-0000-0000-0000-000000000000' AND section='M';")
if [ "$GATE" = "true|0|1" ]; then echo "    OK gate not passed -> all projection cols NULL, row upserted (allnull|flc|denom = $GATE)"
else echo "  FAIL: gate behavior (allnull|flc|denom) = $GATE (expected true|0|1)"; exit 1; fi
# A NULL snapshot row was still appended (lifecycle §7.6 / INV-05C-17).
GATESNAP=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.student_section_projection_snapshots
  WHERE student_id='9a7e0000-0000-0000-0000-000000000000' AND projected_score_mid IS NULL;")
if [ "$GATESNAP" = "1" ]; then echo "    OK NULL-projection snapshot appended (append-only audit trail)"
else echo "  FAIL: NULL snapshot count = $GATESNAP (expected 1)"; exit 1; fi

echo "==> RLS / GRANT STRUCT (§7.4/§7.5) — RLS + guardian-read presence/absence + append-only"
RLS=$(psql_db "$DB" -tAc "
  SELECT bool_and(rowsecurity)::text FROM pg_tables WHERE schemaname='public'
   AND tablename IN ('student_section_projections','student_section_projection_snapshots',
                     'student_projection_refresh_state','projection_refresh_outbox');")
if [ "$RLS" = "true" ]; then echo "    OK RLS enabled on all 4 projection tables"
else echo "  FAIL: RLS not enabled on all 4 tables (bool_and=$RLS)"; exit 1; fi
# SCL-196 (G-NEW-15, migration 20261017000000): NO policy on projections/snapshots — every read
# is the service role's and the route layer enforces guardian visibility — and none on
# refresh-state/outbox. RLS stays ON (checked above), so absence is denial.
POL=$(psql_db "$DB" -tAc "
  SELECT (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename IN ('student_section_projections','student_section_projection_snapshots'))::text
   ||'|'|| (SELECT count(*) FROM pg_policies WHERE schemaname='public'
            AND tablename IN ('student_projection_refresh_state','projection_refresh_outbox'))::text;")
if [ "$POL" = "0|0" ]; then echo "    OK 0 policies on projections/snapshots and on refresh-state/outbox (denial by absence, SCL-196)"
else echo "  FAIL: policy count (projection-reads|bookkeeping) = $POL (expected 0|0)"; exit 1; fi
# snapshots append-only: NO UPDATE/DELETE policy for any role; NO INSERT/UPDATE/DELETE for authenticated.
APPEND=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM pg_policies WHERE schemaname='public'
   AND tablename IN ('student_section_projections','student_section_projection_snapshots')
   AND cmd IN ('INSERT','UPDATE','DELETE');")
if [ "$APPEND" = "0" ]; then echo "    OK no INSERT/UPDATE/DELETE policy on projections/snapshots (service_role writes only; INV-05C-17 append-only)"
else echo "  FAIL: found $APPEND write policy(ies) on projection tables (expected 0)"; exit 1; fi
# column-grant: authenticated must NOT have blend-anchor/hash cols on projections.
COLG=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM information_schema.role_column_grants
   WHERE table_name='student_section_projections' AND grantee='authenticated'
     AND column_name IN ('mastery_term','fl1_score','fl2_score','fl_count_used','blend_denominator',
                         'projection_constants_hash','mastery_model_version','refreshed_at_t_now');")
if [ "$COLG" = "0" ]; then echo "    OK authenticated has NO grant on blend anchors / hashes / refreshed_at_t_now (§7.5/§10.5)"
else echo "  FAIL: authenticated leaked $COLG admin-only column grant(s) on student_section_projections"; exit 1; fi
# SCL-198: the §2.5 guardian-visible surface (projected_score_*, relevant_question_count) is served
# by the route on the service role, so authenticated holds NO column grant on either table —
# presence first: the service role, the one reader, still reads both.
COLOK=$(psql_db "$DB" -tAc "
  SELECT has_table_privilege('service_role','public.student_section_projections','SELECT')::text
   || '|' || has_table_privilege('service_role','public.student_section_projection_snapshots','SELECT')::text
   || '|' || (SELECT count(*) FROM information_schema.role_column_grants
               WHERE table_schema='public' AND grantee IN ('authenticated','anon')
                 AND table_name IN ('student_section_projections','student_section_projection_snapshots'))::text;")
if [ "$COLOK" = "true|true|0" ]; then echo "    OK service_role reads both projection tables; authenticated/anon hold no column grant (SCL-198)"
else echo "  FAIL: projection read posture = $COLOK (expected true|true|0 — service_role reads, no authenticated/anon column grant)"; exit 1; fi

echo "==> INV-05C-16: projection constants EXCLUDED from canonicalize_mastery_constants hash list"
# The formula hash basis must NOT contain any PROJECTION_* key. canonicalize_mastery_constants()
# returns the jsonb object of the hashed keys; assert no PROJECTION_* key appears.
HASHEXC=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM jsonb_object_keys(public.canonicalize_mastery_constants()) k
  WHERE k LIKE 'PROJECTION\_%';")
if [ "$HASHEXC" = "0" ]; then echo "    OK no PROJECTION_* key in canonicalize_mastery_constants (INV-05C-16)"
else echo "  FAIL: $HASHEXC PROJECTION_* key(s) leaked into the formula hash list"; exit 1; fi
# Belt-and-suspenders: the serialized form (the actual hash input) also excludes them.
HASHEXC2=$(psql_db "$DB" -tAc "
  SELECT (public.canonicalize_mastery_constants_serialized() LIKE '%PROJECTION\_%')::text;")
if [ "$HASHEXC2" = "false" ]; then echo "    OK serialized formula-hash input contains no PROJECTION_* key (INV-05C-16)"
else echo "  FAIL: serialized formula-hash input contains a PROJECTION_* key"; exit 1; fi

echo "==> DETERMINISM: re-running compute with same (student,section,t_now) yields identical current row"
DET=$(psql_db "$DB" -q -tAc "
  WITH s AS (SELECT student_id FROM public.student_section_projections WHERE projected_score_mid=480 LIMIT 1)
  SELECT (SELECT projected_score_mid||','||projected_score_low||','||projected_score_high
          FROM public.compute_section_projection((SELECT student_id FROM s),'M',TIMESTAMPTZ '2026-06-13T00:00:00Z'));")
if [ "$DET" = "480,380,580" ]; then echo "    OK re-compute is deterministic (Example 2 stays 480,380,580)"
else echo "  FAIL: determinism re-compute = $DET (expected 480,380,580)"; exit 1; fi

echo "05C SECTION-PROJECTION (STATES A/B/C) GATES: PASS"
