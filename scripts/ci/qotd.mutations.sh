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
MIG_READ="supabase/migrations/20261031000000_qotd_readability_scheduler.sql"
DB=qotd_mutations
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/qotd-mut.XXXX)"

FILES=(
  "$MIG"
  "$MIG_READ"
  "shared/qotd/readability.ts"
  "server/services/qotd/qotd-service.ts"
  "packages/shared/src/qotd-schema.ts"
  "client/src/prerender/entry-server.tsx"
  "client/src/components/qotd/QotdWidget.tsx"
  "shared/qotd/social.ts"
  "scripts/qotd-social/generate.ts"
  "server/services/qotd/schedule-job.ts"
  "server/routes/public-qotd-routes.ts"
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
SOCIAL=tests/ci/qotd-social.test.ts
SCHED=tests/ci/qotd-schedule-job.test.ts
READ=tests/ci/qotd-readability.test.ts

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
OUT="$(ts_check "$ROUTES" "$PAGES" "$WIDGET" "$SOCIAL" "$SCHED" "$READ")"; RC=$?
[ "$RC" = 0 ] && ok "route + page + widget + social + scheduler tests green" || { bad "route + page + widget + social + scheduler tests not green"; echo "$OUT" | tail -30; }
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
# Anchored on the pre-submit schema's own options line: qotdSocialInputSchema also has a
# `correct_answer: z.null(),` line (2026-10-07), and a bare anchor would be ambiguous.
plant packages/shared/src/qotd-schema.ts \
  $'    options: z.array(qotdServedOptionSchema),\n    correct_answer: z.null(),' \
  $'    options: z.array(qotdServedOptionSchema),\n    correct_answer: z.string().nullable(),' || { bad "M4 STALE"; exit 1; }
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

# Social assets (owner decisions 2026-10-07): the leak check must catch the answer in a caption,
# the archive's answer must not ride into the input, and no future day may be built.
echo "=== (10) socialAssetLeaks stops checking the grid-in answer ==="
plant shared/qotd/social.ts \
  "      containsPhrase(haystack, keyed) &&" \
  "      false &&" || { bad "M10 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M10 grid-in answer in caption passes" "grid-in: the keyed value in the caption" "$OUT" "$RC"
restore

echo "=== (11) socialAssetLeaks stops checking the caption for the correct choice ==="
plant shared/qotd/social.ts \
  "    if (correct && containsPhrase(normalize(output.caption), correct.text)) {" \
  "    if (false) {" || { bad "M11 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M11 correct choice in caption passes" "MCQ: the correct choice's text in the caption" "$OUT" "$RC"
restore

echo "=== (12) LEAK: the archive's correct choice rides into the social input ==="
plant shared/qotd/social.ts \
  "    options: q.options.map((o) => ({ text: o.text }))," \
  "    options: q.options.map((o) => ({ text: o.text, correct: o.id === q.correct_option_id }))," || { bad "M12 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M12 answer in input" "drops the archive's answer and explanation before anything is built" "$OUT" "$RC"
restore

echo "=== (13) a day that has not passed can be built (< becomes <=) ==="
plant scripts/qotd-social/generate.ts \
  "  return date < today" \
  "  return date <= today" || { bad "M13 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M13 today buildable by date" "a date is buildable only once it has passed in America/Chicago" "$OUT" "$RC"
restore

echo "=== (14) the scheduler stops skipping a stem that repeats its passage (owner 2026-10-08) ==="
plant server/services/qotd/schedule-job.ts \
  '  if (stemRepeatsPassage(c.stem ?? "", c.passage)) {' \
  "  if (false) {" || { bad "M14 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M14 prompt-less question scheduled" "skips a question whose stem repeats its passage" "$OUT" "$RC"
restore

# Owner 2026-10-08: a past day whose stem repeats its passage is not published.
echo "=== (15) the build publishes a prompt-less past day (page + sitemap) ==="
plant client/src/prerender/entry-server.tsx \
  "    stemRepeatsPassage(d.question.stem, d.question.passage)," \
  "    false," || { bad "M15 STALE"; exit 1; }
OUT="$(ts_check "$PAGES")"; RC=$?
expect_red "M15 broken day prerendered" "no page, no sitemap entry, no hub link" "$OUT" "$RC"
restore

echo "=== (16) the hub's archive list links a prompt-less past day ==="
plant server/services/qotd/qotd-service.ts \
  "  return parsed.data.filter((r) => isPublishableArchiveRow(r));" \
  "  return parsed.data;" || { bad "M16 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M16 broken day listed" "not in GET /archive and 404 on GET /:date while broken" "$OUT" "$RC"
restore

echo "=== (17) GET /:date serves a prompt-less past day ==="
plant server/routes/public-qotd-routes.ts \
  "      if (!row || !isPublishableArchiveRow(row)) {" \
  "      if (!row) {" || { bad "M17 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M17 broken day served" "not in GET /archive and 404 on GET /:date while broken" "$OUT" "$RC"
restore

# Owner brief "QOTD — readability filter (Karl's option B)", 2026-10-09: removing each rule turns
# its test red.
echo "=== (18) a grid-in is scheduled (multiple choice only removed) ==="
plant shared/qotd/readability.ts \
  '  if (q.itemType !== "mcq") return "not_multiple_choice";' \
  "" || { bad "M18 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M18 grid-in scheduled" "a grid-in is skipped" "$OUT" "$RC"
restore

echo "=== (19) a paired-passage item is scheduled ==="
plant shared/qotd/readability.ts \
  '  if (isPairedPassage(q.passage)) return "paired_passage";' \
  "" || { bad "M19 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M19 paired passage scheduled" "a paired-passage item" "$OUT" "$RC"
restore

echo "=== (20) an over-length Math item is scheduled ==="
plant shared/qotd/readability.ts \
  '    return total > QOTD_MATH_MAX_CHARS ? "math_too_long" : null;' \
  "    return null;" || { bad "M20 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M20 long Math scheduled" "an over-length Math item" "$OUT" "$RC"
restore

echo "=== (21) an over-length Reading and Writing passage is scheduled ==="
plant shared/qotd/readability.ts \
  '  return passage.length > QOTD_RW_MAX_PASSAGE_CHARS' \
  '  return passage.length > Number.MAX_SAFE_INTEGER' || { bad "M21 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M21 long RW scheduled" "an over-length Reading and Writing passage" "$OUT" "$RC"
restore

echo "=== (22) the scheduler stops paging: readable questions behind a page of long ones are lost ==="
plant server/services/qotd/schedule-job.ts \
  "      afterId = last.question_id;" \
  "      break;" || { bad "M22 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M22 no paging" "pages past a full page of long items" "$OUT" "$RC"
restore

echo "=== (23) unreadable upcoming days are left in place ==="
plant server/services/qotd/schedule-job.ts \
  "    if (reason === null) continue;" \
  "    continue;" || { bad "M23 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M23 upcoming not replaced" "replaces only UPCOMING days" "$OUT" "$RC"
restore

echo "=== (24) the social generator stops applying the readability rules ==="
plant shared/qotd/social.ts \
  "  if (unreadable !== null) {" \
  "  if (false) {" || { bad "M24 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M24 social disagrees with the scheduler" "refuses a day the scheduler would refuse" "$OUT" "$RC"
restore

if [ "$HAVE_PG" = 1 ]; then
  echo "=== (25) the release guard is removed: past days (and today) can be replaced ==="
  [ "$(last_definer qotd_schedule_release)" = "$MIG_READ" ] || { bad "M25 targets $MIG_READ but qotd_schedule_release is last defined in $(last_definer qotd_schedule_release)"; exit 1; }
  plant "$MIG_READ" "  IF p_date <= public.qotd_today() THEN" "  IF false THEN" || { bad "M25 STALE"; exit 1; }
  OUT="$(sql_check)"; RC=$?
  expect_red "M25 past day released" "Q-09 a past day was released" "$OUT" "$RC"
  restore
fi

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$ROUTES" "$PAGES" "$WIDGET" "$SOCIAL" "$SCHED" "$READ")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "QOTD MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
