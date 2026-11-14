#!/usr/bin/env bash
# ============================================================================
# Mutation harness for worked examples (owner brief "Worked examples: production system",
# Karl, 2026-10-27: "Plants: one per rule."; S9 per Karl's decision 1 on #1336, 2026-10-27;
# V1-V10 per the OpenVoice addendum, Karl, 2026-10-27; V11-V12 per Karl's speaking-rate ask,
# 2026-10-27; T2, T18 re-pointed and T21-T26 added per Karl's rulings of 2026-11-02, SCL-265:
# "Most people…" hooks allowed, and the #social set in the SCL-262 format; T8 and V9 re-pointed and
# W1-W19 added per Karl's rulings of 2026-11-02 (later the same day), SCL-267: no captions, the voice
# never reads the screen, spoken order hook → setup → steps → trap → answer → CTA, the end card
# "Lyceon SAT Prep", am_michael, the "lye-see-on" respelling, loudness normalisation; W24 per the
# owner brief "Video tools pilot" D3, Karl, 2026-11-02: Chatterbox's own respelling, same table;
# T23/T24/T26 re-pointed and T27-T31 added per Karl's #social copy-paste cleanup, 2026-11-04;
# T32-T34 per Karl's ruling of 2026-11-05: worked examples use Hard questions only;
# T35-T39 per Karl's rulings of 2026-11-11 (weekly video pipeline v2, SCL-277); T40-T45 the same
# rulings' item 7, the drawn figure; T46 Karl's voice change of 2026-11-11 (takes per line);
# T47-T49 the same day's rulings: no "Go" in the spoken hook (H7), Lyceon respelled for Chirp;
# T50 the same day's ruling: the captions show the STYLE display_name, not the skill name;
# T51-T54 Karl's pipeline fixes 2026-11-14: no mid-word title, the voice and title source in the
# Week ready message, recaption touches only a delivered week, the daily job retired;
# F1-F8 added per Karl's ruling of 2026-11-02, SCL-270: a true-peak limiter (at most -1 dBTP) on
# the finished mix in every pipeline; F9-F11 the same ruling on the D pilots' render.py and check.ts)
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
MIG="supabase/migrations/20261118000000_worked_examples.sql"
DB=worked_example_mutations
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/we-mut.XXXX)"

FILES=(
  "$MIG"
  "shared/worked-examples/rules.ts"
  "scripts/worked-examples/approval.ts"
  "scripts/worked-examples/composition.ts"
  "video-kit/worked-examples/templates/end-card.html"
  "scripts/worked-examples/audio.ts"
  "scripts/worked-examples/content.ts"
  "scripts/worked-examples/generate.ts"
  "scripts/worked-examples/layout-check.ts"
  "scripts/worked-examples/post-to-slack.ts"
  "video-kit/worked-examples/templates/kit.css"
  "video-kit/worked-examples/music/tracks.json"
  "scripts/worked-examples/quality.ts"
  "scripts/worked-examples/voice.ts"
  "scripts/worked-examples/final-mix.ts"
  "scripts/worked-examples/daily.ts"
  "scripts/worked-examples/kit.ts"
  "video-kit/worked-examples/voice.json"
  ".gitignore"
  ".github/workflows/worked-example-daily.yml"
  "scripts/video-pilots/manim/check.ts"
  "scripts/video-pilots/manim/render.py"
  "scripts/worked-examples/voice-cache.ts"
  "scripts/worked-examples/weekly.ts"
  "scripts/worked-examples/figure.ts"
  "shared/worked-examples/figure-rules.ts"
  "scripts/worked-examples/google-tts.ts"
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
VOICE_TEST=tests/ci/worked-examples-voice.test.ts
# Only the plants aimed at the ffmpeg round trip run it (~30 s of a ~35 s run); every other plant
# runs both files without it, and the baseline proves the filter skips exactly that one test
# (scripts/ci/lib/vitest-round-trips.sh; CI wall-time ruling, Karl 2026-11-04).
source "$ROOT/scripts/ci/lib/vitest-round-trips.sh"
WEEKLY_TEST=tests/ci/weekly-pipeline.test.ts
GUARD_TEST=tests/ci/social-weekly-secret-guard.test.ts
FIGURE_TEST=tests/ci/worked-example-figure.test.ts
BAKEOFF_TEST=tests/ci/voice-bakeoff.test.ts
RT_FILES=("$TEST" "$VOICE_TEST" "$WEEKLY_TEST" "$GUARD_TEST" "$FIGURE_TEST" "$BAKEOFF_TEST")
RT_TITLES=("verify refuses an unlimited intersample-peak mix; after final-mix.ts it is at most -1 dBTP and passes")

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
  OUT="$(rt_check_for "$5")"; RC=$?
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
# The F plants' round trip runs real ffmpeg; without it that test skips and its plants could not
# bite, so a missing ffmpeg fails the baseline (a skip is not a pass).
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then ok "ffmpeg present"; else bad "ffmpeg/ffprobe not installed (the F plants need them)"; fi
OUT="$(rt_check_full)"; RC=$?
[ "$RC" = 0 ] && ok "worked-example tests green" || { bad "worked-example tests not green"; echo "$OUT" | tail -30; }
rt_baseline ok bad
OUT="$(pnpm exec vitest run tests/ci/video-pilots.test.ts 2>&1)"; RC=$?
[ "$RC" = 0 ] && ok "video-pilot tests green" || { bad "video-pilot tests not green"; echo "$OUT" | tail -30; }
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
  sql_plant "S9 an approved worked-example question can become a full-length form item" \
    "w.question_id = NEW.question_id AND w.status = 'approved') THEN" \
    "w.question_id = NEW.question_id AND FALSE) THEN" \
    "W-09 an approved worked-example question inserted into a full-length form was accepted" test_form_items_worked_example_guard
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
# T2 re-pointed 2026-11-02 (SCL-265): H2 now tests the hook with a "Most people" opening taken off.
ts_plant "T2 H2 claims about people let through" shared/worked-examples/rules.ts \
  "const hit = PEOPLE.find((re) => re.test(rest));" "const hit = PEOPLE.find(() => false);" \
  "H2 refuses claims about students or people"
ts_plant "T21 H2 the Most people allowance reverted (the 2026-11-02 ruling undone)" shared/worked-examples/rules.ts \
  'const rest = text.replace(MOST_PEOPLE_OPENING, "");' "const rest = text;" \
  "H2 allows a hook that opens with Most people"
ts_plant "T22 H2 allowance over-wide: any opening \"most <word>\" exempt" shared/worked-examples/rules.ts \
  "const MOST_PEOPLE_OPENING = /^\s*most people\b/i;" "const MOST_PEOPLE_OPENING = /^\s*most \w+\b/i;" \
  "H2 still refuses every other claim about people, including after a Most people opening"
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
# T8 re-pointed 2026-11-02 (SCL-267): the end card's ".url" rule is now ".brand-name".
ts_plant "T8 ruled lines on the paper" video-kit/worked-examples/templates/kit.css \
  ".brand-name { display: block;" \
  "#root { background-image: repeating-linear-gradient(#FFFDF6 0 40px, #C8D8E8 40px 42px); }
.brand-name { display: block;" \
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
# T18 re-pointed 2026-11-02 (SCL-265): the captions open with the headline (the title), not the
# follow line.
ts_plant "T18 a caption without the headline first" shared/worked-examples/rules.ts \
  "if (first !== headline)" "if (false)" \
  "a caption without the headline first"
ts_plant "T19 the plan repeats a hook type" shared/worked-examples/rules.ts \
  "if (prev && prev.hook_type === s.hook_type)" "if (false)" \
  "two consecutive slots with one hook type are refused"
# T20, T26 re-pointed 2026-11-02 (SCL-266): the steps and the poster moved into videoSetSlackSteps
# and postVideoSet, which the worked examples and the QOTD breakdown share.
ts_plant "T20 the Slack set out of order" scripts/worked-examples/post-to-slack.ts \
  "  for (const step of steps) {" "  for (const step of [...steps].reverse()) {" \
  "posts the video first"

echo "=== TS: the SCL-262 set (SCL-265) ==="
# T23, T24, T26 re-pointed and T27-T31 added 2026-11-04 (Karl, the #social copy-paste cleanup):
# the music credit moved from every caption onto the end card, small at the right, at most a
# quarter of the outro font, never spoken; outside the copy blocks only the platform headers.
ts_plant "T23 the music credit planted back into the TikTok caption" shared/worked-examples/rules.ts \
  "  return socialTiktokCaption(c.headline, c.test, c.section);" \
  '  return `${socialTiktokCaption(c.headline, c.test, c.section)}\n\nMusic: "Happy Beats / Business Moves Vol. 12" by ende.app, CC BY 4.0.`;' \
  "the real title and caption pass, with no music credit in any caption"
ts_plant "T24 a link in the TikTok caption" shared/worked-examples/rules.ts \
  "  return socialTiktokCaption(c.headline, c.test, c.section);" \
  '  return `${socialTiktokCaption(c.headline, c.test, c.section)}\n\nlyceon.ai/start`;' \
  "no link, bio line or promo in any caption"
ts_plant "T25 the caption link check removed" shared/worked-examples/rules.ts \
  "if (link) out.push(" "if (false) out.push(" \
  "no link, bio line or promo in any caption"
ts_plant "T26 the link to send back in the Instagram message" scripts/worked-examples/post-to-slack.ts \
  'text: [platformLine("Instagram"), copyBlock(set.instagram_caption)].join(' \
  'text: [platformLine("Instagram"), copyBlock(set.instagram_caption), "lyceon.ai/start?utm_campaign=worked_example"].join(' \
  "outside the blocks only the platform headers"
ts_plant "T27 the copy-block check removed (a credit, URL or label passes)" shared/worked-examples/rules.ts \
  "  out.push(...copyBlockProblems(caption));" "" \
  "no copy block carries a music credit"
ts_plant "T28 a label back on the video comment" scripts/worked-examples/post-to-slack.ts \
  '      comment: platformLine("TikTok"),' \
  '      comment: `${platformLine("TikTok")}\nWorked example · SATM2CZS1BE`,' \
  "posts the video first"
ts_plant "T29 the credit dropped from the end card" scripts/worked-examples/composition.ts \
  "{ credit: endCardCreditHtml(kit) }" '{ credit: "" }' \
  "the end card shows the track's credit"
ts_plant "T30 the credit at half the outro font, not a quarter" scripts/worked-examples/composition.ts \
  "  Math.min(OUTRO_FOLLOW_PX, OUTRO_BRAND_PX) / 4," "  Math.min(OUTRO_FOLLOW_PX, OUTRO_BRAND_PX) / 2," \
  "small at the right"
ts_plant "T31 the layout check lets an oversized credit through" scripts/worked-examples/layout-check.ts \
  "  if (c.fontPx > limit)" "  if (false)" \
  "the layout check refuses"

echo "=== TS: Hard questions only (Karl, 2026-11-05) ==="
ts_plant "T32 the Hard-only rule dropped from the posting path" scripts/worked-examples/content.ts \
  "    if (hard) problems.push(hard);" "" \
  "a worked example due from Nov 6 on must be difficulty 3"
ts_plant "T33 a medium question let through as Hard" shared/worked-examples/rules.ts \
  "  return q.difficulty === HARD_DIFFICULTY" "  return q.difficulty >= 2" \
  "a worked example due from Nov 6 on must be difficulty 3"
ts_plant "T34 the rule turned on the posted history (no cutoff date)" scripts/worked-examples/content.ts \
  "  if (e.content.post_on >= HARD_ONLY_FROM) {" "  if (e.content.post_on >= \"2000-01-01\") {" \
  "an example posted before the ruling is history"

echo "=== TS: the weekly batch (Karl, 2026-11-11, SCL-277) ==="
ts_plant "T35 a cache hit ignored (every re-render calls TTS again)" scripts/worked-examples/voice-cache.ts \
  "    if (usable(entry, key, line.text)) cacheHits++;" "    if (false) cacheHits++;" \
  "a re-render makes no TTS call"
ts_plant "T36 the cache key drops the voice (a voice change reuses the old audio)" scripts/worked-examples/voice-cache.ts \
  "      voice: profile.chirp_voice," "" \
  "each one changes it"
# T37 re-pointed 2026-11-11 (voice A): a line now gets VOICE_TAKES takes; the plant accepts a
# failing take as if it passed, so a failing line would be cached.
ts_plant "T37 a line that fails the checks is cached anyway" scripts/worked-examples/voice-cache.ts \
  "        if (tried.problems.length === 0) done = tried;" "        if (true) done = tried;" \
  "nothing is cached"
ts_plant "T46 one take per line (a single bad take refuses the example)" scripts/worked-examples/voice-cache.ts \
  "export const VOICE_TAKES = 3;" "export const VOICE_TAKES = 1;" \
  "a bad take is voiced again"
ts_plant "T38 the service-role key reachable from a pull request" .github/workflows/worked-example-daily.yml \
  "      - name: Upload to social-weekly (signed links, 14 days)"$'\n'"        if: github.event_name == 'schedule' && github.ref == 'refs/heads/main'" \
  "      - name: Upload to social-weekly (signed links, 14 days)"$'\n'"        if: github.event_name == 'pull_request' || github.ref == 'refs/heads/main'" \
  "only on the scheduled run from main"
ts_plant "T39 a label inside the captions file" scripts/worked-examples/weekly.ts \
  "  for (const w of post.warnings) parts.push(w);" '  for (const w of post.warnings) parts.push(w);'$'\n''  parts.push(`Worked example · ${post.id}`);' \
  "platform headers outside"

echo "=== TS: the drawn figure (Karl, 2026-11-11, item 7) ==="
ts_plant "T40 an opening label may show a number the question does not give" shared/worked-examples/figure-rules.ts \
  "      if (!given.has(n))" "      if (given.has(n) && !given.has(n))" \
  "the opening shows only numbers the question gives"
ts_plant "T41 the content check never reads the figure" shared/worked-examples/rules.ts \
  "  if (example.figure)"$'\n'"    out.push(...figureProblems(example.figure, example.steps.length, q));" "" \
  "the content check reports a figure's problems"
ts_plant "T42 an undrawn stroke paints a dot (offset exactly its length)" scripts/worked-examples/figure.ts \
  "  return round2(length + 1);" "  return round2(length);" \
  "every stroke hidden until its tween"
ts_plant "T43 the figure starts drawing before the hook is up" scripts/worked-examples/figure.ts \
  "export const OPEN_DRAW_START = 0.6;" "export const OPEN_DRAW_START = 0;" \
  "after the hook is up"
ts_plant "T44 the notepad runs down into the figure" scripts/worked-examples/composition.ts \
  "  const notepadBottom = figure ? FIGURE_TOP - FIGURE_GAP : NOTEPAD_BOTTOM;" "  const notepadBottom = NOTEPAD_BOTTOM;" \
  "the notepad stops above it"
ts_plant "T45 the layout check never sees an overlap" scripts/worked-examples/layout-check.ts \
  "  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;" "  return false;" \
  "refuses a figure crossing the scenes' text"

echo "=== TS: voice A and the speed hook (Karl, 2026-11-11) ==="
ts_plant "T47 the content check never reads the Go rule" scripts/worked-examples/content.ts \
  "  if (go) problems.push(go);" "" \
  "H7 runs in the content check"
ts_plant "T48 the Go rule only catches \"go!\"" shared/worked-examples/rules.ts \
  'return sentences.includes("go")' 'return sentences.includes("go!")' \
  "H7 refuses a spoken hook with a standalone Go"
ts_plant "T49 production Chirp sends the IPA again (Orus ignores it)" scripts/worked-examples/google-tts.ts \
  '  brand: "respell" | "ipa" = "respell",' '  brand: "respell" | "ipa" = "ipa",' \
  "Lyceon respelled Lye-see-ahn, no IPA"
ts_plant "T51 a missing display name cut mid-word (the skill name sliced to the topic length)" shared/worked-examples/rules.ts \
  '  if (name.length <= WORKED_EXAMPLE_TOPIC_MAX) return name;' \
  '  return name.slice(0, WORKED_EXAMPLE_TOPIC_MAX);' \
  "a title is never cut mid-word: a missing display name falls back to the skill name shortened at a word boundary (Karl, 2026-11-14)"
ts_plant "T52 the Week ready message drops the voice line" scripts/worked-examples/weekly.ts \
  '    `Voice: ${escapeMrkdwn(plan.voice)}`,' '' \
  "the Week ready message shows the voice and where the titles came from, at the top (Karl, 2026-11-14)"
ts_plant "T53 recaption rewrites undelivered examples" scripts/worked-examples/weekly.ts \
  '        posted[workedExampleId(e.content.question_id)] !== undefined,' \
  '        posted[workedExampleId(e.content.question_id)] === undefined,' \
  "only the week's delivered examples are recaptioned; an undelivered one is left alone"
ts_plant "T54 the daily cron back in the workflow" .github/workflows/worked-example-daily.yml \
  '    - cron: "15 16 * * 4"' '    - cron: "0 17 * * *"
    - cron: "15 16 * * 4"' \
  "the daily job is retired: the workflow runs only the weekly batch, on its Thursday cron (Karl, 2026-11-14)"
# T50 re-pointed 2026-11-14: workedExampleCopy now takes the topic from titleTopic.
ts_plant "T50 the captions show the College Board skill name again" scripts/worked-examples/daily.ts \
  '  const { topic } = chosen;' '  const topic = e.content.skill_code;' \
  "the title and all three captions show the STYLE display_name, never the skill name"

echo "=== TS: the cloned voice (OpenVoice addendum, Karl, 2026-10-27) ==="
ts_plant "V1 a line that says something else is kept" scripts/worked-examples/quality.ts \
  "const cer = errorRate(said, heard);" "const cer = 0 * errorRate(said, heard);" \
  "a line that says something other than its script is refused"
ts_plant "V2 a clipped line is kept" scripts/worked-examples/quality.ts \
  "if (peakDbfs > limits.max_peak_dbfs)" "if (false)" \
  "a clipped line is refused"
ts_plant "V3 a silent line is kept" scripts/worked-examples/quality.ts \
  "if (!(peakDbfs > limits.silence_threshold_dbfs))" "if (false)" \
  "a silent line is refused"
ts_plant "V4 a failing clone line is kept instead of falling back" scripts/worked-examples/voice.ts \
  "return outcome.problems.length === 0" "return outcome.problems.length >= 0" \
  "keeps a clone line only when it was produced and passed every check"
ts_plant "V5 a fallback line in another voice is accepted" scripts/worked-examples/content.ts \
  "if (line.voice !== kit.voice.fallback_profile)" "if (false)" \
  "a fallback line in another voice, or a fallback in a batch already in the fallback voice, is refused"
ts_plant "V6 committed lines are no longer quality-checked" scripts/worked-examples/content.ts \
  '      out.push(`voice/${line.file}: ${p}`);' "      void p;" \
  "a committed line that fails the checks fails the content check"
ts_plant "V7 a reference inside the repository is accepted" scripts/worked-examples/voice.ts \
  'if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))' "if (false)" \
  "is read only from an absolute path outside every checkout"
ts_plant "V8 reference recordings no longer ignored by git" .gitignore \
  "*.reference.wav" "# reference.wav" \
  "git ignores reference recordings and none is tracked"
# V9 re-pointed 2026-11-02 (SCL-267): the default is am_michael, no longer af_heart.
ts_plant "V9 the clone made the default before Karl picks it" video-kit/worked-examples/voice.json \
  '"default_profile": "am_michael",' '"default_profile": "clone",' \
  "default and fallback are am_michael"
# V10 re-pointed 2026-11-11 (SCL-277), and again 2026-11-14 when the daily job was retired: the
# weekly job's "Install dependencies" step is now the only one, followed by its Chromium step.
ts_plant "V10 CI installs the clone's Python stack" .github/workflows/worked-example-daily.yml \
  "      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Chromium" "      - name: Clone stack
        run: pip install -r scripts/worked-examples/openvoice/requirements.txt

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Chromium" \
  "the worked-example workflows set up no Python at all"
ts_plant "V11 the speaking rate never reaches the /brag voice" scripts/worked-examples/voice.ts \
  '    "-s",' '    "--silent",' \
  "reaches the kokoro voice as hyperframes tts -s"
ts_plant "V12 a rate change keeps the old voicing" scripts/worked-examples/voice.ts \
  "    (previous.speaking_rate ?? 1) === speakingRate" "    true" \
  "a rate change re-voices the batch"

echo "=== TS: script and voice (SCL-267, Karl's rulings 2026-11-02) ==="
# 2026-11-02 (SCL-266, Karl's rulings on #1398): W3, W5, W22 and W23 keep their anchors, which now
# sit in scriptProblems (shared/worked-examples/rules.ts), the script rules contentProblems calls and
# the QOTD breakdown shares; observed red there at rules.ts:350 (W3), :352 (W5), :361 (W22, W23).
ts_plant "W1 S1 the verbatim rule finds nothing" shared/worked-examples/rules.ts \
  "      if (run !== null)" "      if (false)" \
  "a setup that reads the question stem is refused"
ts_plant "W2 S1 a run of six shared words let through (seven needed)" shared/worked-examples/rules.ts \
  "export const VERBATIM_RUN_WORDS = 6;" "export const VERBATIM_RUN_WORDS = 7;" \
  "S1 finds a run of six shared words, and not five"
ts_plant "W3 S1 not run by the content check" shared/worked-examples/rules.ts \
  "  out.push(...verbatimProblems(example, q));" "" \
  "a setup that reads the question stem is refused"
ts_plant "W4 S1 the trap notepad left out of the on-screen text" shared/worked-examples/rules.ts \
  '    ...example.trap.notepad.map((text, k) => ({' '    ...[].map((text: string, k: number) => ({' \
  "S1 checks every spoken line against every on-screen text"
ts_plant "W5 S2 the spoken hook may read the hook line" shared/worked-examples/rules.ts \
  "  if (echo) out.push(echo);" "" \
  "S2 refuses a spoken hook that is the on-screen hook line read aloud"
ts_plant "W6 the old order: answer spoken before the trap" scripts/worked-examples/composition.ts \
  '    { key: "trap", text: example.trap.voice },
    { key: "answer", text: example.answer.voice },
    { key: "outro", text: outroText },' \
  '    { key: "answer", text: example.answer.voice },
    { key: "trap", text: example.trap.voice },
    { key: "outro", text: outroText },' \
  "the spoken order is hook → setup → steps → trap → answer → call to action"
ts_plant "W7 the trap scene runs over the answer" scripts/worked-examples/composition.ts \
  '    { key: "trap", start: tTrap, end: tAnswer },' '    { key: "trap", start: tTrap, end: tEnd },' \
  "the spoken order is hook → setup → steps → trap → answer → call to action"
ts_plant "W8 voice lines placed by position, not key (the W45 manifests misplaced)" scripts/worked-examples/composition.ts \
  "  const lines = script.map((s) => byKey.get(s.key));" "  const lines = given;" \
  "a manifest voiced before the ruling (answer before trap) places every line in the new order"
ts_plant "W9 committed lines matched by position, not key" scripts/worked-examples/content.ts \
  "    const line = manifest.lines.find((l) => l.key === s.key);" \
  "    const line = manifest.lines[script.indexOf(s)];" \
  "a manifest voiced before the ruling (answer before trap) places every line in the new order"
# W10 re-pointed 2026-11-04 (SCL-273): the end-card scene now fills the credit, over several lines;
# again 2026-11-11 (SCL-277 IS 8): the scene list is now followed by the drawn figure's section.
ts_plant "W10 a caption track back in the composition" scripts/worked-examples/composition.ts \
  '        " end",
      ),
    ].join("\n") + figureSection;' \
  '        " end",
      ),
    `<section id="cap-hook-0" class="clip cap" data-start="0" data-duration="1" data-track-index="5"><div class="cap-box">Up</div></section>`,
    ].join("\n") + figureSection;' \
  "no caption track"
ts_plant "W11 the end card shows lyceon.ai" video-kit/worked-examples/templates/end-card.html \
  '<div class="brand-name">Lyceon SAT Prep</div>' '<div class="brand-name">lyceon.ai</div>' \
  "the end card reads Lyceon SAT Prep"
ts_plant "W12 the call to action says lyceon dot A.I." video-kit/worked-examples/voice.json \
  "\"outro_text\": \"Follow, there's one of these every day.\"," \
  "\"outro_text\": \"Follow, there's one of these every day. Lyceon dot A.I.\"," \
  "the end card reads Lyceon SAT Prep and the call to action never says lyceon.ai"
ts_plant "W13 the default voice back to af_heart" video-kit/worked-examples/voice.json \
  '"default_profile": "am_michael",' '"default_profile": "af_heart",' \
  "default and fallback are am_michael"
ts_plant "W14 the engine given Lyceon unrespelled" scripts/worked-examples/voice.ts \
  "    spokenBrandName(text)," "    text," \
  "authors write Lyceon; the engine is given the respelling"
ts_plant "W15 the limiter dropped from the loudness step" scripts/worked-examples/voice.ts \
  ',alimiter=limit=${limiterCeiling(target)}:level=disabled`,' '`,' \
  "pass 2 pads, applies the measured loudnorm, trims back, then limits"
ts_plant "W16 pass 2 ignores pass 1's measurement (one pass)" scripts/worked-examples/voice.ts \
  '${loudnormFilter(target, measured, "summary")}' '${loudnormFilter(target, null, "summary")}' \
  "pass 2 pads, applies the measured loudnorm, trims back, then limits"
ts_plant "W17 short lines not padded (the dynamic fallback lost)" scripts/worked-examples/voice.ts \
  '`apad=whole_dur=${pad},' '`' \
  "pass 2 pads, applies the measured loudnorm, trims back, then limits"
ts_plant "W18 the limiter at the true-peak ceiling (no headroom for overshoot)" scripts/worked-examples/voice.ts \
  "export const LIMITER_HEADROOM_DB = 0.5;" "export const LIMITER_HEADROOM_DB = 0;" \
  "the limiter sits 0.5 dB under the ceiling"
ts_plant "W19 loudnorm's measurement misread" scripts/worked-examples/voice.ts \
  "  const start = stderr.lastIndexOf(\"{\");" "  const start = stderr.indexOf(\"[\");" \
  "reads loudnorm's measurement, and none from a silent line"

ts_plant "W20 trap opening narrowed back to The trap only" shared/worked-examples/rules.ts \
  "  /^(?:the trap\\b|(?:now,?\\s+)?here[’']?s where (?:people|you) slip\\b)/i;" "  /^(?:the trap\\b)/i;" \
  "accepts the trap opening and the people-slip opening"
ts_plant "W21 trap opening accepts anything" shared/worked-examples/rules.ts \
  "  /^(?:the trap\\b|(?:now,?\\s+)?here[’']?s where (?:people|you) slip\\b)/i;" "  /^/i;" \
  "refuses a trap line that opens any other way"

ts_plant "W22 trap opener exemption dropped" shared/worked-examples/rules.ts \
  '    example.trap.voice.replace(TRAP_VOICE_OPENING, ""),' '    example.trap.voice,' \
  "the people-slip opener is not a claim about people; anything after it still is"
ts_plant "W23 whole trap line exempted" shared/worked-examples/rules.ts \
  '    example.trap.voice.replace(TRAP_VOICE_OPENING, ""),' '    "",' \
  "the people-slip opener is not a claim about people; anything after it still is"

# The video pilots' Chatterbox engine (owner brief "Video tools pilot" D3, Karl, 2026-11-02) takes
# its "Lyceon" respelling from voice.ts's one table.
ts_plant "W24 chatterbox given the kokoro respelling" scripts/worked-examples/voice.ts \
  '  chatterbox: "Lie-see-on",' '  chatterbox: "Lysee-ahn",' \
  "each engine gets its own respelling from the one table"

echo "=== TS: the final-mix true-peak limiter (SCL-270, Karl's ruling 2026-11-02) ==="
# F1 re-pointed 2026-11-14: the daily job was retired, so the plant is on the weekly job's loop.
ts_plant "F1 the weekly job skips the limiter (the render copied as the finished video)" .github/workflows/worked-example-daily.yml \
  '            pnpm exec tsx scripts/worked-examples/final-mix.ts "$WOUT/$d/render/$id.mp4" "$WOUT/$d/$id.mp4"' \
  '            cp "$WOUT/$d/render/$id.mp4" "$WOUT/$d/$id.mp4"' \
  "the weekly job renders, limits, then checks each date, and uploads only after every check (SCL-277)"
ts_plant "F2 the limiter dropped from the final-mix pass" scripts/worked-examples/final-mix.ts \
  ',alimiter=limit=${limit}:level=disabled:latency=1,' ',' \
  "after final-mix.ts it is at most -1 dBTP and passes"
ts_plant "F3 limited at the sample rate, not 4x (a sample limiter misses intersample peaks)" scripts/worked-examples/final-mix.ts \
  'export const TRUE_PEAK_OVERSAMPLE = 4;' 'export const TRUE_PEAK_OVERSAMPLE = 1;' \
  "after final-mix.ts it is at most -1 dBTP and passes"
ts_plant "F4 the ceiling raised in voice.json" video-kit/worked-examples/voice.json \
  '"max_true_peak_dbtp": -1,' '"max_true_peak_dbtp": -0.5,' \
  "max_true_peak_dbtp"
ts_plant "F5 the schema lets the ceiling rise above -1 dBTP" scripts/worked-examples/kit.ts \
  "max_true_peak_dbtp: z.number().min(-9).max(-1)," "max_true_peak_dbtp: z.number().min(-9).max(0)," \
  "voice.json may not raise the ceiling above -1 dBTP"
ts_plant "F6 the check compares against a raised ceiling" scripts/worked-examples/final-mix.ts \
  "  return measured.truePeakDbtp <= settings.max_true_peak_dbtp" "  return measured.truePeakDbtp <= settings.max_true_peak_dbtp + 0.5" \
  "refuses a finished mix over -1 dBTP or with no measurable audio"
ts_plant "F7 verify does not measure the finished mix" scripts/worked-examples/daily.ts \
  "  problems.push(...finishedMixProblems(join(out, post.video), kit));" "" \
  "verify refuses an unlimited intersample-peak mix"
ts_plant "F8 an encoder overshoot retried at the same headroom" scripts/worked-examples/final-mix.ts \
  "      Math.round((headroomDb + overshoot + FINAL_MIX_STEP_DB) * 100) / 100," "      headroomDb," \
  "an encoder overshoot is limited again with that much more headroom"

# The D pilots call the same limiter (SCL-270: "on the finished mix in every pipeline ... the D
# pilots"); their tests live in tests/ci/video-pilots.test.ts.
PILOT_TEST=tests/ci/video-pilots.test.ts
pilot_plant() {
  plant "$2" "$3" "$4" || { bad "$1 STALE"; restore; return; }
  OUT="$(pnpm exec vitest run "$PILOT_TEST" 2>&1)"; RC=$?
  expect_red "$1" "$5" "$OUT" "$RC"
  restore
}
echo "=== TS: the D pilots' finished mix (SCL-270) ==="
pilot_plant "F9 the pilot check reports true peak but does not fail on it" scripts/video-pilots/manim/check.ts \
  "  failures.push(...finishedMixProblems(video, kit));" "" \
  "fails a video over -1 dBTP true peak"
pilot_plant "F10 render.py writes the unlimited mix as the finished video" scripts/video-pilots/manim/render.py \
  '"-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", str(mixed),' \
  '"-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", str(out),' \
  "render.py limits the finished mix through final-mix.ts"
pilot_plant "F11 render.py skips the limiter" scripts/video-pilots/manim/render.py \
  '    run(["pnpm", "exec", "tsx", "scripts/worked-examples/final-mix.ts", str(mixed), str(out)], cwd=ROOT)' \
  '    shutil.copyfile(mixed, out)' \
  "render.py limits the finished mix through final-mix.ts"

echo
echo "worked-example mutations: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then echo "WORKED EXAMPLE MUTATIONS: FAIL"; exit 1; fi
echo "WORKED EXAMPLE MUTATIONS: PASS"
