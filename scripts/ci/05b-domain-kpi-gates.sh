#!/usr/bin/env bash
# ============================================================================
# 05B — Domain Mastery & KPI gates (Doc 05B §4/§5/§6/§7/§10/§12/§13/§14;
#       contract ws3-05b-05c §A/§B/§C/§G1/§G2) — HARD CI GATES
# ============================================================================
# Against a THROWAWAY Postgres with the full migration pipeline applied:
#   G1 DOMAIN PARITY — compute_mastery_for_entity('domain') over the PRODUCTION
#      canonical_mastery_events == Python reference == Doc 05A §12, bit-exact, across the
#      practice/review fixtures at domain grain; + INV-05B-13 cross-skill event-aggregation.
#   SMOKE — refresh_domain_mastery for a seeded student writes student_domain_mastery + all
#      4 KPI rows in one transaction (§4.9 chain); audit row written.
#   KPI STRUCT (§14, K1-K7 subset) — recency-window boundary + streak fixtures vs a hand-seeded
#      injected-T_now fixture (KPI is straightforward counts/accuracy/streak, not a locked-vector
#      formula — STRUCT correctness suffices; see note below).
#   SINGLE-WRITER / RLS STRUCT (§6/§10) — RLS enabled on all 5 tables; guardian read policies on
#      domain-mastery/section/domain/overall KPI; NO guardian policy on student_skill_kpi.
set -euo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5433}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
export PATH="/usr/lib/postgresql/16/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=domain_kpi_gates
PSQL_OUT="$(mktemp /tmp/05b.XXXX.out)"
psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
cleanup() { psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; rm -f "$PSQL_OUT"; }
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

echo "==> G1: domain-mastery parity (domain grain == Python reference == §12; + INV-05B-13)"
python3 "$ROOT/scripts/ci/mastery_domain_parity.py" gen | psql_db "$DB" -q -f - > "$PSQL_OUT"
python3 "$ROOT/scripts/ci/mastery_domain_parity.py" check --psql-out "$PSQL_OUT"

# Shared FK parents for the smoke + KPI fixtures.
psql_db "$DB" -q >/dev/null <<'SQL'
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES ('SATM1SMOKE0','M',1,'Algebra',ARRAY['s'],2,'stem','[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,'A','expl') ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id,email) VALUES ('aaaa1111-1111-1111-1111-111111111111','smoke@ci');
INSERT INTO public.profiles (id,email) VALUES ('aaaa1111-1111-1111-1111-111111111111','smoke@ci');
INSERT INTO public.practice_sessions (id,user_id,mode,target_count,platform,client_instance_id,actor_id) VALUES
  ('aaaa2222-0000-0000-0000-000000000000','aaaa1111-1111-1111-1111-111111111111','flow',6,'web','ci',(SELECT actor_id FROM public.profiles WHERE id = 'aaaa1111-1111-1111-1111-111111111111'));
-- 6 answered Algebra practice items (2 skills) so domain crosses 5-event threshold; recency by occurred_at.
INSERT INTO public.practice_session_items
  (id,session_id,user_id,ordinal,question_id,question_stem,question_options,question_correct_answer,
   question_explanation,question_domain,question_skill,question_difficulty,question_section,status,is_correct,occurred_at,actor_id)
SELECT ('aaaa3333-0000-0000-0000-00000000000'||g)::uuid, 'aaaa2222-0000-0000-0000-000000000000','aaaa1111-1111-1111-1111-111111111111',
       g,'SATM1SMOKE0','stem','[]'::jsonb,'A','expl','Algebra',
       CASE WHEN g < 3 THEN 'Linear equations in one variable' ELSE 'Linear equations in two variables' END,
       2,'M','answered',true, TIMESTAMPTZ '2026-03-01T00:00:00Z' - (INTERVAL '1 minute' * g),
       (SELECT actor_id FROM public.profiles WHERE id = 'aaaa1111-1111-1111-1111-111111111111')
FROM generate_series(0,5) g;
SQL

echo "==> SMOKE: refresh_domain_mastery writes domain mastery + all 4 KPI rows (§4.9 chain)"
psql_db "$DB" -q >/dev/null <<'SQL'
BEGIN;
SET LOCAL app.mastery_refresh_trigger = 'event';
SELECT public.refresh_domain_mastery('aaaa1111-1111-1111-1111-111111111111','M','Algebra');
COMMIT;
SQL
SMOKE=$(psql_db "$DB" -tAc "
  SELECT (SELECT count(*) FROM public.student_domain_mastery WHERE student_id='aaaa1111-1111-1111-1111-111111111111' AND mastery_level IS NOT NULL)::text
    ||'|'|| (SELECT count(*) FROM public.student_section_kpi  WHERE student_id='aaaa1111-1111-1111-1111-111111111111')::text
    ||'|'|| (SELECT count(*) FROM public.student_domain_kpi   WHERE student_id='aaaa1111-1111-1111-1111-111111111111')::text
    ||'|'|| (SELECT count(*) FROM public.student_skill_kpi    WHERE student_id='aaaa1111-1111-1111-1111-111111111111')::text
    ||'|'|| (SELECT count(*) FROM public.student_overall_kpi  WHERE student_id='aaaa1111-1111-1111-1111-111111111111')::text
    ||'|'|| (SELECT count(*) FROM public.mastery_domain_refresh_audit_log WHERE student_id='aaaa1111-1111-1111-1111-111111111111')::text;")
# expect: 1 domain mastery (non-null) | 1 section_kpi | 1 domain_kpi | 2 skill_kpi (2 skills) | 1 overall_kpi | 1 audit
if [ "$SMOKE" = "1|1|1|2|1|1" ]; then echo "    OK domain mastery + 4 KPI tiers + audit all written (dm|sec|dom|skill|overall|audit = $SMOKE)"
else echo "  FAIL: §4.9 chain wrote (dm|sec|dom|skill|overall|audit) = $SMOKE (expected 1|1|1|2|1|1)"; exit 1; fi

# Assert KPI engagement values are derived (not stale defaults): section events_total = 6, overall = 6.
KPIVAL=$(psql_db "$DB" -tAc "
  SELECT (SELECT events_total FROM public.student_section_kpi WHERE student_id='aaaa1111-1111-1111-1111-111111111111' AND section='M')::text
    ||'|'|| (SELECT events_total FROM public.student_overall_kpi WHERE student_id='aaaa1111-1111-1111-1111-111111111111')::text
    ||'|'|| (SELECT accuracy_overall FROM public.student_domain_kpi WHERE student_id='aaaa1111-1111-1111-1111-111111111111' AND domain='Algebra')::text;")
if [ "$KPIVAL" = "6|6|1.0000" ]; then echo "    OK KPI counts/accuracy derived (section_total|overall_total|domain_acc = $KPIVAL)"
else echo "  FAIL: KPI derivation wrong (section_total|overall_total|domain_acc) = $KPIVAL (expected 6|6|1.0000)"; exit 1; fi

echo "==> KPI STRUCT (§14 K-fixtures, injected T_now — recency boundary + streak)"
# NOTE (contract §G2 / §B1): Doc 05B §14 specifies KPI fixtures as STRUCT correctness (counts /
# accuracy / streak / recency-window edges), NOT a formula with locked numeric vectors. So this is
# a STRUCT correctness check against a hand-seeded injected-T_now fixture, encoded inline here.
psql_db "$DB" -q >/dev/null <<'SQL'
INSERT INTO auth.users (id,email) VALUES ('bbbb1111-1111-1111-1111-111111111111','kpi@ci');
INSERT INTO public.profiles (id,email) VALUES ('bbbb1111-1111-1111-1111-111111111111','kpi@ci');
INSERT INTO public.practice_sessions (id,user_id,mode,target_count,platform,client_instance_id,actor_id) VALUES
  ('bbbb2222-0000-0000-0000-000000000000','bbbb1111-1111-1111-1111-111111111111','flow',8,'web','ci',(SELECT actor_id FROM public.profiles WHERE id = 'bbbb1111-1111-1111-1111-111111111111'));
-- K3 boundary: event exactly 7d before T_now (inclusive). K4: 7d+1s (excluded).
-- K5/K2: events at T_now, T_now-1d..-4d (5-day streak), plus T_now-30d (in 30d window inclusive-ish).
-- T_now := 2026-04-15T12:00:00Z (injected). Events placed relative to it.
INSERT INTO public.review_error_attempts
  (id, student_id, question_id, is_correct, section, domain, skill, difficulty, occurred_at, actor_id)
VALUES
  ('bbbb0000-0000-0000-0000-000000000000','bbbb1111-1111-1111-1111-111111111111','SATM1SMOKE0',true,'M','Algebra','s1',2, TIMESTAMPTZ '2026-04-15T11:55:00Z', (SELECT actor_id FROM public.profiles WHERE id = 'bbbb1111-1111-1111-1111-111111111111')),  -- today (5m ago)
  ('bbbb0000-0000-0000-0000-000000000001','bbbb1111-1111-1111-1111-111111111111','SATM1SMOKE0',true,'M','Algebra','s1',2, TIMESTAMPTZ '2026-04-14T10:00:00Z', (SELECT actor_id FROM public.profiles WHERE id = 'bbbb1111-1111-1111-1111-111111111111')),  -- -1d
  ('bbbb0000-0000-0000-0000-000000000002','bbbb1111-1111-1111-1111-111111111111','SATM1SMOKE0',false,'M','Algebra','s1',2,TIMESTAMPTZ '2026-04-13T10:00:00Z', (SELECT actor_id FROM public.profiles WHERE id = 'bbbb1111-1111-1111-1111-111111111111')), -- -2d
  ('bbbb0000-0000-0000-0000-000000000003','bbbb1111-1111-1111-1111-111111111111','SATM1SMOKE0',true,'M','Algebra','s1',2, TIMESTAMPTZ '2026-04-12T10:00:00Z', (SELECT actor_id FROM public.profiles WHERE id = 'bbbb1111-1111-1111-1111-111111111111')),  -- -3d
  ('bbbb0000-0000-0000-0000-000000000004','bbbb1111-1111-1111-1111-111111111111','SATM1SMOKE0',true,'M','Algebra','s1',2, TIMESTAMPTZ '2026-04-11T10:00:00Z', (SELECT actor_id FROM public.profiles WHERE id = 'bbbb1111-1111-1111-1111-111111111111')),  -- -4d (streak=5 incl today)
  ('bbbb0000-0000-0000-0000-000000000005','bbbb1111-1111-1111-1111-111111111111','SATM1SMOKE0',true,'M','Algebra','s1',2, TIMESTAMPTZ '2026-04-08T12:00:00Z', (SELECT actor_id FROM public.profiles WHERE id = 'bbbb1111-1111-1111-1111-111111111111')),  -- exactly -7d (K3, in 7d window)
  ('bbbb0000-0000-0000-0000-000000000006','bbbb1111-1111-1111-1111-111111111111','SATM1SMOKE0',true,'M','Algebra','s1',2, TIMESTAMPTZ '2026-04-08T11:59:59Z', (SELECT actor_id FROM public.profiles WHERE id = 'bbbb1111-1111-1111-1111-111111111111'));  -- -7d-1s (K4, OUT of 7d window)
-- refresh section KPI with injected T_now (determinism, §7.1/§8.3).
SELECT public.refresh_section_kpi('bbbb1111-1111-1111-1111-111111111111','M', TIMESTAMPTZ '2026-04-15T12:00:00Z');
SQL
KPI=$(psql_db "$DB" -tAc "
  SELECT events_total::text ||'|'|| events_last_7d::text ||'|'|| events_last_30d::text ||'|'|| current_streak_days::text
  FROM public.student_section_kpi WHERE student_id='bbbb1111-1111-1111-1111-111111111111' AND section='M';")
# 7 events total; last_7d = today..-4d (5) + exactly-7d (1) = 6 (K3 inclusive, K4 excluded); 30d = all 7; streak = 5.
if [ "$KPI" = "7|6|7|5" ]; then echo "    OK KPI recency boundary + streak correct (total|7d|30d|streak = $KPI; K3 incl, K4 excl, streak=5)"
else echo "  FAIL: KPI struct (total|7d|30d|streak) = $KPI (expected 7|6|7|5)"; exit 1; fi

echo "==> SINGLE-WRITER / RLS STRUCT (§6/§10) — RLS enabled + guardian-policy presence/absence"
RLS=$(psql_db "$DB" -tAc "
  SELECT bool_and(rowsecurity)::text FROM pg_tables WHERE schemaname='public'
   AND tablename IN ('student_domain_mastery','student_section_kpi','student_domain_kpi','student_skill_kpi','student_overall_kpi');")
if [ "$RLS" = "true" ]; then echo "    OK RLS enabled on domain_mastery + all 4 KPI tables"
else echo "  FAIL: RLS not enabled on all 5 tables (bool_and=$RLS)"; exit 1; fi
# guardian read policies must exist on domain_mastery/section/domain/overall, and NOT on skill_kpi.
GUARD=$(psql_db "$DB" -tAc "
  SELECT (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname IN
     ('student_domain_mastery_guardian_read','student_section_kpi_guardian_read',
      'student_domain_kpi_guardian_read','student_overall_kpi_guardian_read'))::text
   ||'|'|| (SELECT count(*) FROM pg_policies WHERE schemaname='public'
            AND tablename='student_skill_kpi' AND policyname LIKE '%guardian%')::text;")
if [ "$GUARD" = "4|0" ]; then echo "    OK 4 guardian read policies present; student_skill_kpi has NONE (denial by absence, §2.4)"
else echo "  FAIL: guardian policy presence/absence (4-tier|skill) = $GUARD (expected 4|0)"; exit 1; fi
# column-grant: authenticated must NOT have mastery_score / last_event_id on student_domain_mastery.
COLG=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM information_schema.role_column_grants
   WHERE table_name='student_domain_mastery' AND grantee='authenticated'
     AND column_name IN ('mastery_score','mastery_pct','acc_test','last_event_id','last_event_occurred_at');")
if [ "$COLG" = "0" ]; then echo "    OK authenticated has NO grant on mastery_score/pct/acc_*/last_event_* (INV-05A-12)"
else echo "  FAIL: authenticated leaked $COLG admin-only column grant(s) on student_domain_mastery"; exit 1; fi

echo "05B DOMAIN-MASTERY + KPI GATES: PASS"
