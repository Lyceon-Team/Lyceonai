#!/usr/bin/env bash
# ============================================================================
# Lane C — seam gates (Doc 05A §4; Lane-C contract §D) — HARD CI GATES
# ============================================================================
# Against a THROWAWAY Postgres with the full migration pipeline applied:
#   D3 PRODUCTION-DERIVATION PARITY — compute_mastery_for_entity over the PRODUCTION
#      canonical_mastery_events (real practice_session_items/review_error_attempts + FKs) ==
#      Python reference == Doc 05A §12, bit-exact, across the practice/review fixture subset.
#   D2 IDEMPOTENCY REPLAY — two apply_mastery_event calls with the same (event_source_kind,
#      event_id) apply exactly once (one audit row, one mastery state, identical return).
#   D1 TRANSACTION ATOMICITY — answer insert + apply_mastery_event + mid-txn failure persists
#      NEITHER (no torn write on the mastery path).
set -euo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=lane_c_gates
PSQL_OUT="$(mktemp /tmp/lanec.XXXX.out)"
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

echo "==> D3: production-derivation parity"
python3 "$ROOT/scripts/ci/mastery_production_parity.py" gen | psql_db "$DB" -q -f - > "$PSQL_OUT"
python3 "$ROOT/scripts/ci/mastery_production_parity.py" check --psql-out "$PSQL_OUT"

# Shared FK parents for the D1/D2 unit tests.
psql_db "$DB" -q >/dev/null <<'SQL'
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES ('SATM1ZZZZZZ','M',1,'d',ARRAY['s'],2,'stem','[]'::jsonb,'A','expl') ON CONFLICT DO NOTHING;
-- replay student R + a 5-event answered session; atomicity student A + committed session.
INSERT INTO auth.users (id,email) VALUES
  ('11111111-1111-1111-1111-111111111111','r@ci'),('22222222-2222-2222-2222-222222222222','a@ci');
INSERT INTO public.profiles (id,email) VALUES
  ('11111111-1111-1111-1111-111111111111','r@ci'),('22222222-2222-2222-2222-222222222222','a@ci');
INSERT INTO public.practice_sessions (id,user_id,mode,target_count,platform,client_instance_id) VALUES
  ('1111aaaa-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','flow',5,'web','ci'),
  ('2222aaaa-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','flow',5,'web','ci');
-- 5 answered practice items for R (events e0..e4), recency by occurred_at.
INSERT INTO public.practice_session_items
  (id,session_id,user_id,ordinal,question_id,question_stem,question_options,question_correct_answer,
   question_explanation,question_domain,question_skill,question_difficulty,question_section,status,is_correct,occurred_at)
SELECT ('11110000-0000-0000-0000-00000000000'||g)::uuid, '1111aaaa-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',
       g,'SATM1ZZZZZZ','stem','[]'::jsonb,'A','expl','Algebra','s',2,'M','answered',true,
       TIMESTAMPTZ '2026-01-01T00:00:00Z' - (INTERVAL '1 minute' * g)
FROM generate_series(0,4) g;
SQL

echo "==> D2: idempotency replay (same event_id applied twice -> once)"
psql_db "$DB" -q >/dev/null <<'SQL'
-- apply event e0 (id 11110000-...) twice with identical args.
SELECT public.apply_mastery_event(
  '11111111-1111-1111-1111-111111111111','M','Algebra','s',2::smallint,'practice','practice_attempt',
   true, TIMESTAMPTZ '2026-01-01T00:00:00Z', '11110000-0000-0000-0000-000000000000'::uuid, 'SATM1ZZZZZZ');
SELECT public.apply_mastery_event(
  '11111111-1111-1111-1111-111111111111','M','Algebra','s',2::smallint,'practice','practice_attempt',
   true, TIMESTAMPTZ '2026-01-01T00:00:00Z', '11110000-0000-0000-0000-000000000000'::uuid, 'SATM1ZZZZZZ');
SQL
# F2 (05B/05C): the replayed call early-returns at the §4.3 audit-lookup BEFORE §4.9, so domain
# mastery (and its KPI fan-out) is refreshed exactly once too — not twice.
REPLAY=$(psql_db "$DB" -tAc "
  SELECT (SELECT count(*) FROM public.mastery_event_audit_log WHERE event_id='11110000-0000-0000-0000-000000000000')::text
      || '|' || (SELECT count(*) FROM public.student_skill_mastery  WHERE student_id='11111111-1111-1111-1111-111111111111')::text
      || '|' || (SELECT count(*) FROM public.student_domain_mastery WHERE student_id='11111111-1111-1111-1111-111111111111')::text;")
if [ "$REPLAY" = "1|1|1" ]; then echo "    OK exactly one audit + one skill + one domain row (§4.9 applied once)"
else echo "  FAIL: replay produced audit|skill|domain counts = $REPLAY (expected 1|1|1)"; exit 1; fi

echo "==> D1: transaction atomicity (insert+apply+mid-txn failure persists neither)"
# A DO block is one statement = one txn; the trailing RAISE aborts it, rolling back the insert+apply.
psql -d "$DB" -q >/dev/null 2>&1 <<'SQL' || true
DO $$
BEGIN
  INSERT INTO public.practice_session_items
    (id,session_id,user_id,ordinal,question_id,question_stem,question_options,question_correct_answer,
     question_explanation,question_domain,question_skill,question_difficulty,question_section,status,is_correct,occurred_at)
  VALUES ('2222000a-0000-0000-0000-000000000000','2222aaaa-0000-0000-0000-000000000000',
     '22222222-2222-2222-2222-222222222222',0,'SATM1ZZZZZZ','stem','[]'::jsonb,'A','expl','Algebra','s',2,'M','answered',true,
     TIMESTAMPTZ '2026-01-01T00:00:00Z');
  PERFORM public.apply_mastery_event(
    '22222222-2222-2222-2222-222222222222','M','Algebra','s',2::smallint,'practice','practice_attempt',
     true, TIMESTAMPTZ '2026-01-01T00:00:00Z', '2222000a-0000-0000-0000-000000000000'::uuid, 'SATM1ZZZZZZ');
  RAISE EXCEPTION 'LANE_C_TXN_ATOMICITY_PROBE: simulated mid-transaction failure';
END $$;
SQL
# F1 (05B/05C): with §4.9 wired, the SAME rollback must persist NOTHING across the WHOLE chain —
# answer + skill + domain + all 4 KPI + projection + snapshot + audit are one atomic unit, or none.
A=22222222-2222-2222-2222-222222222222
ATOMIC=$(psql_db "$DB" -tAc "
  SELECT (SELECT count(*) FROM public.practice_session_items            WHERE user_id='$A')
       + (SELECT count(*) FROM public.student_skill_mastery             WHERE student_id='$A')
       + (SELECT count(*) FROM public.student_domain_mastery            WHERE student_id='$A')
       + (SELECT count(*) FROM public.student_section_kpi               WHERE student_id='$A')
       + (SELECT count(*) FROM public.student_domain_kpi                WHERE student_id='$A')
       + (SELECT count(*) FROM public.student_skill_kpi                 WHERE student_id='$A')
       + (SELECT count(*) FROM public.student_overall_kpi               WHERE student_id='$A')
       + (SELECT count(*) FROM public.student_section_projections       WHERE student_id='$A')
       + (SELECT count(*) FROM public.student_section_projection_snapshots WHERE student_id='$A')
       + (SELECT count(*) FROM public.mastery_event_audit_log           WHERE student_id='$A');")
if [ "$ATOMIC" = "0" ]; then echo "    OK rollback persisted NOTHING across answer+skill+domain+4KPI+projection+snapshot+audit"
else echo "  FAIL: atomicity probe left $ATOMIC total rows across the chain (expected 0 — torn write)"; exit 1; fi

echo "==> D1b: RPC SELF-ENFORCES (refuses a non-derived event with NO caller-txn protection)"
# Plant the torn write directly: call apply_mastery_event (autocommit, no wrapping txn) for an
# event_id that has NO answer row in canonical_mastery_events. The RPC must REFUSE
# (MASTERY_EVENT_NOT_DERIVED) — this proves the seam, not the caller's transaction. Student A has
# zero items (D1's insert rolled back).
if psql -d "$DB" -c "SELECT public.apply_mastery_event(
     '22222222-2222-2222-2222-222222222222','M','Algebra','s',2::smallint,'practice','practice_attempt',
      true, TIMESTAMPTZ '2026-01-01T00:00:00Z', 'dead0000-0000-0000-0000-000000000000'::uuid, 'SATM1ZZZZZZ');" >/dev/null 2>&1; then
  echo "  FAIL: RPC accepted an event absent from canonical_mastery_events (torn write possible)"; exit 1
else echo "    OK RPC refused the non-derived event (MASTERY_EVENT_NOT_DERIVED) — self-enforcing"; fi
SELFENF=$(psql_db "$DB" -tAc "
  SELECT (SELECT count(*) FROM public.student_skill_mastery WHERE student_id='22222222-2222-2222-2222-222222222222')::text
      || '|' || (SELECT count(*) FROM public.mastery_event_audit_log WHERE student_id='22222222-2222-2222-2222-222222222222')::text;")
if [ "$SELFENF" = "0|0" ]; then echo "    OK refused RPC wrote nothing (mastery|audit = 0|0)"
else echo "  FAIL: refused RPC still wrote rows (mastery|audit) = $SELFENF"; exit 1; fi

echo "==> F3: hot-path latency — common path AND every-40th spike path (HALT-4)"
# Student C + 40 answered items; apply each in-SQL (no psql connection overhead). The 20th apply is
# the COMMON path (skill+domain+4 KPI, counter<40, no projection); the 40th is the SPIKE path where
# bump_projection_refresh_counter crosses the threshold and fires compute_section_projection for BOTH
# sections in the same txn. Both must stay within budget; if the spike blows up, FAIL here (the fix
# is throttle-tuning or async), not in production.
psql_db "$DB" -q >/dev/null <<'SQL'
INSERT INTO auth.users (id,email) VALUES ('33333333-3333-3333-3333-333333333333','c@ci');
INSERT INTO public.profiles (id,email) VALUES ('33333333-3333-3333-3333-333333333333','c@ci');
INSERT INTO public.practice_sessions (id,user_id,mode,target_count,platform,client_instance_id) VALUES
  ('3333aaaa-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','flow',40,'web','ci');
INSERT INTO public.practice_session_items
  (id,session_id,user_id,ordinal,question_id,question_stem,question_options,question_correct_answer,
   question_explanation,question_domain,question_skill,question_difficulty,question_section,status,is_correct,occurred_at)
SELECT ('33330000-0000-0000-0000-0000000000'||lpad(g::text,2,'0'))::uuid, '3333aaaa-0000-0000-0000-000000000000',
       '33333333-3333-3333-3333-333333333333', g,'SATM1ZZZZZZ','stem','[]'::jsonb,'A','expl','Algebra','s',2,'M','answered',true,
       TIMESTAMPTZ '2026-01-01T00:00:00Z' - (INTERVAL '1 minute' * g)
FROM generate_series(0,39) g;
SQL
if psql_db "$DB" -q 2>/tmp/lanec_lat.txt <<'SQL'
DO $$
DECLARE i int; t0 timestamptz; t_common numeric := 0; t_spike numeric := 0;
BEGIN
  FOR i IN 0..39 LOOP
    t0 := clock_timestamp();
    PERFORM public.apply_mastery_event(
      '33333333-3333-3333-3333-333333333333','M','Algebra','s',2::smallint,'practice','practice_attempt',
       true, TIMESTAMPTZ '2026-01-01T00:00:00Z' - (INTERVAL '1 minute'*i),
       ('33330000-0000-0000-0000-0000000000'||lpad(i::text,2,'0'))::uuid, 'SATM1ZZZZZZ');
    IF i = 19 THEN t_common := extract(epoch from clock_timestamp()-t0)*1000; END IF;
    IF i = 39 THEN t_spike  := extract(epoch from clock_timestamp()-t0)*1000; END IF;
  END LOOP;
  RAISE NOTICE 'LATENCY common_ms=% spike_ms=%', round(t_common,1), round(t_spike,1);
  -- Budget: bounded absolute ceilings (generous for CI cold-cache) + the spike must not blow up vs
  -- the common path (projection is bounded work — a few queries, not O(history)).
  IF t_common > 1500 OR t_spike > 3000 OR (t_common > 0 AND t_spike > t_common * 12) THEN
    RAISE EXCEPTION 'LANE_C_LATENCY_BUDGET exceeded: common_ms=% spike_ms=% (ceiling: common<1500, spike<3000, spike<12x common)', t_common, t_spike;
  END IF;
END $$;
SQL
then echo "    OK $(grep -oE 'common_ms=[0-9.]+ spike_ms=[0-9.]+' /tmp/lanec_lat.txt | head -1) — common + every-40th spike within budget"
else echo "  FAIL: $(grep -oE 'LANE_C_LATENCY_BUDGET.*' /tmp/lanec_lat.txt | head -1)"; rm -f /tmp/lanec_lat.txt; exit 1; fi
rm -f /tmp/lanec_lat.txt

echo "LANE-C SEAM GATES: PASS"
