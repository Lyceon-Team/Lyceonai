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
# The DB plant (F7) edits the migration that DEFINES profiles_signup_tags_set_once today; the
# harness re-checks that it is still the LAST definition (CLAUDE.md, "a migration that replaces a
# function body orphans its mutations") and is checked by the real-Postgres suite, so it needs
# PGHOST; without Postgres it is SKIPPED (a skip, not a pass).
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261121000000_signup_channel_campaign.sql"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/social-funnel-mut.XXXX)"

FILES=(
  "$MIG"
  "packages/shared/src/analytics-consent-schema.ts"
  "server/lib/analytics/signup-source.ts"
  "client/src/lib/analytics/first-touch.ts"
  "client/src/pages/start.tsx"
  "shared/social/funnel.ts"
  "shared/seo/head.ts"
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

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }

HAVE_PG=0
if [ -n "${PGHOST:-}" ] && pg_isready -q -h "$PGHOST" -p "${PGPORT:-5432}" 2>/dev/null; then HAVE_PG=1; fi

ts_check() { pnpm exec vitest run "$@" 2>&1; }
CONTRACT=tests/ci/social-funnel.contract.test.ts
FIRST_TOUCH=client/src/lib/analytics/first-touch.test.ts
IDENTITY_PG=tests/ci/analytics-identity.pg.ci.test.ts

# ts_plant <name> <file> <old> <new> <expected test name> <test files...>
ts_plant() {
  local name="$1" file="$2" old="$3" new="$4" expect="$5"; shift 5
  plant "$file" "$old" "$new" || { bad "$name STALE"; restore; return; }
  OUT="$(ts_check "$@")"; RC=$?
  expect_red "$name" "$expect" "$OUT" "$RC"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(ts_check "$CONTRACT" "$FIRST_TOUCH")"; RC=$?
[ "$RC" = 0 ] && ok "funnel contract + first-touch tests green" || { bad "baseline not green"; echo "$OUT" | tail -30; }
if [ "$HAVE_PG" = 1 ]; then
  OUT="$(ts_check "$IDENTITY_PG")"; RC=$?
  [ "$RC" = 0 ] && ok "analytics identity PG suite green" || { bad "PG baseline not green"; echo "$OUT" | tail -30; }
else
  echo "  SKIP  PG baseline — no Postgres (a skip, not a pass)"
fi
if [ "$FAIL" -gt 0 ]; then echo "SOCIAL FUNNEL MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== /start and attribution (item 1) ==="
ts_plant "F1 a free-text tag passes the allowlist" packages/shared/src/analytics-consent-schema.ts \
  "  return parsed.success ? parsed.data : fallback;" \
  "  return parsed.success ? parsed.data : (value as T);" \
  "anything else is \`other\`, and no tag is no value" "$CONTRACT"
ts_plant "F2 the server trusts the browser's channel" server/lib/analytics/signup-source.ts \
  "  const channel = signupChannelSchema.safeParse(raw?.channel);" \
  "  const channel = { success: true as const, data: String(raw?.channel) };" \
  "the server re-parses what the browser sent" "$CONTRACT"
ts_plant "F3 tags stored before the visitor consents" client/src/lib/analytics/first-touch.ts \
  "  if (consent.status === \"accepted\" && firstTouch !== null) {" \
  "  if (firstTouch !== null) {" \
  "undecided: kept in memory only, never stored" "$FIRST_TOUCH"
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
ts_plant "F8 the sign-up link drops the channel tag" client/src/pages/start.tsx \
  "  if (tags.channel !== null) url.searchParams.set(\"utm_source\", tags.channel);" \
  "  void tags.channel;" \
  "the sign-up link carries the visit's allowlisted tags" "$CONTRACT"

if [ "$HAVE_PG" = 1 ]; then
  [ "$(last_definer profiles_signup_tags_set_once)" = "$MIG" ] || { bad "F7 targets $MIG but profiles_signup_tags_set_once is last defined in $(last_definer profiles_signup_tags_set_once)"; exit 1; }
  ts_plant "F7 signup_channel can be rewritten" "$MIG" \
    "  IF OLD.signup_channel IS NOT NULL" \
    "  IF FALSE" \
    "only the allowlisted values, each set once" "$IDENTITY_PG"
else
  echo "  SKIP  F7 (DB set-once) — no Postgres (a skip, not a pass)"
fi

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$CONTRACT" "$FIRST_TOUCH")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "SOCIAL FUNNEL MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
