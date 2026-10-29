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
# SCL-258 (shuffle once): the last definer of qotd_question_for, qotd_archive and qotd_schedule_insert.
MIG_SHUF="supabase/migrations/20261123000000_qotd_shuffle_once.sql"
DB=qotd_mutations
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/qotd-mut.XXXX)"

FILES=(
  "$MIG"
  "$MIG_READ"
  "$MIG_SHUF"
  "shared/qotd/readability.ts"
  "server/services/qotd/qotd-service.ts"
  "packages/shared/src/qotd-schema.ts"
  "client/src/prerender/entry-server.tsx"
  "client/src/components/qotd/QotdWidget.tsx"
  "shared/qotd/social.ts"
  "scripts/qotd-social/generate.ts"
  "server/services/qotd/schedule-job.ts"
  "server/routes/public-qotd-routes.ts"
  "shared/qotd/reveal.ts"
  "scripts/qotd-social/post-to-slack.ts"
  "shared/qotd/tiktok.ts"
  "client/src/components/qotd/QotdTiktokSlide.tsx"
  "shared/slack/client.ts"
  "shared/qotd/projection.ts"
  ".github/workflows/qotd-social.yml"
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
AGREE=tests/ci/qotd-served-order.test.ts

# The backfill check (SCL-258): its own database, every migration before the shuffle one, then it.
backfill_check() { QOTD_BACKFILL_DB=qotd_mutations_backfill bash scripts/ci/qotd-shuffle-backfill-gates.sh 2>&1; }

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
OUT="$(ts_check "$ROUTES" "$PAGES" "$WIDGET" "$SOCIAL" "$SCHED" "$READ" "$AGREE")"; RC=$?
[ "$RC" = 0 ] && ok "route + page + widget + social + scheduler + served-order tests green" || { bad "route + page + widget + social + scheduler + served-order tests not green"; echo "$OUT" | tail -30; }
if [ "$HAVE_PG" = 1 ]; then
  OUT="$(backfill_check)"; RC=$?
  case "$OUT" in *"QOTD SHUFFLE BACKFILL GATES: PASS"*) [ "$RC" = 0 ] && ok "backfill gates green" || bad "backfill gates printed PASS but exited $RC" ;; *) bad "backfill gates not green"; echo "$OUT" | tail -20 ;; esac
fi
if [ "$FAIL" -gt 0 ]; then echo "QOTD MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

if [ "$HAVE_PG" = 1 ]; then
  echo "=== (1) allow a repeat schedule: drop UNIQUE on qotd_schedule.question_id ==="
  plant "$MIG" "question_id text        NOT NULL UNIQUE REFERENCES public.questions(id)," \
               "question_id text        NOT NULL REFERENCES public.questions(id)," || { bad "M1 STALE"; exit 1; }
  OUT="$(sql_check)"; RC=$?
  expect_red "M1 repeat schedule allowed" "Q-01 qotd_schedule.question_id is not UNIQUE" "$OUT" "$RC"
  restore

  echo "=== (2) a future day becomes readable (qotd_question_for drops its <= today bound) ==="
  # Re-pointed to $MIG_SHUF (SCL-258), which replaced qotd_question_for's body.
  [ "$(last_definer qotd_question_for)" = "$MIG_SHUF" ] || { bad "M2 targets $MIG_SHUF but qotd_question_for is last defined in $(last_definer qotd_question_for)"; exit 1; }
  plant "$MIG_SHUF" "     AND s.qotd_date <= public.qotd_today()" "     AND TRUE" || { bad "M2 STALE"; exit 1; }
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
  "    id: qotdOptionToken(row.qotd_date, o.id)," \
  "    id: o.id," || { bad "M6 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M6 canonical letter served" "returns the question with correct_answer and explanation null" "$OUT" "$RC"
restore

# Re-pointed 2026-10-23 (canonical order), and again 2026-10-28 (SCL-258: the stored order), so
# the defect is any reordering of today's options away from the day's stored order.
echo "=== (7) today's options leave the stored order ==="
plant server/services/qotd/qotd-service.ts \
  "  return qotdServedChoices(row).options.map((o) => ({" \
  "  return [...qotdServedChoices(row).options].reverse().map((o) => ({" || { bad "M7 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M7 not the stored order" "every request serves the four options in the day's stored order" "$OUT" "$RC"
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

# Re-pointed 2026-10-15: the caption check now reads a choice raw or as plain text (showsChoice).
echo "=== (11) socialAssetLeaks stops checking the caption for the correct choice ==="
plant shared/qotd/social.ts \
  "    if (correct && showsChoice(normalize(output.caption), correct.text)) {" \
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
expect_red "M13 today buildable by date" "a date is buildable only once its QOTD day (04:00 UTC to 04:00 UTC) has passed" "$OUT" "$RC"
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
  '  if (passage.length > QOTD_RW_MAX_PASSAGE_CHARS) return "rw_passage_too_long";' \
  '' || { bad "M21 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M21 long RW scheduled" "an over-length Reading and Writing passage" "$OUT" "$RC"
restore

echo "=== (26) a Reading and Writing item with a short passage and a long question is scheduled ==="
plant shared/qotd/readability.ts \
  '  return total > QOTD_RW_MAX_TOTAL_CHARS ? "rw_too_long" : null;' \
  '  return null;' || { bad "M26 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M26 RW long question scheduled" "a short passage and a long question" "$OUT" "$RC"
OUT="$(ts_check "$READ")"; RC=$?
expect_red "M26b RW total cap gone (predicate)" "a short passage with a long question is refused" "$OUT" "$RC"
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

# Yesterday's reveal and today's Reddit post (owner brief "QOTD Slack post — add yesterday's
# reveal", Karl, 2026-10-15): the reveal is always yesterday's, never today's; the leak check still
# covers every one of today's messages (the Reddit post included); a withheld yesterday posts the
# notice and nothing else.
echo "=== (26) 'yesterday' is computed as the posted day itself ==="
plant packages/shared/src/qotd-schema.ts \
  "  d.setUTCDate(d.getUTCDate() - 1);" \
  "  d.setUTCDate(d.getUTCDate());" || { bad "M26 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M26 reveal is today's" "is built from yesterday's archive day" "$OUT" "$RC"
restore

echo "=== (27) the reveal builder accepts any day, today's included ==="
plant shared/qotd/reveal.ts \
  "  if (day.qotd_date !== yesterday) {" \
  "  if (false) {" || { bad "M27 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M27 today's day revealed" "today's answer is never a reveal" "$OUT" "$RC"
restore

echo "=== (28) loadReveal fetches the posted day instead of yesterday ==="
plant scripts/qotd-social/generate.ts \
  '  const res = await fetchImpl(`${baseUrl}/api/public/qotd/${yesterday}`);' \
  '  const res = await fetchImpl(`${baseUrl}/api/public/qotd/${postedDate}`);' || { bad "M28 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M28 today's archive fetched" "loadReveal asks the public archive for yesterday only" "$OUT" "$RC"
restore

echo "=== (29) publishDecision stops checking the reveal's date ==="
plant scripts/qotd-social/generate.ts \
  "  if (reveal.qotd_date !== yesterday) {" \
  "  if (false) {" || { bad "M29 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M29 wrong-day reveal published" "a manifest whose reveal is not yesterday's is never written" "$OUT" "$RC"
restore

echo "=== (30) LEAK: the leak check stops reading the Reddit body ==="
plant shared/qotd/social.ts \
  '    fields.push(["reddit_body", output.reddit_body]);' \
  "    void 0;" || { bad "M30 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M30 explanation in Reddit body passes" "the explanation in the Reddit body" "$OUT" "$RC"
restore

echo "=== (31) LEAK: the Reddit title may name the correct choice ==="
plant shared/qotd/social.ts \
  '      leaks.push(`reddit_title: names the correct choice "${correct.text}"`);' \
  "      void 0;" || { bad "M31 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M31 correct choice in Reddit title passes" "the correct choice named in the Reddit title" "$OUT" "$RC"
restore

echo "=== (32) LEAK: the generator stops handing the Reddit body to the leak check ==="
plant scripts/qotd-social/generate.ts \
  "            reddit_body: reddit.body," \
  "" || { bad "M32 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M32 Reddit body unchecked" "the explanation in the Reddit body" "$OUT" "$RC"
restore

echo "=== (33) a withheld yesterday (404) is no longer recognised ==="
plant scripts/qotd-social/generate.ts \
  "  if (res.status === 404) {" \
  "  if (false) {" || { bad "M33 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M33 withheld not recognised" "a 404 from the archive (a repaired question) is withheld" "$OUT" "$RC"
restore

echo "=== (34) the Slack reveal ignores 'withheld' ==="
plant scripts/qotd-social/post-to-slack.ts \
  '  if (r.status === "withheld") {' \
  "  if (false) {" || { bad "M34 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M34 withheld day posts a reveal" "a 404 from the archive (a repaired question) is withheld" "$OUT" "$RC"
restore

# TikTok carousel + fixed answer order (Karl's brief 2026-10-23): one plant per rule.
echo "=== (35) the social image re-sorts today's options (token order, not canonical) ==="
plant shared/qotd/social.ts \
  "  const options = q.options.map((o) => ({ text: o.text }));" \
  "  const options = [...q.options].sort((a, b) => (a.id < b.id ? -1 : 1)).map((o) => ({ text: o.text }));" || { bad "M35 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M35 image order not canonical" "keeps today's options in canonical order" "$OUT" "$RC"
restore

echo "=== (36) the carousel builder accepts any day, today's included ==="
plant shared/qotd/tiktok.ts \
  "  if (day.qotd_date !== yesterday) {" \
  "  if (false) {" || { bad "M36 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M36 carousel of today" "the carousel is yesterday's: built from the day before the posted day" "$OUT" "$RC"
restore

echo "=== (37) publishDecision stops checking the carousel's date ==="
plant scripts/qotd-social/generate.ts \
  "  if (day !== yesterday || tiktok.carouselDay.qotd_date !== yesterday) {" \
  "  if (false) {" || { bad "M37 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M37 carousel date unchecked" "a carousel that is not yesterday's is refused" "$OUT" "$RC"
restore

echo "=== (38) LEAK: the carousel leak check stops reading slide 3 ==="
plant shared/qotd/social.ts \
  '    ...output.slides.map((text, i) => [`tiktok slide ${i + 1}`, text] as const),' \
  '    ...output.slides.slice(0, 2).map((text, i) => [`tiktok slide ${i + 1}`, text] as const),' || { bad "M38 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M38 slide 3 unchecked" "today's explanation on slide 2+1 is a leak" "$OUT" "$RC"
restore

echo "=== (39) LEAK: the carousel leak check stops reading the TikTok caption ==="
plant shared/qotd/social.ts \
  '    ["tiktok caption", output.caption],' \
  "" || { bad "M39 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M39 caption unchecked" "today's explanation in the caption or the title is a leak" "$OUT" "$RC"
restore

echo "=== (40) LEAK: the generator stops handing the slides to the leak check ==="
plant scripts/qotd-social/generate.ts \
  "      { slides: tiktok.slides.map((s) => s.cardText), caption, title }," \
  "      { slides: [], caption, title }," || { bad "M40 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M40 slides not checked" "the generator hands every slide to the leak check" "$OUT" "$RC"
restore

# Re-pointed 2026-10-26: the "no carousel" lines moved from slackTiktokMessage into
# slackPostPlan (fixed order and labels), so the plant targets the branch that now decides.
echo "=== (41) a skipped carousel posts no note ==="
plant scripts/qotd-social/post-to-slack.ts \
  '  if (m.tiktok.status === "built") {' \
  "  if (true) {" || { bad "M41 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M41 no note" "no carousel: no slide is uploaded, and the one-line note is posted" "$OUT" "$RC"
restore

# Re-pointed 2026-10-26: the slides are now a step of slackPostPlan.
echo "=== (42) a built carousel's slides are never uploaded ==="
plant scripts/qotd-social/post-to-slack.ts \
  "        files: post.tiktokSlides.map((slide, i) => ({" \
  "        files: post.tiktokSlides.slice(0, 0).map((slide, i) => ({" || { bad "M42 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M42 slides not posted" "three slides shared together with their comment" "$OUT" "$RC"
restore

echo "=== (43) the Why line ignores the 300-character cap ==="
plant shared/qotd/tiktok.ts \
  "    if (next.length > QOTD_TIKTOK_WHY_MAX) break;" \
  "    if (false) break;" || { bad "M43 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M43 Why over 300" "the Why line is at most 300 characters" "$OUT" "$RC"
restore

echo "=== (44) the Why line is cut mid-sentence ==="
plant shared/qotd/tiktok.ts \
  '  return ended.split(/(?<=[.!?]["”’)]*) /);' \
  '  return ended.match(/.{1,120}(?: |$)/g) ?? [];' || { bad "M44 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M44 Why not at a sentence boundary" "the Why line is at most 300 characters, whole sentences only" "$OUT" "$RC"
restore

echo "=== (45) the caption loses its follow line ==="
plant shared/qotd/tiktok.ts \
  '  "Follow for daily SAT questions 👆",' \
  "" || { bad "M45 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M45 no follow line first" "the caption starts with the follow line" "$OUT" "$RC"
restore

echo "=== (46) the title cap is removed ==="
plant shared/qotd/tiktok.ts \
  "  if (text.length <= QOTD_TIKTOK_TITLE_MAX) return text;" \
  "  return text;" || { bad "M46 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M46 title uncapped" "the cap cuts anything longer at a whole word" "$OUT" "$RC"
restore

# Re-pointed 2026-10-28 (SCL-258): the guard compares the shown letter with the SERVED letter.
echo "=== (47) slide 3 may name a letter slide 1 does not show for that choice ==="
plant shared/qotd/tiktok.ts \
  "      (q.correct_letter !== undefined && shown !== q.correct_letter)" \
  "      false" || { bad "M47 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M47 letter mismatch" "refuses a day whose correct letter is not the letter slide 1 shows" "$OUT" "$RC"
restore

echo "=== (48) the slide column reaches under TikTok's right-hand controls ==="
plant client/src/components/qotd/QotdTiktokSlide.tsx \
  'right:${SAFE.right}px;display:flex' \
  'right:0px;display:flex' || { bad "M48 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M48 outside the safe area" "the content column sits inside the clear band" "$OUT" "$RC"
restore

echo "=== (49) a grid-in gets the A-D pause slide ==="
plant client/src/components/qotd/QotdTiktokSlide.tsx \
  "        {mcq ? (" \
  "        {true ? (" || { bad "M49 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M49 grid-in variant lost" "grid-in: slide 2 shows one 'Your answer' box" "$OUT" "$RC"
restore

# #social order and labels (Karl's brief 2026-10-26): one plant per rule.
echo "=== (53) the five items go out in the wrong order ==="
plant scripts/qotd-social/post-to-slack.ts \
  "  return steps;" \
  "  return [...steps.slice(3), ...steps.slice(0, 3)];" || { bad "M53 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M53 order" "a day with a carousel posts 1/5 to 5/5 in order" "$OUT" "$RC"
restore

echo "=== (54) an item loses its numbered label ==="
plant scripts/qotd-social/post-to-slack.ts \
  "  \"4/5 · Reddit: today's post\"," \
  "  \"Reddit: today's post\"," || { bad "M54 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M54 label" "a day with a carousel posts 1/5 to 5/5 in order" "$OUT" "$RC"
restore

echo "=== (55) an upload is not confirmed shared before the next step ==="
plant shared/slack/client.ts \
  "      if (inChannel) break;" \
  "      break;" || { bad "M55 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M55 upload not awaited" "each upload is confirmed shared before the next step starts" "$OUT" "$RC"
restore

echo "=== (56) a skipped carousel drops item 3, shifting the numbering ==="
plant scripts/qotd-social/post-to-slack.ts \
  $'      },\n      {\n        item: 3,\n        label: l3,\n        kind: "message",\n        text: `*3/5 \xc2\xb7 TikTok: no carousel today* (${why})`,\n      },\n' \
  $'      },\n' || { bad "M56 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M56 skipped item 3 dropped" "a skipped carousel still yields a 2/5 and a 3/5 message" "$OUT" "$RC"
restore

echo "=== (57) the dry run stops printing the sequence ==="
plant scripts/qotd-social/post-to-slack.ts \
  "    for (const step of slackPostPlan(post.value)) {" \
  "    for (const step of [] as ReturnType<typeof slackPostPlan>) {" || { bad "M57 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M57 dry run silent" "the dry run prints the sequence" "$OUT" "$RC"
restore

# Karl's ruling 2026-10-26 on #1308: a long first sentence is cut, never a skipped carousel.
echo "=== (58) a long first sentence skips the Why again (no cut fallback) ==="
plant shared/qotd/tiktok.ts \
  "  if (first.length > QOTD_TIKTOK_WHY_MAX) return cutFirstSentence(first);" \
  "" || { bad "M58 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M58 no cut fallback" "a first sentence over 300 characters is cut at the last word boundary" "$OUT" "$RC"
restore

echo "=== (59) the cut falls mid-word ==="
plant shared/qotd/tiktok.ts \
  '  const space = head.lastIndexOf(" ");' \
  "  const space = -1;" || { bad "M59 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M59 cut mid-word" "a first sentence over 300 characters is cut at the last word boundary" "$OUT" "$RC"
restore

echo "=== (60) the cut Why loses its '…' and pointer to the full explanation ==="
plant shared/qotd/tiktok.ts \
  '  return `${cut}${QOTD_TIKTOK_WHY_MORE}`;' \
  "  return cut;" || { bad "M60 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M60 no pointer" "a first sentence over 300 characters is cut at the last word boundary" "$OUT" "$RC"
restore

# ── SCL-258 (Karl, 2026-10-28): the options are shuffled once, in the database, and every
#    surface serves the stored order and letter. One plant per rule.
echo "=== (61) a renderer reads canonical order: the shared function serves authored order ==="
plant shared/qotd/projection.ts \
  "  for (const key of order) {" \
  "  for (const key of byKey.keys()) {" || { bad "M61 STALE"; exit 1; }
OUT="$(ts_check "$AGREE")"; RC=$?
expect_red "M61 shared function canonical" "the archive response: the same order, and correct_letter is the served letter" "$OUT" "$RC"
restore

echo "=== (62) a renderer reads canonical order: today's route bypasses the stored order ==="
plant server/services/qotd/qotd-service.ts \
  "  return qotdServedChoices(row).options.map((o) => ({" \
  "  return parseCanonicalMcOptions(row.options).map((o) => ({ id: o.key, text: o.text })).map((o) => ({" || { bad "M62 STALE"; exit 1; }
OUT="$(ts_check "$ROUTES")"; RC=$?
expect_red "M62 today canonical" "every request serves the four options in the day's stored order" "$OUT" "$RC"
restore

if [ "$HAVE_PG" = 1 ]; then
  echo "=== (63) a stored order can be UPDATEd (the write-once trigger raises nothing) ==="
  [ "$(grep -ln 'FUNCTION public\.qotd_schedule_no_update\b' supabase/migrations/*.sql | sort | tail -1)" = "$MIG_SHUF" ] || { bad "M63 targets $MIG_SHUF but qotd_schedule_no_update is defined later"; exit 1; }
  plant "$MIG_SHUF" "  RAISE EXCEPTION 'qotd_schedule is write-once: % cannot be changed (SCL-258)', OLD.qotd_date
    USING ERRCODE = '42501';" "  RETURN NEW;" || { bad "M63 STALE"; exit 1; }
  OUT="$(sql_check)"; RC=$?
  expect_red "M63 UPDATE allowed" "Q-10 an UPDATE of a stored order was accepted" "$OUT" "$RC"
  restore

  echo "=== (64) the backfill reshuffles a past date (and today) ==="
  plant "$MIG_SHUF" "                            WHEN s.qotd_date <= public.qotd_today() THEN public.qotd_option_keys(q.options)" \
                    "                            WHEN false THEN public.qotd_option_keys(q.options)" || { bad "M64 STALE"; exit 1; }
  OUT="$(backfill_check)"; RC=$?
  expect_red "M64 past reshuffled" "B-01 past or today" "$OUT" "$RC"
  restore

  echo "=== (65) qotd_schedule_insert stores the authored order, not the shuffle ==="
  [ "$(last_definer qotd_schedule_insert)" = "$MIG_SHUF" ] || { bad "M65 targets $MIG_SHUF but qotd_schedule_insert is last defined in $(last_definer qotd_schedule_insert)"; exit 1; }
  plant "$MIG_SHUF" "                THEN public.qotd_shuffled_option_order(q.options, p_date, q.id)" \
                    "                THEN public.qotd_option_keys(q.options)" || { bad "M65 STALE"; exit 1; }
  OUT="$(sql_check)"; RC=$?
  expect_red "M65 insert unshuffled" "the option order and letter are the database's, not the caller's" "$OUT" "$RC"
  restore

  echo "=== (66) a caller-supplied order is accepted on a direct INSERT (letter derived from it) ==="
  plant "$MIG_SHUF" "    v_order  := public.qotd_shuffled_option_order(v_q.options, NEW.qotd_date, NEW.question_id);" \
                    "    v_order  := COALESCE(NEW.option_order, public.qotd_shuffled_option_order(v_q.options, NEW.qotd_date, NEW.question_id));" || { bad "M66 STALE"; exit 1; }
  OUT="$(sql_check)"; RC=$?
  expect_red "M66 caller order accepted" "Q-10 a caller-supplied order was accepted" "$OUT" "$RC"
  restore
fi

echo "=== (67) the reveal names the canonical letter, not the served one ==="
plant shared/qotd/reveal.ts \
  "      letter: shown," \
  "      letter: correct.id," || { bad "M67 STALE"; exit 1; }
OUT="$(ts_check "$AGREE")"; RC=$?
expect_red "M67 reveal canonical letter" "yesterday's reveal names the served letter" "$OUT" "$RC"
restore

echo "=== (68) the Slack heading names the plural subreddit again ==="
plant scripts/qotd-social/post-to-slack.ts \
  '    `*Reddit (r/satquestion)* · today'"'"'s post' \
  '    `*Reddit (r/satquestions)* · today'"'"'s post' || { bad "M68 STALE"; exit 1; }
OUT="$(ts_check "$AGREE")"; RC=$?
expect_red "M68 plural subreddit" "the Reddit heading names r/satquestion (singular)" "$OUT" "$RC"
restore

echo "=== (69) the scheduler stops skipping an explanation that names a letter ==="
plant server/services/qotd/schedule-job.ts \
  "    explanationNamesChoiceLetter(c.explanation)
  ) {" \
  "    false
  ) {" || { bad "M69 STALE"; exit 1; }
OUT="$(ts_check "$SCHED")"; RC=$?
expect_red "M69 letter skip off" "skips an MCQ whose explanation names a choice letter" "$OUT" "$RC"
restore

# The QOTD day at 04:00 UTC (Karl, 2026-10-27): the 04:05 UTC run uses the right days.
echo "=== (70) the social run takes the Chicago day as today ==="
plant scripts/qotd-social/generate.ts \
  "  return qotdTodaySwitched(now);" \
  "  return new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);" || { bad "M70 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M70 run day is the 04:00 UTC day" "the 04:05 UTC run builds the new day and reveals the day that just ended" "$OUT" "$RC"
restore

echo "=== (71) the run is scheduled before the day turns over ==="
plant .github/workflows/qotd-social.yml \
  '    - cron: "5 4 * * *"' \
  '    - cron: "55 3 * * *"' || { bad "M71 STALE"; exit 1; }
OUT="$(ts_check "$SOCIAL")"; RC=$?
expect_red "M71 04:05 UTC schedule" "the 04:05 UTC run builds the new day and reveals the day that just ended" "$OUT" "$RC"
restore

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$ROUTES" "$PAGES" "$WIDGET" "$SOCIAL" "$SCHED" "$READ" "$AGREE")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "QOTD MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
