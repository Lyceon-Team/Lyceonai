#!/usr/bin/env bash
# Review UI mutation gate — proves every U-test is load-bearing.
#
# @spec [brief R4 §3 ("Every assertion is planted"), U1-U9] | @implemented [2026-09-22]
#
# A gate counts only after its plant has turned THAT SPECIFIC test red and been
# reverted byte-identically. This script does that for U1-U9: it snapshots every
# product source file it will touch, applies one plant at a time, asserts the named
# test file FAILS, restores the snapshot, and `cmp`s the restore.
#
# PLANTS MUTATE PRODUCT SOURCE, NEVER A TEST FILE. A plant that edits the test proves
# only that the test can be broken, which was never in doubt.
#
# Usage:  bash scripts/ci/review-ui-gate.mutations.sh
# Exit 0 only if every plant produced a failure and every revert was byte-identical.

set -uo pipefail
cd "$(dirname "$0")/../.."
REPO="$PWD"

SNAP="$(mktemp -d)"
trap 'restore_all; rm -rf "$SNAP"' EXIT

FILES=(
  "client/src/lib/engine-config.ts"
  "client/src/lib/review-session-picker.ts"
  "client/src/hooks/useReview.ts"
  "client/src/pages/review.tsx"
  "client/src/components/review/review-landing-model.ts"
  "client/src/lib/route-shells.ts"
  "client/src/pages/resume-review.tsx"
  "client/src/pages/resume-practice.tsx"
  "client/src/components/practice/CanonicalPracticePage.tsx"
  "client/src/components/layout/app-shell.tsx"
  "packages/shared/src/return-path.ts"
)

snapshot_all() {
  for f in "${FILES[@]}"; do
    mkdir -p "$SNAP/$(dirname "$f")"
    cp "$REPO/$f" "$SNAP/$f"
  done
}

restore_all() {
  for f in "${FILES[@]}"; do
    [ -f "$SNAP/$f" ] && cp "$SNAP/$f" "$REPO/$f"
  done
}

verify_clean_revert() {
  local bad=0
  for f in "${FILES[@]}"; do
    if ! cmp -s "$SNAP/$f" "$REPO/$f"; then
      echo "  !! REVERT NOT BYTE-IDENTICAL: $f"
      bad=1
    fi
  done
  return $bad
}

PASS=0
FAIL=0

# plant <id> <description> <test-path> <file> <python-mutation>
plant() {
  local id="$1" desc="$2" tests="$3" file="$4" mutation="$5"

  printf '\n── %s ── %s\n' "$id" "$desc"

  if ! python3 - "$REPO/$file" <<PY
import sys
p = sys.argv[1]
s = open(p).read()
$mutation
open(p, "w").write(s)
PY
  then
    echo "  !! PLANT DID NOT APPLY (anchor missed) — $id"
    FAIL=$((FAIL + 1)); restore_all; return
  fi

  if pnpm -s exec vitest run $tests >/dev/null 2>&1; then
    echo "  !! NO-OP PLANT: $tests still GREEN with $id applied"
    FAIL=$((FAIL + 1))
  else
    echo "  ✓ red on plant"
    PASS=$((PASS + 1))
  fi

  restore_all
  if ! verify_clean_revert; then FAIL=$((FAIL + 1)); fi
}

snapshot_all
echo "Snapshot: $SNAP"

# ── U1 — practice's existing UI tests pass unchanged with the engine config ──────────
plant "U1" "point practice's create endpoint at a wrong URL" \
  "client/src/components/practice client/src/pages/resume-practice.test.tsx" \
  "client/src/lib/engine-config.ts" \
  'a = "    create: () => \"/api/practice/sessions\","
assert s.count(a) == 1
s = s.replace(a, "    create: () => \"/api/practice/sessions-WRONG\",", 1)'

# ── U2 — no reveal before submit ─────────────────────────────────────────────────────
plant "U2" "render the reveal pre-submit (force showResult in the loop)" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "            showResult={showResult}"
assert s.count(a) == 1
s = s.replace(a, "            showResult={true}", 1)'

# ── U2b — no practice copy on a review session ───────────────────────────────────────
plant "U2b" "hard-code practice's eyebrow back into the shell" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "      eyebrow={engine.labels.shellEyebrow}"
assert s.count(a) == 1
s = s.replace(a, "      eyebrow=\"Academic Practice Runner\"", 1)'

# ── U3 — the session id lives in the URL ─────────────────────────────────────────────
plant "U3" "keep the id out of the URL (component-local only)" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/pages/resume-review.tsx" \
  'a = "  const sessionId = params?.sessionId;"
assert s.count(a) == 1
s = s.replace(a, "  const sessionId: string | undefined = undefined;", 1)'

# ── R4.1a — the guidance panel states the real rule, verbatim ────────────────────────
plant "R4.1a" "restore the wrong 'twice' rule in the guidance copy" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/lib/engine-config.ts" \
  'a = "These are questions you missed or skipped. Get one right and it leaves your queue."
assert s.count(a) == 1
s = s.replace(a, "These are questions you missed or skipped. Answer one correctly twice and it leaves your queue.", 1)'

# ── R4.2 — practice's guidance card speaks to a student, not to us ───────────────────
plant "R4.2" "restore the 'runtime session truth' jargon in practice's guidance copy" \
  "client/src/components/practice/CanonicalPracticePage.guidance.test.tsx" \
  "client/src/lib/engine-config.ts" \
  'a = "      \"Your answers are submitted as you go. You can leave anytime; your place is saved.\","
assert s.count(a) == 1
s = s.replace(a, "      \"Responses submit directly to canonical practice endpoints. If you leave and return, Lyceon restores your unresolved state from runtime session truth.\",", 1)'

# ── R4.1b — Review by topic sits above the past-sessions picker ──────────────────────
# Re-pointed 2026-10-03 (student UI UI-52): the PageCard comment markers are gone; the plant
# swaps the two JSX blocks of the rebuilt page (ReviewByTopic, then PastSessions).
plant "R4.1b" "swap the topic picker back below the past-sessions picker" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'topic_i = s.index("          {total > 0 && topics.data !== undefined ? (")
past_i = s.index("          {total > 0 ? (\n            <PastSessions")
end_i = s.index("        </>\n      )}", past_i)
assert s.count("          {total > 0 && topics.data !== undefined ? (") == 1
topic = s[topic_i:past_i]
past = s[past_i:end_i]
s = s[:topic_i] + past + "\n" + topic.rstrip("\n") + "\n" + s[end_i:]'

# ── U4 — all three entry modes render ────────────────────────────────────────────────
# Re-pointed 2026-10-03 (student UI UI-52): the topic section's test id moved to the
# rebuilt ReviewByTopic section.
plant "U4" "drop the topic section from the landing" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "      data-testid=\"review-topic-picker\""
assert s.count(a) == 1
s = s.replace(a, "      data-testid=\"review-topic-picker-REMOVED\"", 1)'

# ── U5 — day grouping uses the BROWSER timezone ──────────────────────────────────────
plant "U5" "compute today in UTC instead of the browser timezone" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "    () => localDateKey(new Date(), browserTimeZone()),"
assert s.count(a) == 1
s = s.replace(a, "    () => localDateKey(new Date(), \"UTC\"),", 1)'

# ── U6 — an empty pool is not an error ───────────────────────────────────────────────
plant "U6" "render the error component for an empty pool" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "      data-testid=\"review-empty-state\""
assert s.count(a) == 1
s = s.replace(a, "      data-testid=\"review-pool-error\"", 1)'

# ── U7 — abandoned sessions appear in no open list, in either engine ─────────────────
plant "U7a" "review: stop dropping closed rows before the parse" \
  "client/src/hooks/useReview.test.tsx" \
  "client/src/hooks/useReview.ts" \
  'a = "export function dropClosedSessions(raw: unknown): unknown {"
assert s.count(a) == 1
s = s.replace(a, "export function dropClosedSessions(raw: unknown): unknown {\n  return raw;", 1)'

plant "U7b" "practice: remove the read-only guard from the resume shell" \
  "client/src/pages/resume-practice.readonly.test.tsx" \
  "client/src/pages/resume-practice.tsx" \
  'a = "  if (session.readOnly) {"
assert s.count(a) == 1
s = s.replace(a, "  if (false) {", 1)'

# ── U8 — review is reachable from the global nav ─────────────────────────────────────
# Re-pointed 2026-10-03 (student UI UI-41): the top-nav `navItems` array became the rail's
# `RAIL_ITEMS`, so the plant removes the whole Review rail entry.
plant "U8" "remove the Review entry from the live global nav" \
  "client/src/review-entry-points.test.ts" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "  {\n    key: \"review\",\n    label: \"Review\",\n    href: \"/review\",\n    icon: RotateCcw,\n    lock: null,\n    inTabBar: true,\n  },\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

# ── U9 — /review is in RETURN_PATH_ALLOWLIST ─────────────────────────────────────────
# Re-pointed 2026-09-29 (student UI UI-03): the allowlist is now derived from
# RETURN_PATH_ROUTE_ROLES, so the plant removes the `/review` entry from that map.
plant "U9" "remove /review from RETURN_PATH_ALLOWLIST" \
  "client/src/review-entry-points.test.ts" \
  "packages/shared/src/return-path.ts" \
  'a = "  \"/review\": [\"student\", \"admin\"],\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

# ── UI-52 — the rebuilt Review page (student UI, 2026-10-03) ─────────────────────────
# @spec [student-UI register UI-52; DESIGN.md §4 Review; OQ-22, OQ-24, UI-16, SCL-110]
# Each plant mutates one site of the page or its model; review.test.tsx must go red.
# `\x24` and `\x60` stand for "$" and a backtick inside this unquoted heredoc.

plant "UI52-Q1" "queue card: say 0 questions whatever the pool total" \
  "client/src/pages/review.test.tsx" \
  "client/src/components/review/review-landing-model.ts" \
  'a = "  return \x60\x24{total} \x24{total === 1 ? \"question\" : \"questions\"} to review\x60;"
assert s.count(a) == 1
s = s.replace(a, "  return \x60\x24{0} questions to review\x60;", 1)'

plant "UI52-Q2" "Start reviewing sends filter mode instead of queue" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "onClick={() => void start({ mode: \"queue\" })}"
assert s.count(a) == 1
s = s.replace(a, "onClick={() => void start({ mode: \"filter\", filters: {} })}", 1)'

plant "UI52-Q3" "a started session stays on /review instead of the runner" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "      navigate(\x60/review/session/\x24{result.sessionId}\x60);"
assert s.count(a) == 1
s = s.replace(a, "      navigate(\"/review\");", 1)'

plant "UI52-Q4" "an empty pool draws the error notice's test id" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "{pool.isError ? ("
assert s.count(a) == 1
s = s.replace(a, "{pool.isError || (pool.pool?.total ?? 1) === 0 ? (", 1)'

plant "UI52-Q5" "drop the UTC fallback line" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "{pool.pool?.timezoneFallback === true ? ("
assert s.count(a) == 1
s = s.replace(a, "{false ? (", 1)'

plant "UI52-Q6" "a second filled primary action (the topic button)" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "            variant=\"lyc-outline\"\n            disabled={!canStart || count === 0}"
assert s.count(a) == 1
s = s.replace(a, "            variant=\"lyc-primary\"\n            disabled={!canStart || count === 0}", 1)'

plant "UI52-O1" "open sessions lose their criteria name" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "const title = sessionTitle(\"review\", s.criteria, s.section);"
assert s.count(a) == 1
s = s.replace(a, "const title = \"Review session\";", 1)'

plant "UI52-O2" "End confirms but never terminates" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "if (confirming !== null) onEnd(confirming.id);"
assert s.count(a) == 1
s = s.replace(a, "void onEnd;", 1)'

plant "UI52-O3" "the session limit is reached one session later" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "open.sessions.length >= open.maxConcurrentSessions;"
assert s.count(a) == 1
s = s.replace(a, "open.sessions.length > open.maxConcurrentSessions;", 1)'

plant "UI52-T1" "domain chips lose their own-queue count" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "{domainChipLabel(d.label, own)}"
assert s.count(a) == 1
s = s.replace(a, "{d.label}", 1)'

plant "UI52-T2" "domain chips become single-select" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = ": [...prev, d.value],"
assert s.count(a) == 1
s = s.replace(a, ": [d.value],", 1)'

plant "UI52-T3" "the section switch keeps the old section's chosen domains" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "                    setChosen([]);\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "UI52-T4" "the topic start drops the section" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "? { sections: [section], domains: chosen }"
assert s.count(a) == 1
s = s.replace(a, "? { domains: chosen }", 1)'

plant "UI52-P1" "the past-session list starts expanded" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "const [expanded, setExpanded] = useState(false);"
assert s.count(a) == 1
s = s.replace(a, "const [expanded, setExpanded] = useState(true);", 1)'

plant "UI52-P2" "the toggle shows a past-session count (OQ-24 says none)" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "<span>Past sessions</span>"
assert s.count(a) == 1
s = s.replace(a, "<span>Past sessions ({rows.length})</span>", 1)'

plant "UI52-P3" "show a whole server page at once instead of five" \
  "client/src/pages/review.test.tsx" \
  "client/src/components/review/review-landing-model.ts" \
  'a = "export const PAST_SESSIONS_STEP = 5;"
assert s.count(a) == 1
s = s.replace(a, "export const PAST_SESSIONS_STEP = 20;", 1)'

plant "UI52-P4" "Load more never asks the server for its next page" \
  "client/src/pages/review.test.tsx" \
  "client/src/components/review/review-landing-model.ts" \
  'a = "  return nextShown > loaded && serverHasMore;"
assert s.count(a) == 1
s = s.replace(a, "  return false;", 1)'

plant "UI52-P5" "Redo names the wrong source session" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "source_session_id: row.source_session_id,"
assert s.count(a) == 1
s = s.replace(a, "source_session_id: row.source_engine,", 1)'

plant "UI52-R1" "the panel's by-section counts read zero" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "{bySection.get(s) ?? 0}</span>"
assert s.count(a) == 1
s = s.replace(a, "{0}</span>", 1)'

plant "UI52-R2" "paid: no mastery rows" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "{masteryGranted && mastery.data !== undefined ? ("
assert s.count(a) == 1
s = s.replace(a, "{false ? (", 1)'

plant "UI52-R3" "free: read mastery anyway (a gated read)" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "enabled: masteryGranted && studentId.length > 0,"
assert s.count(a) == 1
s = s.replace(a, "enabled: studentId.length > 0,", 1)'

plant "UI52-R4" "free: the locked card opens nothing" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "upgrade.open(\"mastery_detail\", masteryAccess.reason)"
assert s.count(a) == 1
s = s.replace(a, "void masteryAccess.reason", 1)'

plant "UI52-F1" "free: gate review behind the upgrade modal" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "    setStartFailure(null);\n    const result = await create.startSession(spec);"
assert s.count(a) == 1
s = s.replace(a, "    setStartFailure(null);\n    if (!masteryGranted) {\n      upgrade.open(\"mastery_detail\", \"plan\");\n      return;\n    }\n    const result = await create.startSession(spec);", 1)'

plant "UI52-S1" "put /review back on the light lock" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "  \"/review\": app(360, true, \"column\", null),"
assert s.count(a) == 1
s = s.replace(a, "  \"/review\": app(360, true),", 1)'

printf '\n────────────────────────────────\n'
echo "plants red as expected: $PASS"
echo "failures:               $FAIL"

if [ "$FAIL" -ne 0 ]; then
  echo "GATE FAILED"
  exit 1
fi

# Final proof: with every plant reverted, the suite is green again.
echo
echo "Re-running the full client suite on the restored tree..."
if pnpm -s exec vitest run client/src >/dev/null 2>&1; then
  echo "GATE PASSED — all plants red, all reverts byte-identical, suite green"
  exit 0
fi
echo "!! suite is NOT green after revert"
exit 1
