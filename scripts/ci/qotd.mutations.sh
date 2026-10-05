#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the Question of the Day (SEO Wave 2, plan Q1-Q3, SCL-202)
# ============================================================================
# @spec [docs/plans/seo/seo-marketing-vertical.md Q1/Q2 acceptance ("planted mutations: a
#   pre-submit answer leak; allowing a repeat schedule")] | @implemented [2026-10-05]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants and the files are
#            restored after each one (and on exit).
#
# SQL plants edit the migration that DEFINES the object today. Before adding one, confirm it is
# still the last definition (CLAUDE.md, "a migration that replaces a function body orphans its
# mutations"):  grep -ln 'FUNCTION public\.qotd_question_for' supabase/migrations/*.sql | sort | tail -1
# The harness re-checks that for every SQL plant and fails if a later migration took it over.
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`
# (SIGPIPE has produced false "did not fire" reports elsewhere).
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261020000000_qotd_schema.sql"
DB=qotd_mutations
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/qotd-mut.XXXX)"

FILES=(
  "$MIG"
  "server/services/qotd/qotd-service.ts"
  "packages/shared/src/qotd-schema.ts"
  "client/src/prerender/entry-server.tsx"
  "client/src/components/qotd/QotdWidget.tsx"
)
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new>  — exactly one occurrence, or STALE (exit 9).
plant() {
  python3 - "$1" "$2" "$3" <<'PY'
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

# The SQL check: a fresh database from the whole pipeline, then the QOTD gates.
HAVE_PG=1
if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then HAVE_PG=0; fi
sql_check() {
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1 || return 2
  psql -v ON_ERROR_STOP=1 -q -d "$DB" >/dev/null 2>&1 <<'SQL' || return 2
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
  for f in supabase/migrations/*.sql; do
    psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "pipeline failed at $f"; return 2; }
  done
  psql -v ON_ERROR_STOP=1 -d "$DB" -f scripts/ci/qotd-schema-gates.sql 2>&1
}

# The TS checks: the route contract test and the prerender output test.
ts_check() { pnpm exec vitest run "$@" 2>&1; }
ROUTES=tests/ci/public-qotd-routes.contract.test.ts
PAGES=tests/seo.qotd-pages.test.ts
WIDGET=client/src/components/qotd/QotdWidget.test.tsx

# expect_red <name> <expected substring> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

# last_definer <function> — the plant must target the migration that defines it LAST.
last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }

echo "=== (0) GREEN BASELINE ==="
if [ "$HAVE_PG" = 1 ]; then
  OUT="$(sql_check)"; RC=$?
  case "$OUT" in *"QOTD SCHEMA GATES: PASS"*) [ "$RC" = 0 ] && ok "SQL gates green" || bad "SQL gates printed PASS but exited $RC" ;; *) bad "SQL gates not green"; echo "$OUT" | tail -20 ;; esac
else
  echo "  SKIP  SQL plants — no Postgres at $PGHOST:$PGPORT (a skip, not a pass)"
fi
OUT="$(ts_check "$ROUTES" "$PAGES" "$WIDGET")"; RC=$?
[ "$RC" = 0 ] && ok "route + page + widget tests green" || { bad "route + page + widget tests not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "QOTD MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

if [ "$HAVE_PG" = 1 ]; then
  echo "=== (1) allow a repeat schedule: drop UNIQUE on qotd_schedule.question_id ==="
  plant "$MIG" "question_id text        NOT NULL UNIQUE REFERENCES public.questions(id)," \
               "question_id text        NOT NULL REFERENCES public.questions(id)," || { bad "M1 STALE"; exit 1; }
  OUT="$(sql_check)"; RC=$?
  expect_red "M1 repeat schedule allowed" "Q-01 qotd_schedule.question_id is not UNIQUE" "$OUT" "$RC"
  restore

  echo "=== (2) a future day becomes readable (qotd_question_for drops its <= today bound) ==="
  [ "$(last_definer qotd_question_for)" = "$MIG" ] || { bad "M2 targets $MIG but qotd_question_for is last defined in $(last_definer qotd_question_for)"; exit 1; }
  plant "$MIG" "     AND s.qotd_date <= public.qotd_today()" "     AND TRUE" || { bad "M2 STALE"; exit 1; }
  OUT="$(sql_check)"; RC=$?
  expect_red "M2 future day readable" "Q-06 tomorrow is readable" "$OUT" "$RC"
  restore
fi

echo "=== (3) pre-submit answer leak in the service (strict schema left in place) ==="
plant server/services/qotd/qotd-service.ts \
  "      correct_answer: projected.correct_answer," \
  "      correct_answer: row.correct_answer," || { bad "M3 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M3 service leak" "returns the question with correct_answer and explanation null" "$OUT" "$RC"
restore

echo "=== (4) pre-submit answer leak through a loosened schema (service AND schema) ==="
plant server/services/qotd/qotd-service.ts \
  "      correct_answer: projected.correct_answer," \
  "      correct_answer: row.correct_answer," || { bad "M4 STALE"; exit 1; }
plant packages/shared/src/qotd-schema.ts \
  "    correct_answer: z.null()," \
  "    correct_answer: z.string().nullable()," || { bad "M4 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M4 schema + service leak" "returns the question with correct_answer and explanation null" "$OUT" "$RC"
restore

echo "=== (5) the build emits today's archive page (prerender guard < becomes <=) ==="
plant client/src/prerender/entry-server.tsx \
  "loaded.days.filter((d) => d.qotd_date < today)" \
  "loaded.days.filter((d) => d.qotd_date <= today)" || { bad "M5 STALE"; exit 1; }
OUT="$(ts_check "$PAGES")"; RC=$?
expect_red "M5 today prerendered" "builds one page per past day, and none for today" "$OUT" "$RC"
restore

# Owner ruling 2026-10-05 (QOTD follow-up): shuffled, tokenised options; one answer per visit.
echo "=== (6) LEAK: today's options carry the canonical letter instead of the token ==="
plant server/services/qotd/qotd-service.ts \
  "    id: qotdOptionToken(row.qotd_date, o.key)," \
  "    id: o.key," || { bad "M6 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M6 canonical letter served" "returns the question with correct_answer and explanation null" "$OUT" "$RC"
restore

echo "=== (7) the per-request shuffle is removed ==="
plant server/services/qotd/qotd-service.ts \
  "    : fisherYates(options);" \
  "    : options;" || { bad "M7 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M7 no shuffle" "two requests (and more) return different option orders" "$OUT" "$RC"
restore

echo "=== (8) a bare canonical letter is accepted as an answer ==="
plant server/services/qotd/qotd-service.ts \
  "  if (tokenMap && !Object.prototype.hasOwnProperty.call(tokenMap, answer)) {" \
  "  if (tokenMap && false) {" || { bad "M8 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M8 letter accepted" "a bare canonical letter is rejected" "$OUT" "$RC"
restore

echo "=== (9) the one-answer-per-visit lock is removed: the answer controls stay after the reveal ==="
# The submit area is gated on the result; the renderer also disables choices once a result is
# shown, so a plant on the \`locked\` flag alone is masked (measured: it stayed green). This one
# removes the gate itself, which is what lets a visitor answer again.
plant client/src/components/qotd/QotdWidget.tsx \
  "      {result ? (" \
  "      {false ? (" || { bad "M9 STALE"; exit 1; }
OUT="$(ts_check "$WIDGET")"; RC=$?
expect_red "M9 no lock" "one answer per visit" "$OUT" "$RC"
restore

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$ROUTES" "$PAGES" "$WIDGET")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "QOTD MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
