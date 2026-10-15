#!/usr/bin/env bash
# LISA curriculum retrieval store — mutation harness.
#
# @spec [LISA_Video_RAG_Plan.md Step C (revised 2026-10-15, pgvector; SCL-231 PROPOSED),
#       Step F tests; closure plan R-12] | @implemented [2026-10-15]
#
# Each plant breaks ONE rule of supabase/migrations/20261101010000_lisa_curriculum_chunks.sql and
# must turn scripts/ci/curriculum-chunks-gates.sql red on a NAMED gate. Same rules as the other
# *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other gate is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function edits the migration that LAST defines it.
#
# P3 is the one that matters most: it plants the bare "WHERE skill && ... ORDER BY distance
# LIMIT n" form, which under an HNSW plan filters the index's candidates after the scan and
# comes back short (it returned 1 of 3 when first planted, 2026-10-15).
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261101010000_lisa_curriculum_chunks.sql"
GATES="scripts/ci/curriculum-chunks-gates.sql"
TEMPLATE=cc_mut_template
DB=cc_mut
PASS=0; FAIL=0
BACKUP="$(mktemp /tmp/cc-mut.XXXX)"
cp "$MIG" "$BACKUP"
cleanup() {
  cp "$BACKUP" "$MIG"; rm -f "$BACKUP"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "DROP DATABASE IF EXISTS $TEMPLATE;" >/dev/null 2>&1
}
trap cleanup EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "CURRICULUM CHUNKS MUTATIONS: no Postgres at $PGHOST:$PGPORT — the plants need it (a skip is not a pass)"
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
for fn in curriculum_chunks_search curriculum_chunk_upsert; do
  [ "$(last_definer "$fn")" = "$MIG" ] || { bad "RULE 3: $fn is last defined in $(last_definer "$fn"), not $MIG"; exit 1; }
done

# Every migration but the one under test goes into a template once; each plant clones it and
# applies only the (planted) migration.
echo "=== building template (pipeline minus $MIG) ==="
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
for f in supabase/migrations/*.sql; do
  [ "$f" = "$MIG" ] && continue
  psql -v ON_ERROR_STOP=1 -q -d "$TEMPLATE" -f "$f" >/dev/null 2>&1 || { bad "template: $f failed to apply"; exit 1; }
done

# check — clone the template, apply the (possibly planted) migration, run the gates.
check() {
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB TEMPLATE $TEMPLATE;" >/dev/null
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$MIG" >/dev/null 2>&1 || { echo "MIGRATION FAILED TO APPLY"; return 3; }
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
if [ "$RC" = 0 ] && grep -q "CURRICULUM CHUNKS GATES: PASS" <<<"$OUT"; then ok "gates green"; else bad "gates not green"; echo "$OUT" | tail -20; fi

echo "=== (1) plants ==="
plant "      AND c.skill_codes && p_skill_codes            -- GIN index: the exact skill filter
" "" || { bad "P1 STALE"; exit 1; }
run "P1 skill filter dropped from the search" "CURRICULUM_GATE_FAILED: R1"

plant "    WHERE c.status = 'active'
      AND c.skill_codes" "    WHERE true
      AND c.skill_codes" || { bad "P2 STALE"; exit 1; }
run "P2 status filter dropped (retired/pending served)" "CURRICULUM_GATE_FAILED: R2"

plant_between "  WITH candidates AS MATERIALIZED (" "  LIMIT greatest(1, least(coalesce(p_limit, 3), 20));" \
"  SELECT c.id, c.content, c.skill_codes, c.provenance, c.surface_gate, c.content_type,
         1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding) AS score
  FROM public.curriculum_chunks c
  WHERE c.status = 'active' AND c.skill_codes && p_skill_codes
  ORDER BY c.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT p_limit;" || { bad "P3 STALE"; exit 1; }
run "P3 bare ORDER BY/LIMIT over HNSW (the brief's form)" "CURRICULUM_GATE_FAILED: R3"

plant "ORDER BY k.distance, k.id " "ORDER BY k.distance, k.id DESC " || { bad "P4 STALE"; exit 1; }
run "P4 tie-break not by ascending id" "CURRICULUM_GATE_FAILED: R4"

plant "    CHECK (status <> 'active' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))" "    CHECK (true)" || { bad "P5 STALE"; exit 1; }
run "P5 review CHECK removed (active without a reviewer)" "pg_temp.axis(1), 'active')"

plant "CHECK (cardinality(skill_codes) >= 1)" "CHECK (array_length(skill_codes, 1) >= 1)" || { bad "P6 STALE"; exit 1; }
run "P6 array_length non-empty check (passes '{}')" "VALUES ('x', ARRAY[]::text[]"

{ plant "      ELSE 'pending_review'" "      ELSE c.status" \
  && plant "        THEN c.reviewed_by
      ELSE NULL" "        THEN c.reviewed_by
      ELSE c.reviewed_by" \
  && plant "        THEN c.reviewed_at
      ELSE NULL" "        THEN c.reviewed_at
      ELSE c.reviewed_at"; } || { bad "P7 STALE"; exit 1; }
run "P7 changed segment keeps its approval on re-ingest" "CURRICULUM_GATE_FAILED: U1 changed content stayed live"

echo "CURRICULUM CHUNKS MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
