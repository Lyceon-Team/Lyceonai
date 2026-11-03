#!/usr/bin/env bash
# LISA retrieval by segment — mutation harness.
#
# @spec [Doc-03D_V1.2 §6.4 as amended by SCL-260; §6.8 as amended by SCL-261; owner brief
#       "Phase C: retrieval switch-over", Karl 2026-10-29] | @implemented [2026-10-29]
#
# Each plant breaks ONE rule of supabase/migrations/20261125000000_lisa_segment_retrieval.sql and
# must turn scripts/ci/video-segment-retrieval-gates.sql red on a NAMED gate. Same rules as the
# other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other gate is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function edits the migration that LAST defines it.
#
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261125000000_lisa_segment_retrieval.sql"
GATES="scripts/ci/video-segment-retrieval-gates.sql"
TEMPLATE=vsr_mut_template
DB=vsr_mut
PASS=0; FAIL=0
BACKUP="$(mktemp /tmp/vsr-mut.XXXX)"
cp "$MIG" "$BACKUP"
cleanup() {
  cp "$BACKUP" "$MIG"; rm -f "$BACKUP"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "DROP DATABASE IF EXISTS $TEMPLATE;" >/dev/null 2>&1
}
trap cleanup EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "VIDEO SEGMENT RETRIEVAL MUTATIONS: no Postgres at $PGHOST:$PGPORT — the plants need it (a skip is not a pass)"
  exit 1
fi

# plant <old> <new> — exactly one occurrence in the migration, or STALE.
plant() {
  python3 - "$MIG" "$1" "$2" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write("STALE: target found %d times in %s (expected exactly 1)\n" % (n, p))
    sys.exit(9)
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

# plant_between <start> <end> <new> — replace the text from the start anchor through the end
# anchor (both found exactly once, start before end), or STALE.
plant_between() {
  python3 - "$MIG" "$1" "$2" "$3" <<'PY'
import io, sys
p, start, end, new = sys.argv[1:5]
s = io.open(p, encoding="utf-8").read()
if s.count(start) != 1 or s.count(end) != 1 or s.index(start) > s.index(end):
    sys.stderr.write("STALE: range anchors not found exactly once, in order, in %s\n" % p)
    sys.exit(9)
i, j = s.index(start), s.index(end) + len(end)
io.open(p, "w", encoding="utf-8").write(s[:i] + new + s[j:])
PY
}

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }
for fn in video_segments_for_question; do
  [ "$(last_definer "$fn")" = "$MIG" ] || { bad "RULE 3: $fn is last defined in $(last_definer "$fn"), not $MIG"; exit 1; }
done

# Pipeline order is kept: the migrations BEFORE the one under test go into a template once; each
# plant clones it, applies the (planted) migration, then every migration AFTER it.
BEFORE=(); AFTER=()
for f in supabase/migrations/*.sql; do
  if [ "$f" = "$MIG" ]; then continue
  elif [[ "$f" < "$MIG" ]]; then BEFORE+=("$f")
  else AFTER+=("$f"); fi
done
echo "=== building template (the ${#BEFORE[@]} migrations before $MIG; ${#AFTER[@]} after apply per check) ==="
psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "DROP DATABASE IF EXISTS $TEMPLATE;" -c "CREATE DATABASE $TEMPLATE;" >/dev/null
psql -v ON_ERROR_STOP=1 -q -d "$TEMPLATE" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
for f in "${BEFORE[@]}"; do
  psql -v ON_ERROR_STOP=1 -q -d "$TEMPLATE" -f "$f" >/dev/null 2>&1 || { bad "template: $f failed to apply"; exit 1; }
done

# check — clone the template, apply the (possibly planted) migration and the ones after it, run
# the gates.
check() {
  local f
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB TEMPLATE $TEMPLATE;" >/dev/null
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$MIG" >/dev/null 2>&1 || { echo "MIGRATION FAILED TO APPLY"; return 3; }
  for f in "${AFTER[@]}"; do
    psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "LATER MIGRATION FAILED TO APPLY: $f"; return 3; }
  done
  psql -v ON_ERROR_STOP=1 -d "$DB" -f "$GATES" 2>&1
}

run() {  # run <name> <expected substring>
  local out rc
  out="$(check)"; rc=$?
  if [ "$rc" = 0 ]; then bad "$1: gates stayed GREEN (the plant was not caught)"
  else case "$out" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$out" | grep -E "FAILED|ERROR" | head -5 ;;
  esac; fi
  cp "$BACKUP" "$MIG"
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check)"; RC=$?
if [ "$RC" = 0 ] && grep -q "VIDEO SEGMENT RETRIEVAL GATES: PASS" <<<"$OUT"; then ok "gates green"; else bad "gates not green"; echo "$OUT" | tail -20; fi

echo "=== (1) plants ==="
plant "    WHERE s.approved_by IS NOT NULL                                -- approved segments only" "    WHERE true" || { bad "P1 STALE"; exit 1; }
run "P1 an unapproved segment served" "VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED: R4"

plant "      AND v.approved_by IS NOT NULL" "" || { bad "P2 STALE"; exit 1; }
run "P2 a segment of an unapproved video served" "VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED: R1"

plant_between "      AND (NOT coalesce(p_method_required, false)" "OR (p_method IS NOT NULL AND p_method = ANY (v.methods)))" "      AND true" || { bad "P3 STALE"; exit 1; }
run "P3 the Desmos tap's requirement dropped" "VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED: R3"

plant "    SELECT c.id FROM public.clusters c WHERE c.method_in ?| p_skill_codes" "    SELECT c.id FROM public.clusters c WHERE false" || { bad "P4 STALE"; exit 1; }
run "P4 method_in clusters no longer present by default" "VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED: R7"

plant "      AND m.matched IS NOT NULL                                    -- shares a sub-skill" "" || { bad "P5 STALE"; exit 1; }
run "P5 a segment served without a shared sub-skill" "VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED: R1"

plant "    cardinality(b.matched) DESC,                                     -- 1. shared sub-skills" "" || { bad "P6 STALE"; exit 1; }
run "P6 shared sub-skills no longer rank first" "VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED: R3"

plant_between "REVOKE ALL ON FUNCTION public.video_segments_for_question" "  FROM PUBLIC, anon, authenticated;" "" || { bad "P7 STALE"; exit 1; }
run "P7 the function left executable by PUBLIC" "VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED: R8"

echo "VIDEO SEGMENT RETRIEVAL MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
