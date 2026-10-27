#!/usr/bin/env bash
# ============================================================================
# Mutation harness for worked examples (owner brief "Worked examples: production system",
# Karl, 2026-10-27: "Plants: one per rule.")
# ============================================================================
# @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27), acceptance]
#   | @implemented [2026-10-27]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants and the files are
#            restored after each one (and on exit).
# SQL plants edit the migration that defines the object LAST (CLAUDE.md, "a migration that
# replaces a function body orphans its mutations"); the harness re-checks that for each one.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261115000000_worked_examples.sql"
DB=worked_example_mutations
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/we-mut.XXXX)"

FILES=(
  "$MIG"
  "shared/worked-examples/rules.ts"
  "scripts/worked-examples/approval.ts"
  "scripts/worked-examples/audio.ts"
  "scripts/worked-examples/content.ts"
  "scripts/worked-examples/generate.ts"
  "scripts/worked-examples/layout-check.ts"
  "scripts/worked-examples/post-to-slack.ts"
  "video-kit/worked-examples/templates/kit.css"
  "video-kit/worked-examples/music/tracks.json"
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
  psql -v ON_ERROR_STOP=1 -d "$DB" -f scripts/ci/worked-examples-schema-gates.sql 2>&1
}

TEST=tests/ci/worked-examples.test.ts
ts_check() { pnpm exec vitest run "$TEST" 2>&1; }

# expect_red <name> <expected substring> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }

# sql_plant <name> <old> <new> <expected> [function the plant edits]
sql_plant() {
  if [ -n "${5:-}" ] && [ "$(last_definer "$5")" != "$MIG" ]; then
    bad "$1 targets $MIG but $5 is last defined in $(last_definer "$5")"; return
  fi
  plant "$MIG" "$2" "$3" || { bad "$1 STALE"; restore; return; }
  OUT="$(sql_check)"; RC=$?
  expect_red "$1" "$4" "$OUT" "$RC"
  restore
}

# ts_plant <name> <file> <old> <new> <expected>
ts_plant() {
  plant "$2" "$3" "$4" || { bad "$1 STALE"; restore; return; }
  OUT="$(ts_check)"; RC=$?
  expect_red "$1" "$5" "$OUT" "$RC"
  restore
}

echo "=== (0) GREEN BASELINE ==="
if [ "$HAVE_PG" = 1 ]; then
  OUT="$(sql_check)"; RC=$?
  case "$OUT" in *"WORKED EXAMPLES SCHEMA GATES: PASS"*) [ "$RC" = 0 ] && ok "SQL gates green" || bad "SQL gates printed PASS but exited $RC" ;; *) bad "SQL gates not green"; echo "$OUT" | tail -20 ;; esac
else
  echo "  SKIP  SQL plants — no Postgres at $PGHOST:$PGPORT (a skip, not a pass)"
fi
OUT="$(ts_check)"; RC=$?
[ "$RC" = 0 ] && ok "worked-example tests green" || { bad "worked-example tests not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "WORKED EXAMPLE MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

if [ "$HAVE_PG" = 1 ]; then
  echo "=== SQL: the leak rule, both ways ==="
  sql_plant "S1 a full-length question can be approved" \
    "    IF EXISTS (SELECT 1 FROM public.test_form_items t WHERE t.question_id = NEW.question_id) THEN" \
    "    IF FALSE THEN" \
    "W-04 approve a full-length question was accepted" worked_examples_leak_guard
  sql_plant "S2 today's QOTD question can be approved (> instead of >=)" \
    "                  AND s.qotd_date >= public.qotd_today()) THEN" \
    "                  AND s.qotd_date > public.qotd_today()) THEN" \
    "W-04 approve today's QOTD question was accepted" worked_examples_leak_guard
  sql_plant "S3 the QOTD scheduler stops skipping approved worked examples" \
    "w.question_id = q.id AND w.status = 'approved')" \
    "w.question_id = q.id AND FALSE)" \
    "W-05 an approved worked-example question is QOTD-eligible" qotd_question_is_eligible
  echo "=== SQL: table shape, one a day, RLS and grants, metric bounds ==="
  sql_plant "S4 two steps accepted" \
    "AND jsonb_array_length(steps) BETWEEN 3 AND 6" \
    "AND jsonb_array_length(steps) BETWEEN 2 AND 6" \
    "W-03 two steps was accepted"
  sql_plant "S5 two approved examples on one day" \
    "CREATE UNIQUE INDEX IF NOT EXISTS worked_examples_one_per_post_day" \
    "CREATE INDEX IF NOT EXISTS worked_examples_one_per_post_day" \
    "W-01 no unique index on post_on for approved rows"
  sql_plant "S6 metrics table without RLS" \
    "ALTER TABLE public.worked_example_metrics ENABLE ROW LEVEL SECURITY;" \
    "" \
    "W-02 RLS off on worked_example_metrics"
  sql_plant "S7 the usage view (answers included) granted to authenticated" \
    "GRANT SELECT ON public.questions_with_usage TO service_role;" \
    "GRANT SELECT ON public.questions_with_usage TO service_role, authenticated;" \
    "W-02 questions_with_usage has SELECT for anon/authenticated"
  sql_plant "S8 retention over 100% accepted" \
    "retention_3s_pct      numeric(5,2) NOT NULL CHECK (retention_3s_pct BETWEEN 0 AND 100)," \
    "retention_3s_pct      numeric(5,2) NOT NULL," \
    "W-08 retention over 100 was accepted"
fi

echo "=== TS: hook rules ==="
ts_plant "T1 H1 statistics let through" shared/worked-examples/rules.ts \
  "const hit = STATISTICS.find((re) => re.test(text));" "const hit = STATISTICS.find(() => false);" \
  "H1 refuses statistics"
ts_plant "T2 H2 claims about people let through" shared/worked-examples/rules.ts \
  "const hit = PEOPLE.find((re) => re.test(text));" "const hit = PEOPLE.find(() => false);" \
  "H2 refuses claims about students or people"
ts_plant "T3 H3 a hook that is not the puzzle let through" shared/worked-examples/rules.ts \
  "for (const t of tokens(hookLine)) if (question.has(t)) return null;" "return null;" \
  "H3 requires the hook to state the puzzle"
ts_plant "T4 H4 a hook that ends flat let through" shared/worked-examples/rules.ts \
  '/(\?|…|\.\.\.)["”’)]*$/.test(hookLine.trim())' "true" \
  "H4 requires the hook to end in curiosity"
ts_plant "T5 H5 the answer's own number let through" shared/worked-examples/rules.ts \
  "const leaked = own.find((t) => hookTokens.has(t));" "const leaked = undefined;" \
  "H5 refuses a hook that gives the answer away"

echo "=== TS: video ==="
ts_plant "T6 30-60 s bound broken (|| for &&)" scripts/worked-examples/generate.ts \
  "return duration >= kit.voice.min_seconds && duration <= kit.voice.max_seconds" \
  "return duration >= kit.voice.min_seconds || duration <= kit.voice.max_seconds" \
  "the fixture lasts 30-60 s"
ts_plant "T7 safe area: the right edge unchecked" scripts/worked-examples/layout-check.ts \
  "b.right > safe.right + 1 ||" "" \
  "the safe area is x 71..912"
ts_plant "T8 ruled lines on the paper" video-kit/worked-examples/templates/kit.css \
  ".url { display: block;" \
  "#root { background-image: repeating-linear-gradient(#FFFDF6 0 40px, #C8D8E8 40px 42px); }
.url { display: block;" \
  "the paper is one flat colour"
ts_plant "T9 the pixel check counts nothing" scripts/worked-examples/layout-check.ts \
  "      n++;" "      n += 0;" \
  "nonPaperPixels counts every pixel off the paper colour"
ts_plant "T10 the music gain ignored in the mix check" scripts/worked-examples/audio.ts \
  "const music = musicPeakDbfs + gainDb(musicGain);" "const music = musicPeakDbfs + gainDb(musicGain) - 40;" \
  "music too loud for the voice is refused"
ts_plant "T11 a track with no licence file" video-kit/worked-examples/music/tracks.json \
  '"licence_file": "video-kit/worked-examples/music/happy-beats-business-moves-vol-12.LICENSE.md",' \
  '"licence_file": "video-kit/worked-examples/music/MISSING.LICENSE.md",' \
  "every track used has its licence file"
ts_plant "T12 stale voice accepted" scripts/worked-examples/content.ts \
  "if (line.text_sha256 !== sha256(s.text))" "if (false)" \
  "re-scripting a line without re-voicing it is refused"

echo "=== TS: the daily job ==="
ts_plant "T13 approved by anyone who merges" scripts/worked-examples/approval.ts \
  "if (event.mergedBy !== approverLogin)" "if (false)" \
  "approved only when GitHub's record shows the approver merged"
ts_plant "T14 posts examples not due today" scripts/worked-examples/approval.ts \
  "e.content.post_on === today &&" "" \
  "selects only examples due today, not retired, not already posted"
ts_plant "T15 posts again what the ledger says was posted" scripts/worked-examples/approval.ts \
  "posted[workedExampleId(e.content.question_id)] === undefined," "true," \
  "selects only examples due today, not retired, not already posted"
ts_plant "T16 a second claim accepted" scripts/worked-examples/approval.ts \
  "if (posted[id] !== undefined)" "if (false)" \
  "posts once: a second claim for the same example is refused"

echo "=== TS: title, caption, plan, Slack ==="
ts_plant "T17 a title not starting SAT" shared/worked-examples/rules.ts \
  'if (!title.startsWith("SAT")) out.push(' 'if (false) out.push(' \
  "a title over 90 characters or not starting with SAT is refused"
ts_plant "T18 a caption without the follow line first" shared/worked-examples/rules.ts \
  "if (first !== WORKED_EXAMPLE_CAPTION_FIRST_LINE)" "if (false)" \
  "a caption without the follow line first"
ts_plant "T19 the plan repeats a hook type" shared/worked-examples/rules.ts \
  "if (prev && prev.hook_type === s.hook_type)" "if (false)" \
  "two consecutive slots with one hook type are refused"
ts_plant "T20 the Slack set out of order" scripts/worked-examples/post-to-slack.ts \
  "for (const step of workedExampleSlackSteps(post)) {" "for (const step of workedExampleSlackSteps(post).reverse()) {" \
  "posts the video first"

echo
echo "worked-example mutations: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then echo "WORKED EXAMPLE MUTATIONS: FAIL"; exit 1; fi
echo "WORKED EXAMPLE MUTATIONS: PASS"
