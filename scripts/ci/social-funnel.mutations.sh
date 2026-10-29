#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the social funnel (owner brief "One funnel for every social post: /start +
# CTAs + weekly growth report", Karl, 2026-10-28, item 4: "Tests and planted defects")
# ============================================================================
# @spec [that brief items 1-4] | @implemented [2026-10-28]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared test name.
#   RULE 3 — RESTORED. Every file is put back after each plant and the suite re-checked green.
#
# What a sign-up records from the links' tags is the sign-up attribution's (#1359) and planted in
# its own harness (scripts/ci/signup-attribution.mutations.sh), not here.
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/social-funnel-mut.XXXX)"

FILES=(
  "shared/social/funnel.ts"
  "shared/seo/head.ts"
  "shared/qotd/reveal.ts"
  "shared/qotd/tiktok.ts"
  "shared/qotd/social.ts"
  "shared/worked-examples/rules.ts"
  "scripts/worked-examples/daily.ts"
  "scripts/qotd-social/post-to-slack.ts"
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

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

# Only this checkout's tests: an agent worktree under .claude/ holds copies of the same files.
ts_check() { pnpm exec vitest run --exclude '.claude/**' --exclude '**/node_modules/**' "$@" 2>&1; }
CONTRACT=tests/ci/social-funnel.contract.test.ts
QOTD_SOCIAL=tests/ci/qotd-social.test.ts
WORKED=tests/ci/worked-examples.test.ts

# ts_plant <name> <file> <old> <new> <expected test name> <test files...>
ts_plant() {
  local name="$1" file="$2" old="$3" new="$4" expect="$5"; shift 5
  plant "$file" "$old" "$new" || { bad "$name STALE"; restore; return; }
  OUT="$(ts_check "$@")"; RC=$?
  expect_red "$name" "$expect" "$OUT" "$RC"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(ts_check "$CONTRACT" "$QOTD_SOCIAL" "$WORKED")"; RC=$?
[ "$RC" = 0 ] && ok "funnel contract + QOTD social + worked-example tests green" || { bad "baseline not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "SOCIAL FUNNEL MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== /start and its copy (item 1) ==="
ts_plant "F4 the cohort line ends a day early" shared/social/funnel.ts \
  "  return chicagoToday <= START_COHORT_DATE ? \"cohort\" : \"evergreen\";" \
  "  return chicagoToday < START_COHORT_DATE ? \"cohort\" : \"evergreen\";" \
  "speaks to the Dec 5 cohort through test day" "$CONTRACT"
ts_plant "F5 /start loses noindex" shared/seo/head.ts \
  "    ...(meta.noindex ? [\`<meta name=\"robots\" content=\"noindex\" />\`] : []),"$'\n' \
  "" \
  "its head says noindex" "$CONTRACT"
ts_plant "F6 the headline promises a free study plan" shared/social/funnel.ts \
  "? Find your blind spots free before test day.\`" \
  "? Get your free study plan, built for test day.\`" \
  "no line promises a free study plan" "$CONTRACT"

echo "=== the social CTAs (item 2) ==="
ts_plant "G1 the Reddit body writes the question out again" shared/qotd/reveal.ts \
  '  const body = linkCtaLine(funnelPhase(input.qotd_date), "reddit", "qotd");' \
  '  const body = `${input.stem}\n\n${linkCtaLine(funnelPhase(input.qotd_date), "reddit", "qotd")}`;' \
  "is the suggested title, the portrait image and one call-to-action line" "$QOTD_SOCIAL"
ts_plant "G2 the TikTok caption drops the comment line" shared/qotd/tiktok.ts \
  "    COMMENT_ANSWER_LINE,"$'\n'"    bioCtaLine(funnelPhase(postedOn))," \
  "    bioCtaLine(funnelPhase(postedOn))," \
  "the caption: follow line, comment line, link-in-bio line, hashtags" "$QOTD_SOCIAL"
ts_plant "G3 the Instagram caption loses its comment-SAT line" shared/qotd/social.ts \
  "    instagramCtaLine(funnelPhase(parsed.qotd_date))," \
  "    \"Link in bio\"," \
  "asks for an answer and a comment" "$QOTD_SOCIAL"
ts_plant "G4 the Instagram caption escapes the leak check" shared/qotd/social.ts \
  '    fields.push(["instagram_caption", instagramCaption]);' \
  '    void instagramCaption;' \
  "the day's explanation in the Instagram caption is a leak" "$QOTD_SOCIAL"
ts_plant "G5 the funnel-line filter drops any line that merely contains one" shared/social/funnel.ts \
  "    .filter((line) => !fixed.has(line.trim()))" \
  "    .filter((line) => ![...fixed].some((f) => line.includes(f)))" \
  "the leak checks leave out only whole lines that ARE a funnel line" "$CONTRACT"
ts_plant "G6 worked-example captions keep the old line" shared/worked-examples/rules.ts \
  "    bioCtaLine(funnelPhase(example.post_on))," \
  "    \"More SAT questions on lyceon.ai.\"," \
  "the real title and caption pass, with the music credited" "$WORKED"
ts_plant "G7 worked-example links tagged as the QOTD campaign" scripts/worked-examples/daily.ts \
  '    links: campaignLinks("worked_example"),' \
  '    links: campaignLinks("qotd"),' \
  "the post is built from the real title and caption and checked again" "$WORKED"
ts_plant "G8 the TikTok Slack message drops the bio link" scripts/qotd-social/post-to-slack.ts \
  "    escapeMrkdwn(m.links.tiktok)," \
  "    \"(no link)\"," \
  "the Slack TikTok message carries the tagged bio link" "$QOTD_SOCIAL"
ts_plant "G9 a hand-edited Instagram caption file is posted" scripts/qotd-social/post-to-slack.ts \
  '    ["instagram-caption.txt", manifest.instagram_caption],' \
  "" \
  "a hand-edited instagram-caption.txt is refused" "$QOTD_SOCIAL"

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$CONTRACT" "$QOTD_SOCIAL" "$WORKED")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "SOCIAL FUNNEL MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
