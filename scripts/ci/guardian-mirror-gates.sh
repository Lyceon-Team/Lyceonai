#!/usr/bin/env bash
# ============================================================================
# Guardian-mirror gates (Doc 01 guardian trust §35 / Doc 05B §5.3 / Parent §11.1) — HARD GATE
# ============================================================================
# Since 20261017000000 (G-NEW-15, SCL-196) the six mirror tables have RLS ON and NO read policy,
# and since 20261019000000 (SCL-198) `authenticated` holds NO SELECT on them either: every read is
# the service role's, and guardian visibility is decided in the route layer (`resolveSubject` ->
# `guardian_view_decision`). This gate proves the database side of that:
#   DENIAL: a direct `authenticated` read — a guardian linked to an entitled student, or the
#     student themselves — is REFUSED (42501, no grant), not merely filtered. A guardian JWT cannot
#     reach a linked student's KPI counters through PostgREST, around SCL-188's projection.
#   ONE FORM OF THE GATE: the boolean guardian_can_view_student / _as functions are gone; nothing
#     but guardian_view_decision decides guardian visibility.
#   ENTITLEMENT ORACLE: authenticated cannot call entitlement_active directly.
#   VIEW-ONLY by construction: no write policy + no write grant on any mirror surface.
#   NO COLUMN GRANT: authenticated can read no column of student_domain_mastery (mastery_level
#     included, since SCL-198); student_skill_kpi has no policy at all.
set -euo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=guardian_mirror_gates
psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
cleanup() { psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> fresh DB + role/auth stub + migration pipeline"
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

echo "==> seed: guardian G; S1 (linked+entitled), S2 (entitled, UNLINKED), S3 (linked, NOT entitled)"
# Override auth.uid() to read a session GUC so we can act as the guardian. service_role / postgres
# (superuser) bypasses RLS for the seed writes; the read test runs as the non-superuser authenticated.
psql_db "$DB" -q >/dev/null <<'SQL'
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $f$ SELECT nullif(current_setting('test.guardian_uid', true), '')::uuid $f$;
INSERT INTO auth.users (id,email) VALUES
  ('6e000000-0000-0000-0000-000000000001','g@x'),
  ('6e000000-0000-0000-0000-000000000011','s1@x'),
  ('6e000000-0000-0000-0000-000000000022','s2@x'),
  ('6e000000-0000-0000-0000-000000000033','s3@x');
INSERT INTO public.profiles (id,email,role) VALUES
  ('6e000000-0000-0000-0000-000000000001','g@x','guardian'),
  ('6e000000-0000-0000-0000-000000000011','s1@x','student'),
  ('6e000000-0000-0000-0000-000000000022','s2@x','student'),
  ('6e000000-0000-0000-0000-000000000033','s3@x','student');
-- links: G->S1 active, G->S3 active (S2 has NO link to G)
INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by) VALUES
  ('6e000000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-000000000011','active','guardian'),
  ('6e000000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-000000000033','active','guardian');
-- entitlements: S1 active, S2 active, S3 canceled
INSERT INTO public.entitlements (profile_id,tier,status) VALUES
  ('6e000000-0000-0000-0000-000000000011','premium','active'),
  ('6e000000-0000-0000-0000-000000000022','premium','active'),
  ('6e000000-0000-0000-0000-000000000033','premium','canceled');
-- one domain mastery row per student (direct insert as superuser bypasses RLS)
INSERT INTO public.student_domain_mastery (student_id,section,domain,mastery_level,constants_snapshot_hash) VALUES
  ('6e000000-0000-0000-0000-000000000011','M','Algebra',3,'x'),
  ('6e000000-0000-0000-0000-000000000022','M','Algebra',3,'x'),
  ('6e000000-0000-0000-0000-000000000033','M','Algebra',3,'x');
SQL

# Presence before absence: the rows exist, so a refusal below is a denial, not an empty table.
ROWS=$(psql_db "$DB" -tAc "SELECT count(*) FROM public.student_domain_mastery;" | tail -1)
[ "$ROWS" = "3" ] || { echo "  FAIL: seed has $ROWS domain-mastery rows (expected 3) — a denial below would be vacuous"; exit 1; }
echo "    OK the seed's 3 rows exist (read as the owner)"

# direct_read <uid> <table> — runs one SELECT as `authenticated` with that uid and prints
# "refused" on SQLSTATE 42501 (permission denied), otherwise the row count it got.
direct_read() {
  local out
  if out=$(psql -v ON_ERROR_STOP=1 -d "$DB" -tA -c "SET test.guardian_uid = '$1';" \
        -c "SET ROLE authenticated;" -c "SELECT count(*) FROM public.$2;" 2>&1); then
    echo "$out" | tail -1
  else
    case "$out" in *"permission denied for table $2"*) echo "refused" ;; *) echo "error: $out" ;; esac
  fi
}

echo "==> DENIAL: a direct authenticated read of a mirror table is refused (no grant)"
# S1 is linked to G AND entitled: the case the old guardian policy ALLOWED. Now it is refused.
VIS="$(direct_read 6e000000-0000-0000-0000-000000000001 student_domain_mastery)|$(direct_read 6e000000-0000-0000-0000-000000000001 student_overall_kpi)|$(direct_read 6e000000-0000-0000-0000-000000000001 student_section_projections)"
if [ "$VIS" = "refused|refused|refused" ]; then echo "    OK a guardian linked to an entitled student is refused a direct read (route layer only)"
else echo "  FAIL: guardian direct reads = $VIS (expected refused|refused|refused — a guardian could read KPI/mastery rows around the route layer!)"; exit 1; fi

echo "==> the student themselves is refused too (service role only)"
SELF="$(direct_read 6e000000-0000-0000-0000-000000000011 student_domain_mastery)"
[ "$SELF" = "refused" ] || { echo "  FAIL: a student's direct read = $SELF (expected refused — no grant since SCL-198)"; exit 1; }
echo "    OK a student is refused a direct read of their own rows"

echo "==> PR370-GUARDIAN-001 (two-sided): the entitlement oracle is reachable ONLY via the link gate"
# (a) authenticated must NOT be able to call entitlement_active directly (no raw entitlement probe).
if psql_db "$DB" -tAc "SET ROLE authenticated; SELECT public.entitlement_active('6e000000-0000-0000-0000-000000000011');" >/dev/null 2>&1; then
  echo "  FAIL: authenticated executed entitlement_active directly — entitlement-state oracle leak"; exit 1
else echo "    OK (a) authenticated is denied direct EXECUTE on entitlement_active"; fi
# (b) the boolean gate forms are gone: guardian_view_decision is the only form, service-role only.
FORMS=$(psql_db "$DB" -tAc "
  SELECT (to_regprocedure('public.guardian_can_view_student(uuid)') IS NULL)::text
   || '|' || (to_regprocedure('public.guardian_can_view_student_as(uuid,uuid)') IS NULL)::text
   || '|' || (SELECT count(*) FROM pg_policies WHERE schemaname='public'
                AND tablename IN ('student_domain_mastery','student_section_kpi','student_domain_kpi',
                                  'student_overall_kpi','student_section_projections','student_section_projection_snapshots')
                AND cmd IN ('SELECT','ALL'))::text;" | tail -1)
if [ "$FORMS" = "true|true|0" ]; then echo "    OK (b) no boolean gate form remains; no read policy on any of the six mirror tables"
else echo "  FAIL: boolean forms gone / read policies = $FORMS (expected true|true|0)"; exit 1; fi

echo "==> VIEW-ONLY by construction: no guardian/authenticated WRITE policy or grant on any mirror surface"
WRITES=$(psql_db "$DB" -tAc "
  SELECT
    (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND cmd <> 'SELECT'
       AND tablename IN ('student_domain_mastery','student_section_kpi','student_domain_kpi',
                         'student_overall_kpi','student_section_projections','student_section_projection_snapshots'))
  + (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema='public' AND grantee IN ('authenticated','anon')
         AND privilege_type IN ('INSERT','UPDATE','DELETE')
         AND table_name IN ('student_domain_mastery','student_section_kpi','student_domain_kpi',
                            'student_overall_kpi','student_section_projections','student_section_projection_snapshots'));")
[ "$WRITES" = "0" ] || { echo "  FAIL: $WRITES guardian/authenticated write policy-or-grant on a mirror surface (must be 0 — view-only)"; exit 1; }
echo "    OK zero write policies/grants — guardian is view-only at the row-security level"

echo "==> NO COLUMN GRANT: no column of student_domain_mastery is readable; student_skill_kpi has no policy"
CARVE=$(psql_db "$DB" -tAc "
  SELECT has_column_privilege('authenticated','public.student_domain_mastery','mastery_level','SELECT')::text
   || '|' || has_column_privilege('authenticated','public.student_domain_mastery','mastery_score','SELECT')::text
   || '|' || has_column_privilege('authenticated','public.student_domain_mastery','acc_test','SELECT')::text
   || '|' || (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='student_skill_kpi')::text;")
[ "$CARVE" = "false|false|false|0" ] || { echo "  FAIL: column-grant posture = $CARVE (expected false|false|false|0)"; exit 1; }
echo "    OK no column grant (mastery_level included, SCL-198); student_skill_kpi has no policy"

echo "GUARDIAN-MIRROR GATES: PASS"
