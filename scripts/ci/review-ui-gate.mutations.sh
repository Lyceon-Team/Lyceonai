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
  "client/src/components/question-renderer.tsx"
  "client/src/hooks/useCanonicalPractice.ts"
  "client/src/hooks/useKeyboardShortcuts.ts"
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
# Re-pointed 2026-10-03 (student UI UI-53): the runner was rebuilt and its QuestionRenderer
# call is indented two levels less; same prop, same plant.
plant "U2" "render the reveal pre-submit (force showResult in the loop)" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "        showResult={showResult}"
assert s.count(a) == 1
s = s.replace(a, "        showResult={true}", 1)'

# ── U2b — no practice copy on a review session ───────────────────────────────────────
# Re-pointed 2026-10-03 (student UI UI-53): the shell eyebrow (`eyebrow={engine.labels.
# shellEyebrow}`) is gone with the old runner chrome. The review runner is now named by its
# criteria in resume-review.tsx; the plant names it the practice way instead ("Practice").
plant "U2b" "name the review runner with practice's wording" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/pages/resume-review.tsx" \
  'a = "      title={sessionTitle(\"review\", session.criteria, null)}"
assert s.count(a) == 1
s = s.replace(a, "      title={sessionTitle(\"practice\", session.criteria, null)}", 1)'

# ── U3 — the session id lives in the URL ─────────────────────────────────────────────
plant "U3" "keep the id out of the URL (component-local only)" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/pages/resume-review.tsx" \
  'a = "  const sessionId = params?.sessionId;"
assert s.count(a) == 1
s = s.replace(a, "  const sessionId: string | undefined = undefined;", 1)'

# ── R4.1a, R4.2 — retired 2026-10-03 (student UI UI-53) ─────────────────────────────
# Both planted wrong wording into the session-guidance card's copy (engine-config.ts
# `labels.sessionGuidance`). UI-53 removed the card (DESIGN.md §4 draws none) and its copy, so
# neither anchor exists. What the two tests guarded (no "twice", no engineering jargon on the
# runner) is now asserted as absence by resume-review.test.tsx "R4.1 / UI-53" and the runner
# test's "no old chrome"; plant UI53-CH2 below puts a guidance card back and reddens both.

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


# ── UI-53 — practice and review runners on the Focus shell (2026-10-03) ───────────────
# DESIGN.md §4 Question runner, Runner.dc.html; register UI-53, OQ-35, F-53, F-64. Each plant
# mutates product source at an anchor that occurs exactly once; the line each one lands on is
# recorded in docs/plans/student-ui/evidence/wave5/UI-53/plants.log.

plant "UI53-L1" "letters by reverse position" \
  "client/src/components/question-renderer.display-letters.test.tsx client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/question-renderer.tsx" \
  'a = "const letter = DISPLAY_LETTERS[index] ?? null;"
assert s.count(a) == 1
s = s.replace(a, "const letter = DISPLAY_LETTERS[options.length - 1 - index] ?? null;", 1)'

plant "UI53-A1" "feedback panel rendered before submit" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/question-renderer.tsx" \
  'a = "      {showResult ? (\n        <section"
assert s.count(a) == 1
s = s.replace(a, "      {true ? (\n        <section", 1)'

plant "UI53-A2" "the hook reveals a leaking /next payload's explanation" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/hooks/useCanonicalPractice.ts" \
  'a = "        resetPerQuestionState();\n        return data;"
assert s.count(a) == 1
s = s.replace(a, "        resetPerQuestionState();\n      setShowResult(true);\n      setExplanation(String((data.question as unknown as Record<string, unknown> | null)?.explanation ?? \"\"));\n        return data;", 1)'

plant "UI53-A3" "a pre-submit mapping marks a choice as correct" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/question-renderer.tsx" \
  'a = "              : picked\n                ? \"picked\"\n                : \"idle\";"
assert s.count(a) == 1
s = s.replace(a, "              : opt.id === (options[1]?.id ?? \"\")\n                ? \"correct\"\n                : picked\n                  ? \"picked\"\n                  : \"idle\";", 1)'

plant "UI53-S1" "Submit enabled with no choice" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "disabled={runnerBusy || !canSubmit}"
assert s.count(a) == 1
s = s.replace(a, "disabled={runnerBusy}", 1)'

plant "UI53-S2" "Skip submits instead of skipping" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "onClick={() => void submitAnswer({ skipped: true })}"
assert s.count(a) == 1
s = s.replace(a, "onClick={() => void submitAnswer({ skipped: false })}", 1)'

plant "UI53-F1" "a miss titled Correct" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/question-renderer.tsx" \
  'a = "{isCorrect ? \"Correct\" : \"Not quite\"}"
assert s.count(a) == 1
s = s.replace(a, "{isCorrect ? \"Correct\" : \"Correct\"}", 1)'

plant "UI53-F2" "no 'Your answer' tag on the wrong pick" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/question-renderer.tsx" \
  'a = "                  ? \"Your answer\""
assert s.count(a) == 1
s = s.replace(a, "                  ? \"\"", 1)'

plant "UI53-F3" "no review-queue note on a practice miss" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/question-renderer.tsx" \
  'a = "{!isCorrect && missNote ? ("
assert s.count(a) == 1
s = s.replace(a, "{false ? (", 1)'

plant "UI53-F4" "review shows the review-queue note on a miss" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/lib/engine-config.ts" \
  'a = "    tutor: true,\n    missNote: false,"
assert s.count(a) == 1
s = s.replace(a, "    tutor: true,\n    missNote: true,", 1)'

plant "UI53-F5" "the explanation is not shown after submit" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/question-renderer.tsx" \
  'a = "            {shownExplanation.length > 0 ? ("
assert s.count(a) == 1
s = s.replace(a, "            {false ? (", 1)'

plant "UI53-K1" "→ / Enter after feedback do nothing" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx client/src/components/practice/CanonicalPracticePage.keyboard.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "      onNext: goNext,"
assert s.count(a) == 1
s = s.replace(a, "      onNext: () => undefined,", 1)'

plant "UI53-K2" "↓ ignored on a focused choice" \
  "client/src/components/practice/CanonicalPracticePage.keyboard.test.tsx" \
  "client/src/hooks/useKeyboardShortcuts.ts" \
  'a = "    {\n      key: \"ArrowDown\",\n      allowOnControls: isRunnerSubmitControl,"
assert s.count(a) == 1
s = s.replace(a, "    {\n      key: \"ArrowDown\",", 1)'

plant "UI53-P1" "Question N of M off by one" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "  return `Question ${index + 1} of ${total}`;"
assert s.count(a) == 1
s = s.replace(a, "  return `Question ${index} of ${total}`;", 1)'

plant "UI53-P2" "progress strip fills the wrong side" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "    i < index ? \"done\" : i === index ? \"current\" : \"todo\","
assert s.count(a) == 1
s = s.replace(a, "    i < index ? \"todo\" : i === index ? \"current\" : \"done\",", 1)'

plant "UI53-B1" "back goes to /dashboard" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "focus(\"Practice\", \"/practice\", false, null)"
assert s.count(a) == 1
s = s.replace(a, "focus(\"Practice\", \"/dashboard\", false, null)", 1)'

plant "UI53-TL1" "practice runner put back on the light lock" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "focus(\"Practice\", \"/practice\", false, null)"
assert s.count(a) == 1
s = s.replace(a, "focus(\"Practice\", \"/practice\")", 1)'

plant "UI53-T1" "LISA handed the choices" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "        sessionItemId={sessionItemId}\n"
assert s.count(a) == 1
s = s.replace(a, "        sessionItemId={sessionItemId}\n        {...{ choices: question?.options }}\n", 1)'

plant "UI53-O1" "no shorter-session note" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "{props.shortened === true && currentIndex === 0 ? ("
assert s.count(a) == 1
s = s.replace(a, "{false ? (", 1)'

plant "UI53-N1" "StrictMode double /next" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/hooks/useCanonicalPractice.ts" \
  'a = "    if (pending) return pending;"
assert s.count(a) == 1
s = s.replace(a, "    if (pending && false) return pending;", 1)'

plant "UI53-C1" "session_closed treated as an error (F-53)" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/hooks/useCanonicalPractice.ts" \
  'a = "nextPayloadBody.error === \"session_closed\""
assert s.count(a) == 1
s = s.replace(a, "nextPayloadBody.error === \"session_closed_X\"", 1)'

plant "UI53-C2" "a closed session never leaves" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx client/src/components/practice/CanonicalPracticePage.diagnostic.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "    if (sessionClosed) navigate(completionDest);"
assert s.count(a) == 1
s = s.replace(a, "    if (sessionClosed) void completionDest;", 1)'

plant "UI53-D1" "diagnostic shows Skip" \
  "client/src/components/practice/CanonicalPracticePage.diagnostic.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "            {!isDiagnostic ? ("
assert s.count(a) == 1
s = s.replace(a, "            {true ? (", 1)'

plant "UI53-CH1" "old End Session chrome back" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx client/src/components/practice/CanonicalPracticePage.diagnostic.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "      <div className=\"flex items-center gap-3\">\n        {!showResult ? ("
assert s.count(a) == 1
s = s.replace(a, "      <div className=\"flex items-center gap-3\">\n        <span>End Session</span>\n        {!showResult ? (", 1)'

plant "UI53-RP1" "practice runner not named by criteria" \
  "client/src/pages/resume-practice.test.tsx" \
  "client/src/pages/resume-practice.tsx" \
  'a = "      title={sessionTitle(\"practice\", session.criteria, session.section)}"
assert s.count(a) == 1
s = s.replace(a, "      title=\"Practice\"", 1)'

plant "UI53-RP2" "shortened not passed to the runner" \
  "client/src/pages/resume-practice.test.tsx" \
  "client/src/pages/resume-practice.tsx" \
  'a = "      shortened={session.shortened}\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "UI53-RR1" "review runner named with practice wording (U2b)" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/pages/resume-review.tsx" \
  'a = "title={sessionTitle(\"review\", session.criteria, null)}"
assert s.count(a) == 1
s = s.replace(a, "title={sessionTitle(\"practice\", session.criteria, null)}", 1)'

plant "UI53-O3" "the shorter-session note on every session" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "{props.shortened === true && currentIndex === 0 ? ("
assert s.count(a) == 1
s = s.replace(a, "{currentIndex === 0 ? (", 1)'

plant "UI53-NM1" "the bar ignores the session name" \
  "client/src/components/practice/CanonicalPracticePage.diagnostic.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "        {props.title}\n"
assert s.count(a) == 1
s = s.replace(a, "        {\"Practice\"}\n", 1)'

plant "UI53-DN1" "Done on the last question does nothing" \
  "client/src/components/practice/CanonicalPracticePage.diagnostic.test.tsx client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "  const goNext = (): void => {\n    void nextQuestion();\n  };"
assert s.count(a) == 1
s = s.replace(a, "  const goNext = (): void => {\n    if (!isLastQuestion) void nextQuestion();\n  };", 1)'

plant "UI53-C3" "an open session navigates away" \
  "client/src/components/practice/CanonicalPracticePage.diagnostic.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "    if (sessionClosed) navigate(completionDest);"
assert s.count(a) == 1
s = s.replace(a, "    if (!sessionClosed) navigate(completionDest);", 1)'

plant "UI53-CH2" "the guidance card is back" \
  "client/src/pages/resume-review.test.tsx client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "      {error ? <Notice tone=\"danger\" title={String(error)} /> : null}"
assert s.count(a) == 1
s = s.replace(a, "      <p>Session Guidance</p>\n      {error ? <Notice tone=\"danger\" title={String(error)} /> : null}", 1)'

plant "UI53-C4" "the last answer closes the runner before its feedback is read" \
  "client/src/components/practice/CanonicalPracticePage.runner.test.tsx" \
  "client/src/hooks/useCanonicalPractice.ts" \
  'a = "        if (data.state) setSessionState(data.state);\n        // Owner ruling"
assert s.count(a) == 1
s = s.replace(a, "        if (data.state) setSessionState(data.state);\n        if (data.state === \"completed\") setSessionClosed(true);\n        // Owner ruling", 1)'

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
