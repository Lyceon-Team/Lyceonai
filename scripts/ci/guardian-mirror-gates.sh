#!/usr/bin/env bash
# ============================================================================
# Guardian-mirror gates (Doc 01 guardian trust §35 / Doc 05B §5.3 / Parent §11.1) — HARD GATE
# ============================================================================
# Proves the ONE unified guardian gate guardian_can_view_student(student_id) = (linked AND entitled):
#   AIRTIGHT LINK (the load-bearing security boundary): a guardian can read ONLY the students they are
#     linked to via the server-side guardian_links record — a guardian reading an UNLINKED student
#     (worst case: an unlinked minor) returns ZERO rows, by RLS, not by convention.
#   ENTITLEMENT HALF: a linked-but-not-entitled student is also zero rows (grace-inclusive via
#     entitlement_active()).
#   VIEW-ONLY by construction: no guardian write policy + no write grant on any mirror surface.
#   CARVE-OUTS: guardian sees mastery_level only (NOT mastery_score/acc_*); student_skill_kpi has no
#     guardian policy.
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

echo "==> AIRTIGHT LINK: as guardian G, visible domain-mastery rows = S1 only (S2 unlinked, S3 unentitled)"
VIS=$(psql_db "$DB" -tAc "
  SET test.guardian_uid = '6e000000-0000-0000-0000-000000000001';
  SET ROLE authenticated;
  SELECT count(*)::text
       || '|' || coalesce(string_agg(distinct right(student_id::text,2), ',' ORDER BY right(student_id::text,2)), '')
  FROM public.student_domain_mastery;" | tail -1)
if [ "$VIS" = "1|11" ]; then echo "    OK guardian sees exactly 1 row, student S1 (…11) — unlinked S2 + unentitled S3 invisible"
else echo "  FAIL: guardian visibility = $VIS (expected 1|11 — a guardian read an unlinked/unentitled student!)"; exit 1; fi

echo "==> a guardian linked to NOBODY sees zero rows"
ZERO=$(psql_db "$DB" -tAc "
  SET test.guardian_uid = '6e000000-0000-0000-0000-000000000099';
  SET ROLE authenticated;
  SELECT count(*) FROM public.student_domain_mastery;" | tail -1)
[ "$ZERO" = "0" ] || { echo "  FAIL: an unlinked guardian saw $ZERO rows (expected 0)"; exit 1; }
echo "    OK unlinked guardian sees 0 rows"

echo "==> PR370-GUARDIAN-001 (two-sided): the entitlement oracle is reachable ONLY via the link gate"
# (a) authenticated must NOT be able to call entitlement_active directly (no raw entitlement probe).
if psql_db "$DB" -tAc "SET ROLE authenticated; SELECT public.entitlement_active('6e000000-0000-0000-0000-000000000011');" >/dev/null 2>&1; then
  echo "  FAIL: authenticated executed entitlement_active directly — entitlement-state oracle leak"; exit 1
else echo "    OK (a) authenticated is denied direct EXECUTE on entitlement_active"; fi
# (b) guardian_can_view_student must STILL work after the revoke — proven by the AIRTIGHT LINK test
# above (it runs as authenticated and exercises guardian_can_view_student -> entitlement_active, which
# resolves because guardian_can_view_student is SECURITY DEFINER and calls it as the owner). A revoke
# that broke the guardian gate would have failed VIS above. Belt-and-suspenders: confirm the linked
# guardian still resolves via the public (authenticated) gate fn directly.
GCV=$(psql_db "$DB" -tAc "
  SET test.guardian_uid = '6e000000-0000-0000-0000-000000000001';
  SET ROLE authenticated;
  SELECT public.guardian_can_view_student('6e000000-0000-0000-0000-000000000011')::text
   || '|' || public.guardian_can_view_student('6e000000-0000-0000-0000-000000000022')::text;" | tail -1)
if [ "$GCV" = "true|false" ]; then echo "    OK (b) guardian_can_view_student still resolves after the revoke (linked S1=true, unlinked S2=false)"
else echo "  FAIL: guardian_can_view_student post-revoke = $GCV (expected true|false — revoke broke the gate)"; exit 1; fi

echo "==> the same gate governs every mirror surface (one predicate, no parallel logic)"
POLS=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM pg_policies
  WHERE schemaname='public' AND qual LIKE '%guardian_can_view_student%'
    AND tablename IN ('student_domain_mastery','student_section_kpi','student_domain_kpi',
                      'student_overall_kpi','student_section_projections','student_section_projection_snapshots');")
[ "$POLS" = "6" ] || { echo "  FAIL: $POLS/6 mirror policies consume guardian_can_view_student"; exit 1; }
echo "    OK all 6 mirror policies consume the single guardian_can_view_student predicate"

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

echo "==> CARVE-OUTS: mastery_level readable, mastery_score/acc_* NOT; student_skill_kpi has no guardian policy"
CARVE=$(psql_db "$DB" -tAc "
  SELECT has_column_privilege('authenticated','public.student_domain_mastery','mastery_level','SELECT')::text
   || '|' || has_column_privilege('authenticated','public.student_domain_mastery','mastery_score','SELECT')::text
   || '|' || has_column_privilege('authenticated','public.student_domain_mastery','acc_test','SELECT')::text
   || '|' || (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='student_skill_kpi' AND qual LIKE '%guardian_can_view_student%')::text;")
[ "$CARVE" = "true|false|false|0" ] || { echo "  FAIL: carve-out posture = $CARVE (expected true|false|false|0)"; exit 1; }
echo "    OK mastery_level only; mastery_score/acc_* withheld; student_skill_kpi not a guardian mirror"

echo "GUARDIAN-MIRROR GATES: PASS"
