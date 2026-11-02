#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the daily #social posts: TikTok keywords, the test month and the
# one-caption-per-post messages (owner brief "Simplify the daily #social messages + add
# keywords" and Karl's Step 0 rulings, 2026-11-02: "Tests: month rollover the day after Nov 7;
# missing-date warning; caption format per platform and section; unknown domain fails with a
# Slack notice; no bio line, alt text or link-to-send line in any message")
# ============================================================================
# @spec [that brief and those rulings] | @implemented [2026-11-02]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared test name.
#   RULE 3 — RESTORED. Every file is put back after each plant and the suite re-checked green.
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/social-posts-mut.XXXX)"

FILES=(
  "shared/social/posts.ts"
  "scripts/qotd-social/generate.ts"
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
POSTS=tests/ci/social-posts.test.ts
QOTD_SOCIAL=tests/ci/qotd-social.test.ts

# ts_plant <name> <file> <old> <new> <expected test name> <test files...>
ts_plant() {
  local name="$1" file="$2" old="$3" new="$4" expect="$5"; shift 5
  plant "$file" "$old" "$new" || { bad "$name STALE"; restore; return; }
  OUT="$(ts_check "$@")"; RC=$?
  expect_red "$name" "$expect" "$OUT" "$RC"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(ts_check "$POSTS" "$QOTD_SOCIAL")"; RC=$?
[ "$RC" = 0 ] && ok "social posts + QOTD social tests green" || { bad "baseline not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "SOCIAL POSTS MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== keywords ==="
ts_plant "P1 a domain dropped from the map" shared/social/posts.ts \
  '  "Expression of Ideas": ["SAT writing"],'$'\n' \
  "" \
  "the domain map names exactly the eight canonical domains" "$POSTS"
ts_plant "P2 an unknown domain is dropped quietly" shared/social/posts.ts \
  '      ok: false,'$'\n''      error: `keywords: "${domain}" is not a ${section} domain in SOCIAL_DOMAIN_KEYWORDS`,' \
  '      ok: true,'$'\n''      keywords: [],' \
  "an unknown domain, a non-canonical spelling or another section's domain is an error" "$POSTS"
ts_plant "P3 another section's domain accepted" shared/social/posts.ts \
  '    domainKeywords === undefined ||'$'\n''    !CANONICAL_DOMAINS_BY_SECTION[SECTION_CODE[section]].includes(domain)' \
  '    domainKeywords === undefined' \
  "an unknown domain, a non-canonical spelling or another section's domain is an error" "$POSTS"
ts_plant "P4 the section's keywords before the always-set" shared/social/posts.ts \
  '    ...SOCIAL_ALWAYS_KEYWORDS,'$'\n''    ...SOCIAL_SECTION_KEYWORDS[section],' \
  '    ...SOCIAL_SECTION_KEYWORDS[section],'$'\n''    ...SOCIAL_ALWAYS_KEYWORDS,' \
  "test month, always-set, section, domain, in that order" "$POSTS"

echo "=== the test month ==="
ts_plant "P5 the month rolls over on test day, not the day after" shared/social/posts.ts \
  '    (d) => d.status === "confirmed" && d.date >= postDate,' \
  '    (d) => d.status === "confirmed" && d.date > postDate,' \
  "is the next confirmed SAT on or after the post date, and rolls over the day after the test" "$POSTS"
ts_plant "P6 an anticipated date is used" shared/social/posts.ts \
  '    (d) => d.status === "confirmed" && d.date >= postDate,' \
  '    (d) => d.date >= postDate,' \
  "comes from SAT_TEST_DATES (confirmed only): no second list" "$POSTS"
ts_plant "P7 no warning when the list runs out" shared/social/posts.ts \
  '  return nextSatTest(postDate) === null'$'\n''    ? [' \
  '  return false'$'\n''    ? [' \
  "with no confirmed SAT left: no month anywhere, and a Slack-visible warning" "$POSTS"

echo "=== captions ==="
ts_plant "P8 a sixth hashtag" shared/social/posts.ts \
  '    SOCIAL_SECTION_HASHTAG[section],'$'\n''  ].join(" ");' \
  '    SOCIAL_SECTION_HASHTAG[section],'$'\n''    "#fyp",'$'\n''  ].join(" ");' \
  "#SAT #SATprep #digitalSAT #<Month>SAT and the section's, never more than five" "$POSTS"
ts_plant "P9 Facebook gets a link" shared/social/posts.ts \
  '  "How would you solve it? Share your approach below 👇";' \
  '  "How would you solve it? Answer it free at lyceon.ai/qotd 👇";' \
  "no link, no bio line, no #fyp or #studytok; Facebook asks for no comment word" "$POSTS"
ts_plant "P10 the headline loses its section" shared/social/posts.ts \
  '  return `${test ? `${test.month} ` : ""}SAT question of the day · ${section}`;' \
  '  return `${test ? `${test.month} ` : ""}SAT question of the day`;' \
  "the TikTok, Instagram and Facebook formats" "$POSTS"

echo "=== the run and the #social message ==="
ts_plant "P11 an unknown domain does not name itself in the failure" scripts/qotd-social/generate.ts \
  '  if (!keywords.ok) problems.push(`tiktok ${keywords.error}`);' \
  '  if (!keywords.ok) problems.push("tiktok: keywords");' \
  "an unknown domain refuses the post, and the run's Slack failure notice names it" "$QOTD_SOCIAL"
ts_plant "P12 the warning is not posted" scripts/qotd-social/post-to-slack.ts \
  '  if (warnings !== null)'$'\n''    steps.push({ item: item(), label: "QA", kind: "message", text: warnings });' \
  '  void warnings;' \
  "a warning (SAT date list needs updating) is posted first, outside the copy blocks" "$QOTD_SOCIAL"
ts_plant "P13 the alt text back in the Instagram message" scripts/qotd-social/post-to-slack.ts \
  '    text: copyBlock(m.instagram_caption),' \
  '    text: [copyBlock(m.instagram_caption), copyBlock(m.alt_text)].join("\n"),' \
  "no bio line, alt text or link to send in any message" "$QOTD_SOCIAL"
ts_plant "P14 the link to send back in the Instagram message" scripts/qotd-social/post-to-slack.ts \
  '    text: copyBlock(m.instagram_caption),' \
  '    text: [copyBlock(m.instagram_caption), m.links.instagram].join("\n"),' \
  "no bio line, alt text or link to send in any message" "$QOTD_SOCIAL"

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$POSTS" "$QOTD_SOCIAL")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "SOCIAL POSTS MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
