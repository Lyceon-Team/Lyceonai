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
  "client/src/components/layout/HeaderUserMenu.tsx"
  "client/src/components/home/FullLengthCard.tsx"
  "client/src/components/home/PaidHome.tsx"
  "client/src/components/home/FreeHome.tsx"
  "packages/shared/src/return-path.ts"
  "client/src/features/exam/lib/tests-home-model.ts"
  "client/src/features/exam/pages/TestsHomePage.tsx"
  "client/src/features/exam/pages/ExamReportPage.tsx"
  "client/src/features/exam/components/DisclosedScore.tsx"
  "client/src/features/exam/components/DomainSegments.tsx"
  "client/src/features/exam/lib/domain-weights.ts"
  "client/src/features/exam/components/ExamHeader.tsx"
  "client/src/pages/calendar.tsx"
  "client/src/features/calendar/components/StudentChrome.tsx"
  "client/src/features/calendar/components/WeekGrid.tsx"
  "client/src/features/calendar/api/queries.ts"
  "client/src/features/calendar/CalendarView.tsx"
  "client/src/features/calendar/components/FreeCalendar.tsx"
  "client/src/pages/chat.tsx"
  "client/src/components/tutor/TutorThreadParts.tsx"
  "client/src/hooks/tutor-client.ts"
  "client/src/styles/student-tokens.css"
  "client/src/pages/mastery.tsx"
  "client/src/components/mastery/MasteryRow.tsx"
  "client/src/components/settings/settings-sections.ts"
  "client/src/pages/settings.tsx"
  "client/src/components/settings/ProfileSection.tsx"
  "client/src/components/settings/AccountSection.tsx"
  "client/src/components/settings/BillingSection.tsx"
  "client/src/components/settings/LinkSection.tsx"
  "client/src/components/settings/AppearanceSection.tsx"
  "client/src/lib/settings-api.ts"
  "client/src/hooks/useProfileQuery.ts"
  "client/src/components/account-deletion/DeleteAccountCard.tsx"
  "client/src/components/student/StudentGuardiansPanel.tsx"
  "client/src/components/student/StudentLinkCodePanel.tsx"
  "client/src/components/layout/LegalFooter.tsx"
  "client/src/pages/help.tsx"
  "client/src/pages/upgrade.tsx"
  "client/src/pages/notifications.tsx"
  "client/src/App.tsx"
  "client/src/pages/not-found.tsx"
  "client/src/components/auth/SupabaseAuthForm.tsx"
  "client/src/pages/login.tsx"
  "client/src/components/auth/PasswordField.tsx"
  "client/src/components/ui/input.tsx"
  "client/src/components/ui/checkbox.tsx"
  "client/src/components/ui/select.tsx"
  "client/src/pages/profile-complete.tsx"
  "client/src/pages/update-password.tsx"
  "client/src/pages/account-recover.tsx"
  "client/src/pages/guardian-required.tsx"
  "client/src/components/account-deletion/PendingDeletionScreen.tsx"
  "client/src/lib/plan-copy.ts"
  "client/src/components/auth/RequireRole.tsx"
  "client/src/components/layout/BareCardShell.tsx"
  "client/src/components/tutor/ScopedTutorPanel.tsx"
  "client/src/components/tutor/LisaUpgradeCard.tsx"
  "client/src/components/layout/FocusShell.tsx"
  "client/src/features/exam/lib/phone-notice.ts"
  "client/src/features/exam/lib/useFullLengthPhonePrecheck.tsx"
  "client/src/features/exam/pages/ExamSessionPage.tsx"
  "client/src/features/calendar/calendar-student.css"
  "client/src/features/exam/components/ExamStatus.tsx"
  "client/src/features/calendar/components/FullLengthFields.tsx"
  "packages/shared/src/exam-form-display.ts"
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
# `RAIL_ITEMS`, so the plant removes the whole Review rail entry. Re-anchored 2026-10-05: the
# rail item lost #1108's `inTabBar` flag (the tab bar has its own `TAB_BAR_KEYS`).
plant "U8" "remove the Review entry from the live global nav" \
  "client/src/review-entry-points.test.ts" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "  {\n    key: \"review\",\n    label: \"Review\",\n    href: \"/review\",\n    icon: RotateCcw,\n    lock: null,\n  },\n"
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


# ── UI-53 / OQ-54 (a), OQ-57 (f) — the review runner's LISA panel on the student tokens ──
# Owner ruling 2026-10-05: "Move the review runner's LISA panel onto student tokens in #1073
# now". The review runner leaves the light lock; ScopedTutorPanel and LisaUpgradeCard draw with
# the `lyc-*` tokens only, and the card shows approved copy only (OQ-44). Each plant mutates
# product source at a single occurrence (asserted count == 1) and must redden the named test.
T54L="client/src/components/tutor/ScopedTutorPanel.contract.test.tsx"

plant "OQ54-TL1" "review runner put back on the light lock" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "focus(\"Review\", \"/review\", false, null)"
assert s.count(a) == 1
s = s.replace(a, "focus(\"Review\", \"/review\")", 1)'

plant "OQ54-K1" "panel frame back on the app-wide tokens" \
  "$T54L" \
  "client/src/components/tutor/ScopedTutorPanel.tsx" \
  'a = "overflow-hidden rounded-lg border border-lyc-rule bg-lyc-sheet\""
assert s.count(a) == 1
s = s.replace(a, "overflow-hidden rounded-2xl border border-border/60 bg-card\"", 1)'

plant "OQ54-K2" "question chip back to 12px legacy text" \
  "$T54L" \
  "client/src/components/tutor/ScopedTutorPanel.tsx" \
  'a = "px-2.5 py-0.5 text-lyc-meta font-semibold text-lyc-ink\""
assert s.count(a) == 1
s = s.replace(a, "px-2.5 py-0.5 text-xs font-medium text-lyc-ink\"", 1)'

plant "OQ54-K3" "opener body back on the legacy muted colour" \
  "$T54L" \
  "client/src/components/tutor/ScopedTutorPanel.tsx" \
  'a = "<p className=\"m-0 mt-1 text-lyc-body text-lyc-muted\">{OPENER_BODY}</p>"
assert s.count(a) == 1
s = s.replace(a, "<p className=\"m-0 mt-1 text-lyc-body text-muted-foreground\">{OPENER_BODY}</p>", 1)'

plant "OQ54-K4" "Hide LISA falls back to the base 14px shadcn size" \
  "$T54L" \
  "client/src/components/tutor/ScopedTutorPanel.tsx" \
  'a = "className=\"shrink-0 text-lyc-body\""
assert s.count(a) == 1
s = s.replace(a, "className=\"shrink-0\"", 1)'

plant "OQ54-K5" "opener title drawn with a raw hex colour" \
  "$T54L" \
  "client/src/components/tutor/ScopedTutorPanel.tsx" \
  'a = "<p className=\"m-0 text-lyc-body font-semibold text-lyc-ink-strong\">"
assert s.count(a) == 1
s = s.replace(a, "<p className=\"m-0 text-lyc-body font-semibold text-[#1a1a1a]\">", 1)'

plant "OQ54-K6" "the first-message composer loses the panel inset" \
  "$T54L" \
  "client/src/components/tutor/ScopedTutorPanel.tsx" \
  'a = "pendingMessage ? \"LISA is responding...\" : COMPOSER_PLACEHOLDER\n            }\n            inset=\"panel\"\n"
assert s.count(a) == 1
s = s.replace(a, "pendingMessage ? \"LISA is responding...\" : COMPOSER_PLACEHOLDER\n            }\n", 1)'

plant "OQ54-K7" "a thread turn label back to 12px legacy text" \
  "$T54L" \
  "client/src/components/tutor/TutorThreadParts.tsx" \
  'a = "<span className=\"text-lyc-meta font-semibold text-lyc-muted\">\n        {isStudent"
assert s.count(a) == 1
s = s.replace(a, "<span className=\"text-xs font-semibold text-lyc-muted\">\n        {isStudent", 1)'

# OQ-61 (h): the W4-11 draft body is deleted, so this plant draws an unapproved body that still
# exists — the billing resolver's generic sentence — in place of the approved one.
plant "OQ54-C1" "the LISA card shows an unapproved body" \
  "$T54L" \
  "client/src/components/tutor/LisaUpgradeCard.tsx" \
  'a = "<p className=\"m-0 text-lyc-body text-lyc-ink\">{copy.body}</p>"
assert s.count(a) == 1
s = s.replace(a, "<p className=\"m-0 text-lyc-body text-lyc-ink\">Choose a plan to unlock LISA.</p>", 1)'

plant "OQ54-C2" "Unlock LISA opens the wrong feature's modal" \
  "$T54L" \
  "client/src/components/tutor/LisaUpgradeCard.tsx" \
  'a = "upgrade.open(\"tutor_access\", \"plan\")"
assert s.count(a) == 1
s = s.replace(a, "upgrade.open(\"mastery_detail\", \"plan\")", 1)'

plant "OQ54-C3" "the LISA card back on the app-wide tokens" \
  "$T54L" \
  "client/src/components/tutor/LisaUpgradeCard.tsx" \
  'a = "rounded-lg border border-lyc-rule bg-lyc-paper p-5"
assert s.count(a) == 1
s = s.replace(a, "rounded-lg border border-border bg-card p-5", 1)'

plant "OQ54-C4" "the LISA card adds words beyond the approved copy" \
  "$T54L" \
  "client/src/components/tutor/LisaUpgradeCard.tsx" \
  'a = "{copy.body}</p>"
assert s.count(a) == 1
s = s.replace(a, "{copy.body} Upgrade today.</p>", 1)'

# ── UI-54 — Full-Length home, exam session and report on the student tokens (2026-10-03) ─
# DESIGN.md §4 Full-Length home and Exam report, FullLength.dc.html, Report.dc.html; register
# UI-54, ruling 7, OQ-30..OQ-34, OQ-49. Each plant mutates product source at a single
# occurrence (asserted count == 1) and must redden the named UI-54 test.
T54_HOME="client/src/features/exam/pages/TestsHomePage.test.tsx"
T54_REPORT="client/src/features/exam/pages/ExamReportPage.test.tsx"

plant "UI54-P1" "Start outranks Resume as the one primary action" \
  "$T54_HOME" \
  "client/src/features/exam/lib/tests-home-model.ts" \
  'a = "  return pick(\"resume\") ?? pick(\"start\") ?? pick(\"take-again\");"
assert s.count(a) == 1
s = s.replace(a, "  return pick(\"start\") ?? pick(\"resume\") ?? pick(\"take-again\");", 1)'

plant "UI54-S1" "OQ-31: the completed card drops its score" \
  "$T54_HOME" \
  "client/src/features/exam/lib/tests-home-model.ts" \
  'a = "  return `Completed ${dayMonth(row.completed_at)}. Score ${row.total_scaled}.`;"
assert s.count(a) == 1
s = s.replace(a, "  return `Completed ${dayMonth(row.completed_at)}.`;", 1)'

plant "UI54-S2" "§15.1: the card score loses its disclosure" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "          <DisclosureNote disclosure={row.scored.disclosure} className={NOTE} />"
assert s.count(a) == 1
s = s.replace(a, "          null", 1)'

plant "UI54-IP1" "OQ-32: the in-progress card ignores /state" \
  "$T54_HOME" \
  "client/src/features/exam/lib/tests-home-model.ts" \
  'a = "    return `In progress: ${sectionDisplayLabel(position.section) ?? \"\"}, Module ${position.module}`;"
assert s.count(a) == 1
s = s.replace(a, "    return \"In progress\";", 1)'

plant "UI54-H1" "OQ-30: a history row links to the session, not its report" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "              href={reportPath(row.session_id)}"
assert s.count(a) == 1
s = s.replace(a, "              href={sessionPath(row.session_id)}", 1)'

plant "UI54-F1" "free plan: the forms read fires anyway" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "    queryFn: fetchExamForms,\n    staleTime: 0,\n    enabled: examGranted,"
assert s.count(a) == 1
s = s.replace(a, "    queryFn: fetchExamForms,\n    staleTime: 0,\n    enabled: true,", 1)'

plant "UI54-F2" "free plan: no in-page upgrade card" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "      {examLocked !== null ? ("
assert s.count(a) == 1
s = s.replace(a, "      {examLocked === undefined ? (", 1)'

plant "UI54-ST1" "Start lands somewhere other than the exam session route" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "      navigate(sessionPath(session.session_id));"
assert s.count(a) == 1
s = s.replace(a, "      navigate(\"/tests\");", 1)'

plant "UI54-R1" "§15.1: the report score card loses its disclosure" \
  "$T54_REPORT" \
  "client/src/features/exam/pages/ExamReportPage.tsx" \
  'a = "                <TimingFact mode={payload.mode} />\n              </div>\n              <div className=\"border-t border-lyc-rule pt-4\">\n                <DisclosureNote\n                  disclosure={payload.disclosure}\n                  className={NOTE}\n                />\n              </div>\n            </section>\n          </DisclosedScore>\n          <KnowledgeAndSkills payload={payload} />\n        </div>\n      );\n    case \"partial_scored\":"
assert s.count(a) == 1
s = s.replace(a, "                <TimingFact mode={payload.mode} />\n              </div>\n            </section>\n          </DisclosedScore>\n          <KnowledgeAndSkills payload={payload} />\n        </div>\n      );\n    case \"partial_scored\":", 1)'

plant "UI54-R2" "the disclosure gate lets a score through without its disclosure" \
  "$T54_REPORT" \
  "client/src/features/exam/components/DisclosedScore.tsx" \
  'a = "  if (!examDisclosureSchema.safeParse(disclosure).success) {"
assert s.count(a) == 1
s = s.replace(a, "  if (disclosure === \"never\") {", 1)'

plant "UI54-R3" "OQ-33: Review your answers is back" \
  "$T54_REPORT" \
  "client/src/features/exam/pages/ExamReportPage.tsx" \
  'a = "                Total score\n              </h2>"
assert s.count(a) == 1
s = s.replace(a, "                Total score\n              </h2>\n              <button type=\"button\">Review your answers</button>", 1)'

plant "UI54-R4" "OQ-34: the lapsed report does not open the upgrade modal" \
  "$T54_REPORT" \
  "client/src/features/exam/pages/ExamReportPage.tsx" \
  'a = "    opened.current = true;\n    open(\"exam_full_length\", \"plan\");"
assert s.count(a) == 1
s = s.replace(a, "    opened.current = true;", 1)'

# Re-pointed 2026-10-05 (form names, owner ruling): the title now renders
# `displayFormName(payload.test_form_name)`; same plant, drops " report".
plant "UI54-R5" "the report top bar drops 'report'" \
  "$T54_REPORT" \
  "client/src/features/exam/pages/ExamReportPage.tsx" \
  'a = "            {displayFormName(payload.test_form_name)} report"
assert s.count(a) == 1
s = s.replace(a, "            {displayFormName(payload.test_form_name)}", 1)'

plant "UI54-K1" "ruling 7: segments drawn in a mastery colour" \
  "$T54_REPORT" \
  "client/src/features/exam/components/DomainSegments.tsx" \
  'a = "? \"border-lyc-ink-strong bg-lyc-ink-strong\""
assert s.count(a) == 1
s = s.replace(a, "? \"border-lyc-lv4-fill bg-lyc-lv4-fill\"", 1)'

plant "UI54-K2" "ruling 7: one segment more than segments_filled" \
  "$T54_REPORT" \
  "client/src/features/exam/components/DomainSegments.tsx" \
  'a = "i < r.segments_filled ? \"true\" : \"false\""
assert s.count(a) == 1
s = s.replace(a, "i <= r.segments_filled ? \"true\" : \"false\"", 1)'

plant "UI54-K3" "ruling 7: an N-of-M count beside a domain" \
  "$T54_REPORT" \
  "client/src/features/exam/components/DomainSegments.tsx" \
  'a = "                        {r.domain}\n                      </span>"
assert s.count(a) == 1
s = s.replace(a, "                        {r.domain} {r.segments_filled} of 7\n                      </span>", 1)'

plant "UI54-K4" "a total = 0 domain is omitted without its reason" \
  "$T54_REPORT" \
  "client/src/features/exam/components/DomainSegments.tsx" \
  'a = "    \"no_items_served\",\n  ];"
assert s.count(a) == 1
s = s.replace(a, "  ];", 1)'

plant "UI54-K5" "a College Board weight line drifts" \
  "$T54_REPORT" \
  "client/src/features/exam/lib/domain-weights.ts" \
  'a = "26% of the section, 12 to 14 questions"
assert s.count(a) == 1
s = s.replace(a, "27% of the section, 12 to 14 questions", 1)'

plant "UI54-TL1" "/tests put back on the light lock" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "  \"/tests\": app(360, true, \"column\", null),"
assert s.count(a) == 1
s = s.replace(a, "  \"/tests\": app(360, true),", 1)'

plant "UI54-TL2" "the timed module follows the device theme" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "    themeLock: timed ? \"light\" : themeLock,"
assert s.count(a) == 1
s = s.replace(a, "    themeLock: timed ? null : themeLock,", 1)'

plant "UI54-TY1" "the timed module header drops below 14px" \
  "client/src/features/exam/exam-module-typography.test.ts" \
  "client/src/features/exam/components/ExamHeader.tsx" \
  'a = "          className=\"m-0 text-lyc-meta text-[var(--exam-muted)]\""
assert s.count(a) == 1
s = s.replace(a, "          className=\"m-0 text-[13px] text-[var(--exam-muted)]\"", 1)'

# ── UI-55: the student calendar (client/src/pages/calendar.ui55.test.tsx) ──

T55="client/src/pages/calendar.ui55.test.tsx"

plant "UI55-TL1" "/calendar put back on the light lock" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "  \"/calendar\": app(340, false, \"full\", null),"
assert s.count(a) == 1
s = s.replace(a, "  \"/calendar\": app(340, false, \"full\"),", 1)'

plant "UI55-R1" "Regenerate plan calls nothing" \
  "$T55" \
  "client/src/features/calendar/components/StudentChrome.tsx" \
  'a = "              onClick={regenerate.onClick}"
assert s.count(a) == 1
s = s.replace(a, "              onClick={() => undefined}", 1)'

plant "UI55-M1" "the calendar read drops the inline-denial meta (the modal auto-opens)" \
  "$T55" \
  "client/src/features/calendar/api/queries.ts" \
  'a = "    meta: ENTITLEMENT_DENIAL_INLINE_META,\n    queryKey: calendarKeys.range(from, to, timezone),"
assert s.count(a) == 1
s = s.replace(a, "    queryKey: calendarKeys.range(from, to, timezone),", 1)'

plant "UI55-S1" "the week stops starring the test day" \
  "$T55" \
  "client/src/features/calendar/components/WeekGrid.tsx" \
  'a = "          isTestDay={testDate !== null && date === testDate}"
assert s.count(a) == 1
s = s.replace(a, "          isTestDay={false}", 1)'

plant "UI55-F1" "a free first save drops the schedule the route requires on create" \
  "$T55" \
  "client/src/pages/calendar.tsx" \
  'a = "              ? { ...openingSchedule(setupDefaults), ...goal }"
assert s.count(a) == 1
s = s.replace(a, "              ? goal", 1)'

# ── SCL-211 / OQ-56 (2026-10-05): no streak line, no facts strip; the free form is read-only
# after the first save, with "Edit goals in Settings" ──

plant "UI55-NF1" "the student calendar draws the facts strip again" \
  "$T55" \
  "client/src/features/calendar/CalendarView.tsx" \
  'a = "      {viewer === \"guardian\" && model !== null ? ("
assert s.count(a) == 1
s = s.replace(a, "      {model !== null ? (", 1)'

# `StreakFact` is module-private to Chrome.tsx (knip, Codex finding 4), so the plant draws
# the streak line's own markup inline rather than importing a component it cannot reach.
plant "UI55-NS1" "the student header draws the streak line again" \
  "$T55" \
  "client/src/features/calendar/components/StudentChrome.tsx" \
  'b = "          {title}\n        </h1>\n      </div>"
assert s.count(b) == 1
s = s.replace(b, "          {title}\n        </h1>\n        <div className=\"item\" data-item=\"streak\"><div className=\"streakline\">🔥 <b>4</b> day streak</div></div>\n      </div>", 1)'

# OQ-61 (a) / SCL-212: §15's standalone streak route is retired and the retired-endpoints gate
# refuses its old path anywhere in the tree, so this plant reintroduces a streak read under a
# NEW path — the one the gate cannot see and only the page test's `streakReads()` can.
plant "UI55-NS2" "the student page reads a streak again, under a new path" \
  "$T55" \
  "client/src/pages/calendar.tsx" \
  'a = "  // No streak read: the student calendar draws no streak line (SCL-211, OQ-56).\n"
assert s.count(a) == 1
s = s.replace(a, "  void apiRequest(\"/api/calendar/streak\").catch(() => undefined);\n", 1)
b = "import { toUserFacingMessage } from \"@/lib/api-error\";\n"
assert s.count(b) == 1
s = s.replace(b, b + "import { apiRequest } from \"@/lib/queryClient\";\n", 1)'

plant "UI55-RO1" "the free form stays editable after the first save" \
  "$T55" \
  "client/src/features/calendar/components/FreeCalendar.tsx" \
  'a = "        {profile === null ? ("
assert s.count(a) == 1
s = s.replace(a, "        {true ? (", 1)'

plant "UI55-RO2" "Edit goals in Settings goes somewhere the goal card's Edit goals does not" \
  "$T55" \
  "client/src/features/calendar/components/FreeCalendar.tsx" \
  'a = "        href={EDIT_GOALS_HREF}"
assert s.count(a) == 1
s = s.replace(a, "        href=\"/profile?tab=account\"", 1)'

plant "UI55-RO3" "the saved test date reads raw, not as the goal card's date" \
  "$T55" \
  "client/src/features/calendar/components/FreeCalendar.tsx" \
  'a = "              : weekdayDayMonth(profile.target_exam_date)"
assert s.count(a) == 1
s = s.replace(a, "              : profile.target_exam_date", 1)'

plant "UI55-RO4" "a saved profile with no test date reads blank" \
  "$T55" \
  "client/src/features/calendar/components/FreeCalendar.tsx" \
  'a = "          absent={ABSENT_COPY.student.testDate}"
assert s.count(a) == 1
s = s.replace(a, "          absent=\"\"", 1)'

plant "UI55-RO5" "a saved profile with no target reads blank" \
  "$T55" \
  "client/src/features/calendar/components/FreeCalendar.tsx" \
  'a = "          absent={ABSENT_COPY.student.target}"
assert s.count(a) == 1
s = s.replace(a, "          absent=\"\"", 1)'

plant "UI55-RO6" "the pre-save form reports itself as saved" \
  "$T55" \
  "client/src/features/calendar/components/FreeCalendar.tsx" \
  'a = "      data-state=\"editing\""
assert s.count(a) == 1
s = s.replace(a, "      data-state=\"saved\"", 1)'

# ── UI-56: LISA (client/src/pages/chat.ui56.test.tsx) ──────────────────────────────────

T56="client/src/pages/chat.ui56.test.tsx"

plant "UI56-TL1" "/chat put back on the light lock" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "  \"/chat\": app(320, false, \"full\", null),"
assert s.count(a) == 1
s = s.replace(a, "  \"/chat\": app(320, false, \"full\"),", 1)'

plant "UI56-K1" "Enter in the LISA composer sends nothing" \
  "$T56" \
  "client/src/components/tutor/TutorThreadParts.tsx" \
  'a = "      onSend: onSubmit,"
assert s.count(a) == 1
s = s.replace(a, "      onSend: () => undefined,", 1)'

plant "UI56-K2" "Shift+Enter matches the Enter binding (sends, no new line)" \
  "$T56" \
  "client/src/hooks/useKeyboardShortcuts.ts" \
  'a = "    event.shiftKey === (binding.shift ?? false) &&"
assert s.count(a) == 1
s = s.replace(a, "    true &&", 1)'

plant "UI56-S1" "the student bubble loses its You label" \
  "$T56" \
  "client/src/components/tutor/TutorThreadParts.tsx" \
  'a = "        {isStudent ? \"You\" : \"LISA\"}"
assert s.count(a) == 1
s = s.replace(a, "        {isStudent ? \"\" : \"LISA\"}", 1)'

plant "UI56-T1" "Send stays enabled while LISA is thinking" \
  "$T56" \
  "client/src/components/tutor/TutorThreadParts.tsx" \
  'a = "            disabled={disabled}\n            className=\"h-[50px]"
assert s.count(a) == 1
s = s.replace(a, "            disabled={false}\n            className=\"h-[50px]", 1)'

plant "UI56-T2" "the typing bubble loses its LISA label" \
  "$T56" \
  "client/src/components/tutor/TutorThreadParts.tsx" \
  'a = "      <span className=\"text-lyc-meta font-semibold text-lyc-muted\">LISA</span>"
assert s.count(a) == 1
s = s.replace(a, "      <span className=\"text-lyc-meta font-semibold text-lyc-muted\">Tutor</span>", 1)'

plant "UI56-T3" "the dots bounce with a Tailwind animation, not the reduced-motion-aware .lyc-dot" \
  "$T56" \
  "client/src/components/tutor/TutorThreadParts.tsx" \
  'a = "        <span className=\"lyc-dot\" />\n        <span className=\"lyc-dot\" />\n        <span className=\"lyc-dot\" />"
assert s.count(a) == 1
b = "        <span className=\"h-2 w-2 animate-bounce rounded-full\" />\n" * 3
s = s.replace(a, b.rstrip("\n"), 1)'

plant "UI56-T4" "the thinking sentence comes back beside the dots" \
  "$T56" \
  "client/src/components/tutor/TutorThreadParts.tsx" \
  'a = "        <span className=\"lyc-dot\" />\n      </span>"
assert s.count(a) == 1
s = s.replace(a, "        <span className=\"lyc-dot\" />\n        LISA is thinking...\n      </span>", 1)'

plant "UI56-M1" "reduced motion keeps the pulse" \
  "$T56" \
  "client/src/styles/student-tokens.css" \
  'a = "  .lyc-dot {\n    animation: none;\n    opacity: 0.6;"
assert s.count(a) == 1
s = s.replace(a, "  .lyc-dot {\n    animation: lyc-dot 1.2s infinite ease-in-out;\n    opacity: 0.6;", 1)'

plant "UI56-D1" "the disclaimer is the old two-sentence copy" \
  "$T56" \
  "client/src/components/tutor/TutorThreadParts.tsx" \
  'a = "  \"LISA can make mistakes; your practice results are the source of truth.\";"
assert s.count(a) == 1
s = s.replace(a, "  \"LISA can make mistakes. Your practice results are the source of truth.\";", 1)'

plant "UI56-D2" "the composer placeholder is the old one" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "export const LISA_COMPOSER_PLACEHOLDER = \"Ask LISA about a question or a skill\";"
assert s.count(a) == 1
s = s.replace(a, "export const LISA_COMPOSER_PLACEHOLDER = \"Message LISA...\";", 1)'

plant "UI56-H1" "Show older does not send the server's cursor" \
  "$T56" \
  "client/src/hooks/tutor-client.ts" \
  'a = "      if (pageParam) params.set(\"cursor\", pageParam);\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "UI56-H2" "history filtered to active sessions again (OQ-39 (f))" \
  "$T56" \
  "client/src/hooks/tutor-client.ts" \
  'a = "new URLSearchParams({ surface: \"standalone\" })"
assert s.count(a) == 1
s = s.replace(a, "new URLSearchParams({ surface: \"standalone\", status: \"active\" })", 1)'

plant "UI56-H3" "Show older never drawn" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "      {hasMore ? ("
assert s.count(a) == 1
s = s.replace(a, "      {false ? (", 1)'

plant "UI56-N1" "New session creates but does not open the new column" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "    createThen((id) => navigateToConversation(id));"
assert s.count(a) == 1
s = s.replace(a, "    createThen(() => undefined);", 1)'

plant "UI56-F1" "a first message with no conversation open is never sent" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "    void send(queued.text);"
assert s.count(a) == 1
s = s.replace(a, "    void queued.text;", 1)'

plant "UI56-E1" "an ended conversation keeps its composer" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "      ) : isEnded ? null : ("
assert s.count(a) == 1
s = s.replace(a, "      ) : false ? null : (", 1)'

plant "UI56-P1" "the page logs the student's message" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "    if (!text) return;\n    setDraft(\"\");"
assert s.count(a) == 1
s = s.replace(a, "    if (!text) return;\n    console.info(\"lisa send\", text);\n    setDraft(\"\");", 1)'

plant "UI56-L1" "the map is ignored: a locked student gets the conversation (and its tutor requests)" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "  if (tutor?.access === \"locked\") return <LisaLocked reason={tutor.reason} />;"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "UI56-L2" "the lock reason is ignored: under 13 gets the plan pitch" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "  if (tutor?.access === \"locked\") return <LisaLocked reason={tutor.reason} />;"
assert s.count(a) == 1
s = s.replace(a, "  if (tutor?.access === \"locked\") return <LisaLocked reason=\"plan\" />;", 1)'

plant "UI56-L3" "Unlock LISA opens the age message instead of the plans modal" \
  "$T56 tests/ci/feedback-ux.contract.test.ts" \
  "client/src/pages/chat.tsx" \
  'a = "upgrade.open(\"tutor_access\", \"plan\")"
assert s.count(a) == 1
s = s.replace(a, "upgrade.open(\"tutor_access\", \"age\")", 1)'

plant "UI56-L4" "the age card shows the plan body" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "  const copy = UPGRADE_MODAL_COPY.tutor_access[reason];"
assert s.count(a) == 1
s = s.replace(a, "  const copy = UPGRADE_MODAL_COPY.tutor_access.plan;", 1)'

plant "UI56-L5" "the age card offers Unlock LISA" \
  "$T56" \
  "client/src/pages/chat.tsx" \
  'a = "        {reason === \"plan\" ? ("
assert s.count(a) == 1
s = s.replace(a, "        {true ? (", 1)'

plant "UI56-W1" "a server refusal no longer draws the locked state (W4-11)" \
  "client/src/pages/chat.upgrade.contract.test.tsx tests/ci/feedback-ux.contract.test.ts" \
  "client/src/pages/chat.tsx" \
  'a = "  if (denied) return <LisaLocked reason=\"plan\" />;"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

# ── UI-57: Mastery (client/src/pages/mastery.test.tsx) ─────────────────────────────────

T57="client/src/pages/mastery.test.tsx"

plant "UI57-TL1" "/mastery put back on the light lock" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "  \"/mastery\": app(null, false, \"column\", null),"
assert s.count(a) == 1
s = s.replace(a, "  \"/mastery\": app(null, false),", 1)'

plant "UI57-O1" "sections drawn Reading & Writing first" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "const SECTIONS: readonly MasterySection[] = [\"M\", \"RW\"];"
assert s.count(a) == 1
s = s.replace(a, "const SECTIONS: readonly MasterySection[] = [\"RW\", \"M\"];", 1)'

plant "UI57-O2" "only served domains drawn (a domain with no row disappears)" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "{canonicalDomainNodes(served, [section]).map((node) => {"
assert s.count(a) == 1
s = s.replace(a, "{served.filter((d) => d.section === section).map((node) => {", 1)'

plant "UI57-L1" "a domain row shows a level the server did not send" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "        label={node.domain}\n        levelKey={node.levelKey}"
assert s.count(a) == 1
s = s.replace(a, "        label={node.domain}\n        levelKey={node.levelKey === \"unmeasured\" ? \"L0\" : node.levelKey}", 1)'

plant "UI57-L2" "a skill row shows a level the server did not send" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "          levelKey={skill.levelKey}"
assert s.count(a) == 1
s = s.replace(a, "          levelKey={skill.levelKey === \"unmeasured\" ? \"L0\" : skill.levelKey}", 1)'

plant "UI57-S1" "a domain lists every skill, not its own" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "  const rows = skillsForDomain(skills, section, domain);"
assert s.count(a) == 1
s = s.replace(a, "  const rows = [...skills];", 1)'

plant "UI57-P1" "a percentage beside each domain name" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "        label={node.domain}\n"
assert s.count(a) == 1
s = s.replace(a, "        label={`${node.domain} ${(node.level ?? 0) * 25}%`}\n", 1)'

plant "UI57-F1" "free asks for mastery anyway" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "  const enabled = access === \"granted\" && studentId.length > 0;"
assert s.count(a) == 1
s = s.replace(a, "  const enabled = studentId.length > 0;", 1)'

plant "UI57-F2" "the locked card opens the wrong feature's modal" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "upgrade.open(\"mastery_detail\", lockReason)"
assert s.count(a) == 1
s = s.replace(a, "upgrade.open(\"calendar_access\", lockReason)", 1)'

plant "UI57-W1" "a server 402 no longer draws the locked state" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "  const denied =\n    isMasteryDenial(domains.error) || isMasteryDenial(skills.error);"
assert s.count(a) == 1
s = s.replace(a, "  const denied = false;", 1)'

plant "UI57-C1" "the grid call to action shows whatever is measured" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "        {allUnmeasured ? ("
assert s.count(a) == 1
s = s.replace(a, "        {true ? (", 1)'

plant "UI57-E1" "an empty catalogue renders as an empty list" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "  if (rows.length === 0) {"
assert s.count(a) == 1
s = s.replace(a, "  if (false) {", 1)'

plant "UI57-E2" "a failed domains read shows the skeleton, not the notice" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "  } else if (domains.isError) {"
assert s.count(a) == 1
s = s.replace(a, "  } else if (false) {", 1)'

plant "UI57-B1" "the in-body Back button comes back" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "        title=\"Your mastery\"\n"
assert s.count(a) == 1
s = s.replace(a, "        title=\"Your mastery\"\n        actions={<Button variant=\"lyc-quiet\" onClick={() => window.history.back()}>Back</Button>}\n", 1)'

plant "UI57-D1" "the domain row never reports itself open" \
  "$T57 client/src/components/mastery/MasteryRow.test.tsx" \
  "client/src/components/mastery/MasteryRow.tsx" \
  'a = "        aria-expanded={disclosure.expanded}"
assert s.count(a) == 1
s = s.replace(a, "        aria-expanded={false}", 1)'

plant "UI57-D2" "the chevron does not turn when the list opens" \
  "client/src/components/mastery/MasteryRow.test.tsx" \
  "client/src/components/mastery/MasteryRow.tsx" \
  'a = "${disclosure.expanded ? \"rotate-180\" : \"\"}"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "UI57-D3" "the wide pill track back to 132px (the unmeasured pill overlaps the meter)" \
  "client/src/components/mastery/MasteryRow.test.tsx" \
  "client/src/components/mastery/MasteryRow.tsx" \
  'a = "      ? \"sm:grid-cols-[minmax(0,1fr)_176px_184px]\""
assert s.count(a) == 1
s = s.replace(a, "      ? \"sm:grid-cols-[minmax(0,1fr)_176px_132px]\"", 1)'

# OQ-58 (Karl, 2026-10-05): "Practise" → "Practice". Each plant brings the British form back.
plant "UI57-SP1" "the grid call to action back to 'Start practising'" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "<Link href=\"/practice\">Start practicing</Link>"
assert s.count(a) == 1
s = s.replace(a, "<Link href=\"/practice\">Start practising</Link>", 1)'

plant "UI57-SP2" "the opened domain's call to action back to 'Practise <domain>'" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "<Link href=\"/practice\">Practice {domain}</Link>"
assert s.count(a) == 1
s = s.replace(a, "<Link href=\"/practice\">Practise {domain}</Link>", 1)'

plant "UI57-SP3" "the British form anywhere else on the page (the absence assertion)" \
  "$T57" \
  "client/src/pages/mastery.tsx" \
  'a = "Levels move as you answer more questions."
assert s.count(a) == 1
s = s.replace(a, "Levels move as you keep practising.", 1)'

# ── UI-58: Settings, Help, Notifications, the plans page ──────────────────────────────────
# @spec [student-UI register UI-58; OQ-20, OQ-27, OQ-28 / F-54, OQ-26 / OQ-41, UI-S4, UI-S7 /
#        F-40, UI-S8, OQ-38, OQ-39, OQ-46, UI-44, UI-47, OQ-49] | @implemented [2026-10-03]
# Each plant edits one product line (anchors asserted unique) and must redden the named test.
# The name route's server plants live with its real-PG test (needs Postgres), not here.
T58="client/src/pages/settings.test.tsx"
H58="client/src/pages/help.test.tsx"

plant "UI58-S1" "a Notifications section comes back (OQ-27)" \
  "$T58" \
  "client/src/components/settings/settings-sections.ts" \
  'a = "  { id: \"billing\", label: \"Billing\" },\n"
assert s.count(a) == 1
s = s.replace(a, a + "  { id: \"notifications\", label: \"Notifications\" },\n", 1)'

plant "UI58-S2" "the ?tab= value is ignored" \
  "$T58" \
  "client/src/components/settings/settings-sections.ts" \
  'a = "  const tab = new URLSearchParams(search).get(\"tab\");"
assert s.count(a) == 1
s = s.replace(a, "  const tab: string | null = null;", 1)'

plant "UI58-S3" "the section is read once from the page URL, not the router (UI-44 limitation back)" \
  "$T58" \
  "client/src/pages/settings.tsx" \
  'a = "  const active = sectionFromSearch(search, viewer);"
assert s.count(a) == 1
s = s.replace(a, "  const active = sectionFromSearch(window.location.search, viewer);", 1)'

plant "UI58-P1" "OQ-20 inverted: the goal fields show without a calendar profile" \
  "$T58" \
  "client/src/components/settings/ProfileSection.tsx" \
  'a = "      {goal === null ? ("
assert s.count(a) == 1
s = s.replace(a, "      {goal !== null ? (", 1)'

plant "UI58-P2" "the goal save sends an unchanged test date too" \
  "$T58" \
  "client/src/components/settings/ProfileSection.tsx" \
  'a = "    if (nextDate !== goal.target_exam_date)\n"
assert s.count(a) == 1
s = s.replace(a, "    if (true)\n", 1)'

plant "UI58-P3" "the name save carries marketingOptIn (F-54)" \
  "$T58" \
  "client/src/lib/settings-api.ts" \
  'a = "  const body = profileNameUpdateRequestSchema.parse({ displayName });"
assert s.count(a) == 1
s = s.replace(a, "  const body = { displayName, marketingOptIn: false };", 1)'

plant "UI58-P4" "the name save goes to the onboarding route" \
  "$T58" \
  "client/src/lib/settings-api.ts" \
  'a = "export const PROFILE_NAME_PATH = \"/api/profile/name\" as const;"
assert s.count(a) == 1
s = s.replace(a, "export const PROFILE_NAME_PATH = \"/api/profile\" as const;", 1)'

plant "UI58-P5" "About you renders while UI-S8 holds" \
  "$T58" \
  "client/src/components/settings/ProfileSection.tsx" \
  'a = "      <SectionHeading id={headingId}>Profile</SectionHeading>"
assert s.count(a) == 1
s = s.replace(a, a + "\n      <h3>About you</h3>", 1)'

plant "UI58-A1" "Change password shows only for hasPassword true (null hidden, OQ-41)" \
  "$T58" \
  "client/src/hooks/useProfileQuery.ts" \
  'a = "  return hasPassword !== false;"
assert s.count(a) == 1
s = s.replace(a, "  return hasPassword === true;", 1)'

plant "UI58-A2" "Change password shows for a Google-only account (F-38)" \
  "$T58" \
  "client/src/hooks/useProfileQuery.ts" \
  'a = "  return hasPassword !== false;"
assert s.count(a) == 1
s = s.replace(a, "  return true;", 1)'

plant "UI58-A3" "the change is sent without the current password" \
  "$T58" \
  "client/src/lib/settings-api.ts" \
  'a = "  const body = changePasswordRequestSchema.parse(input);"
assert s.count(a) == 1
s = s.replace(a, "  const body = { new_password: input.new_password };", 1)'

plant "UI58-A4" "Update password is enabled with no current password" \
  "$T58" \
  "client/src/components/settings/AccountSection.tsx" \
  'a = "          disabled={mutation.isPending || current.length === 0}"
assert s.count(a) == 1
s = s.replace(a, "          disabled={mutation.isPending}", 1)'

plant "UI58-A5" "a server-worded refusal shows generic copy" \
  "$T58" \
  "client/src/lib/settings-api.ts" \
  'a = "  if (isApiError(error) && error.code && SERVER_WORDED_CODES.has(error.code)) {"
assert s.count(a) == 1
s = s.replace(a, "  if (false) {", 1)'

plant "UI58-A6" "the Delete account box confirms without the typed phrase" \
  "$T58" \
  "client/src/components/account-deletion/DeleteAccountCard.tsx" \
  'a = "  const confirmed = isConfirmed(confirmText);\n  return (\n"
assert s.count(a) == 1
s = s.replace(a, "  const confirmed = confirmText.length >= 0;\n  return (\n", 1)'

plant "UI58-B1" "a guardian-managed plan shows Manage billing (F-40)" \
  "$T58" \
  "client/src/components/settings/BillingSection.tsx" \
  'a = "  if (status.managedBy === \"guardian\") return \"guardian\";"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "UI58-B2" "a free student is shown the self-paid state" \
  "$T58" \
  "client/src/components/settings/BillingSection.tsx" \
  'a = "  if (status.effectiveAccess || status.needsPaymentUpdate) return \"self\";"
assert s.count(a) == 1
s = s.replace(a, "  return \"self\";", 1)'

plant "UI58-B3" "Manage billing never asks the portal route" \
  "$T58" \
  "client/src/components/settings/BillingSection.tsx" \
  'a = "          onClick={() => portal.open()}"
assert s.count(a) == 1
s = s.replace(a, "          onClick={() => undefined}", 1)'

# OQ-61 (e): the free box shows the approved Help FAQ wording from `@/lib/plan-copy`. Each plant
# puts one line back to the Settings prototype's variant, the drift the shared constants prevent.
plant "UI58-B4" "the Billing free box's free line drifts from the approved wording" \
  "$T58" \
  "client/src/components/settings/BillingSection.tsx" \
  'a = "        {PLAN_FREE_INCLUDES}\n"
assert s.count(a) == 1
s = s.replace(a, "        The diagnostic, your projected score, 40 practice questions a day and unlimited review.\n", 1)'

plant "UI58-B5" "the Billing free box's paid line drifts from the approved wording" \
  "$T58" \
  "client/src/components/settings/BillingSection.tsx" \
  'a = "        {PLAN_PAID_ADDS}\n"
assert s.count(a) == 1
s = s.replace(a, "        Paid plans add a study calendar, mastery for every domain and skill, full-length tests and LISA.\n", 1)'

plant "UI58-G1" "the guardian sentence goes back to the pre-ruling words (OQ-38)" \
  "$T58 $H58" \
  "client/src/components/settings/LinkSection.tsx" \
  'a = "\"A guardian can see your progress: mastery, test scores, your study plan and your projected score. They never see your answers or your conversations with LISA.\""
assert s.count(a) == 1
s = s.replace(a, "\"A guardian can see your mastery and your test scores. They never see your answers or your conversations with LISA.\"", 1)'

plant "UI58-G2" "no link reads as 'Your guardians'" \
  "$T58" \
  "client/src/components/student/StudentGuardiansPanel.tsx" \
  'a = "{noneLinked ? \"No guardian linked\" : \"Your guardians\"}"
assert s.count(a) == 1
s = s.replace(a, "{\"Your guardians\"}", 1)'

plant "UI58-G3" "Get a new code never asks the regenerate route" \
  "$T58 client/src/components/student" \
  "client/src/components/student/StudentLinkCodePanel.tsx" \
  'a = "              onClick={() => regenerate.mutate()}"
assert s.count(a) == 1
s = s.replace(a, "              onClick={() => undefined}", 1)'

plant "UI58-T1" "the theme choice is not saved on the device" \
  "$T58" \
  "client/src/components/settings/AppearanceSection.tsx" \
  'a = "    saveThemePreference(deviceStorage(), next);\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "UI58-T2" "the theme choice is not applied to the page" \
  "$T58" \
  "client/src/components/settings/AppearanceSection.tsx" \
  'a = "      resolveTheme(next, systemPrefersDark(window)),"
assert s.count(a) == 1
s = s.replace(a, "      \"light\",", 1)'

plant "UI58-T3" "the timed module follows the dark choice" \
  "$T58" \
  "client/src/lib/route-shells.ts" \
  'a = "    themeLock: timed ? \"light\" : themeLock,"
assert s.count(a) == 1
s = s.replace(a, "    themeLock: timed ? null : themeLock,", 1)'

plant "UI58-R1" "Settings stays pinned light (OQ-49)" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "  \"/profile\": app(null, true, \"column\", null),"
assert s.count(a) == 1
s = s.replace(a, "  \"/profile\": app(null, true),", 1)'

plant "UI58-R2" "Help loses the footer" \
  "client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "  \"/help\": app(null, true, \"column\", null),"
assert s.count(a) == 1
s = s.replace(a, "  \"/help\": app(null, false, \"column\", null),", 1)'

plant "UI58-H1" "HELP_PATH back on the legal hub (OQ-46)" \
  "$H58" \
  "client/src/components/layout/LegalFooter.tsx" \
  'a = "export const HELP_PATH = \"/help\";"
assert s.count(a) == 1
s = s.replace(a, "export const HELP_PATH = \"/legal\";", 1)'

plant "UI58-H2" "an approved answer is reworded" \
  "$H58" \
  "client/src/lib/plan-copy.ts" \
  'a = "40 practice questions a day and unlimited review."
assert s.count(a) == 1
s = s.replace(a, "40 questions a day and unlimited review.", 1)'

plant "UI58-H3" "a question is dropped (six, not seven)" \
  "$H58" \
  "client/src/pages/help.tsx" \
  'a = "    q: \"How do I delete my account?\","
assert s.count(a) == 1
i = s.index(a)
start = s.rindex("  {\n", 0, i)
end = s.index("  },\n", i) + len("  },\n")
s = s[:start] + s[end:]'

plant "UI58-H4" "Contact support leaves the support address" \
  "$H58" \
  "client/src/pages/help.tsx" \
  'a = "          href={`mailto:${SUPPORT_EMAIL}`}"
assert s.count(a) == 1
s = s.replace(a, "          href=\"/legal\"", 1)'

plant "UI58-H5" "Trust and Safety points at /trust (OQ-39 a)" \
  "$H58" \
  "client/src/pages/help.tsx" \
  'a = "  { label: \"Trust and Safety\", href: \"/legal/trust-and-safety\" },"
assert s.count(a) == 1
s = s.replace(a, "  { label: \"Trust and Safety\", href: \"/trust\" },", 1)'

plant "UI58-H6" "every question starts closed" \
  "$H58" \
  "client/src/pages/help.tsx" \
  'a = "  const [open, setOpen] = useState<number>(0);"
assert s.count(a) == 1
s = s.replace(a, "  const [open, setOpen] = useState<number>(-1);", 1)'

plant "UI58-U1" "the plans page's in-body back link returns (UI-41)" \
  "client/src/pages/upgrade.page.test.tsx" \
  "client/src/pages/upgrade.tsx" \
  'a = "      <PageHeader\n        eyebrow=\"Membership\""
assert s.count(a) == 1
s = s.replace(a, "      <a href=\"/dashboard\">Back to Dashboard</a>\n" + a, 1)'

plant "UI58-U2" "every plan button is filled (DESIGN.md §1 one primary)" \
  "client/src/pages/upgrade.page.test.tsx" \
  "client/src/pages/upgrade.tsx" \
  'a = "                variant={isBestValue ? \"lyc-primary\" : \"lyc-outline\"}"
assert s.count(a) == 1
s = s.replace(a, "                variant=\"lyc-primary\"", 1)'

# OQ-59 (h) (Karl, 2026-10-05): /upgrade's plan copy is the Help FAQ's free/paid wording, from one
# source (client/src/lib/plan-copy.ts); the projection reads as free.
plant "UI58-U3" "the shipped 'One secure checkout flow' description comes back" \
  "client/src/pages/upgrade.page.test.tsx" \
  "client/src/pages/upgrade.tsx" \
  'a = "        description={PLAN_PAID_ADDS}"
assert s.count(a) == 1
s = s.replace(a, "        description=\"One secure checkout flow for monthly, quarterly, and yearly subscriptions.\"", 1)'

plant "UI58-U4" "the free line replaced by the shipped 'projection access' bullet" \
  "client/src/pages/upgrade.page.test.tsx" \
  "client/src/pages/upgrade.tsx" \
  'a = "        {PLAN_FREE_INCLUDES}"
assert s.count(a) == 1
s = s.replace(a, "        Full KPI + mastery + projection access", 1)'

plant "UI58-U5" "a card lists the projection as paid again" \
  "client/src/pages/upgrade.page.test.tsx" \
  "client/src/pages/upgrade.tsx" \
  'a = "                {plan.intervalLabel}\n"
assert s.count(a) == 1
s = s.replace(a, "                {plan.intervalLabel} · Full KPI + mastery + projection access\n", 1)'

plant "UI58-U6" "the shared free sentence drops the projection" \
  "client/src/pages/upgrade.page.test.tsx client/src/pages/help.test.tsx" \
  "client/src/lib/plan-copy.ts" \
  'a = "the diagnostic, your projected score, 40 practice"
assert s.count(a) == 1
s = s.replace(a, "the diagnostic, 40 practice", 1)'

plant "UI58-U7" "the Help FAQ drifts from the shared plan copy" \
  "client/src/pages/upgrade.page.test.tsx" \
  "client/src/pages/help.tsx" \
  'a = "    a: `${PLAN_FREE_INCLUDES} ${PLAN_PAID_ADDS}`,"
assert s.count(a) == 1
s = s.replace(a, "    a: `${PLAN_FREE_INCLUDES} Paid plans add more.`,", 1)'

plant "UI58-N1" "a notification's time drops to 12px" \
  "client/src/pages/notifications.test.tsx" \
  "client/src/pages/notifications.tsx" \
  'a = "            className=\"whitespace-nowrap text-lyc-body text-lyc-muted\""
assert s.count(a) == 1
s = s.replace(a, "            className=\"whitespace-nowrap text-xs text-lyc-muted\"", 1)'

# ── UI-59 — the bare-card pages on the student tokens ─────────────────────────────────
# @spec [student-UI register UI-59, UI-3A; DESIGN.md §1, §2 "Bare card"] | @implemented [2026-10-03]
# Each plant takes one bare page (or a primitive only the bare pages use in its lyc variant) off
# what bare-pages.ui59.test.tsx asserts: one Bare card following the device theme, one filled
# primary, labels / autocomplete / alert announcements kept, nothing below 14px, student tokens
# only, the 404's way home.
B59="client/src/pages/bare-pages.ui59.test.tsx"

plant "UI59-L1" "the bare routes go back on the light lock (OQ-49)" \
  "$B59 client/src/lib/route-shells.test.tsx" \
  "client/src/lib/route-shells.ts" \
  'a = "const BARE: BareShellSpec = { shell: \"bare\", themeLock: null };"
assert s.count(a) == 1
s = s.replace(a, "const BARE: BareShellSpec = { shell: \"bare\", themeLock: \"light\" };", 1)'

plant "UI59-L2" "the error screen is pinned light again" \
  "$B59" \
  "client/src/App.tsx" \
  'a = "      return (\n        <BareCard>\n          <div\n            className=\"flex flex-col items-center\"\n            data-testid=\"error-screen\""
assert s.count(a) == 1
s = s.replace(a, a.replace("<BareCard>", "<BareCard themeLock=\"light\">"), 1)'

# Re-pointed 2026-10-05 (merge of PR 1069): the screen is lazy since SEO F8, so the card now wraps
# a Suspense; the anchor follows it.
plant "UI59-L3" "the pending-deletion screen is pinned light again" \
  "$B59" \
  "client/src/App.tsx" \
  'a = "      <BareCard>\n        <Suspense fallback={null}>"
assert s.count(a) == 1
s = s.replace(a, a.replace("<BareCard>", "<BareCard themeLock=\"light\">"), 1)'

plant "UI59-E1" "the error screen's Reload Page is not the student filled action" \
  "$B59" \
  "client/src/App.tsx" \
  'a = "              variant=\"lyc-primary\"\n              onClick={() => window.location.reload()}"
assert s.count(a) == 1
s = s.replace(a, a.replace("lyc-primary", "default"), 1)'

# Re-pointed 2026-10-05 (merge of PR 1069): the 404 is the SEO page (main F6/F2, owner choice),
# so the three 404 plants guard what that page promises: its link home, its heading, and no
# developer line.
plant "UI59-N1" "the 404's way home no longer goes home" \
  "$B59" \
  "client/src/pages/not-found.tsx" \
  'a = "<Link href=\"/\" "
assert s.count(a) == 1
s = s.replace(a, "<Link href=\"/dashboard\" ", 1)'

plant "UI59-N2" "the 404's heading reverts to the developer-style 404 Page Not Found" \
  "$B59" \
  "client/src/pages/not-found.tsx" \
  'a = ">Page not found</h1>"
assert s.count(a) == 1
s = s.replace(a, ">404 Page Not Found</h1>", 1)'

plant "UI59-N3" "the developer line returns to the 404" \
  "$B59" \
  "client/src/pages/not-found.tsx" \
  'a = "            Sorry, we couldn"
assert s.count(a) == 1
s = s.replace(a, "            Did you forget to add the page to the router? Sorry, we couldn", 1)'

plant "UI59-A1" "Continue with Google is filled (two primaries on sign in)" \
  "$B59" \
  "client/src/components/auth/SupabaseAuthForm.tsx" \
  'a = "              variant=\"lyc-outline\"\n              className=\"w-full\"\n              onClick={handleGoogleSignIn}"
assert s.count(a) == 1
s = s.replace(a, a.replace("lyc-outline", "lyc-primary"), 1)'

plant "UI59-A2" "the sign-in email loses autocomplete=email" \
  "$B59" \
  "client/src/components/auth/SupabaseAuthForm.tsx" \
  'a = "                      data-testid=\"input-signin-email\"\n                      type=\"email\"\n                      autoComplete=\"email\""
assert s.count(a) == 1
s = s.replace(a, a.replace("autoComplete=\"email\"", "autoComplete=\"off\""), 1)'

plant "UI59-A3" "the sign-up name loses autocomplete=name" \
  "$B59" \
  "client/src/components/auth/SupabaseAuthForm.tsx" \
  'a = "                      autoComplete=\"name\""
assert s.count(a) == 1
s = s.replace(a, "                      autoComplete=\"off\"", 1)'

plant "UI59-A4" "the AS-3 redirect error is no longer an alert" \
  "$B59" \
  "client/src/pages/login.tsx" \
  'a = "          tone=\"danger\""
assert s.count(a) == 1
s = s.replace(a, "          tone=\"warning\"", 1)'

plant "UI59-A5" "the password rules drop to 12px" \
  "$B59" \
  "client/src/components/auth/PasswordField.tsx" \
  'a = "className=\"m-0 flex list-none flex-col gap-1 p-0 text-lyc-meta-lg\""
assert s.count(a) == 1
s = s.replace(a, "className=\"m-0 flex list-none flex-col gap-1 p-0 text-xs\"", 1)'

plant "UI59-A6" "the show/hide toggle leaves the student tokens" \
  "$B59" \
  "client/src/components/auth/PasswordField.tsx" \
  'a = "rounded-md text-lyc-muted hover:bg-lyc-hover"
assert s.count(a) == 1
s = s.replace(a, "rounded-md text-muted-foreground hover:bg-lyc-hover", 1)'

plant "UI59-P1" "the lyc input's placeholder leaves the student tokens" \
  "$B59" \
  "client/src/components/ui/input.tsx" \
  'a = "flex placeholder:text-lyc-muted"
assert s.count(a) == 1
s = s.replace(a, "flex placeholder:text-muted-foreground", 1)'

plant "UI59-P2" "the lyc checkbox leaves the student tokens" \
  "$B59" \
  "client/src/components/ui/checkbox.tsx" \
  'a = "h-5 w-5 rounded-sm border border-lyc-ink-strong"
assert s.count(a) == 1
s = s.replace(a, "h-5 w-5 rounded-sm border border-primary", 1)'

plant "UI59-P3" "the lyc select list portals without its .lyc root" \
  "$B59" \
  "client/src/components/ui/select.tsx" \
  'a = "  lyc: \"lyc rounded-md border border-lyc-rule bg-lyc-sheet text-lyc-ink\","
assert s.count(a) == 1
s = s.replace(a, "  lyc: \"rounded-md border border-lyc-rule bg-lyc-sheet text-lyc-ink\",", 1)'

plant "UI59-C1" "the role list falls back to the default select" \
  "$B59" \
  "client/src/pages/profile-complete.tsx" \
  'a = "<SelectContent variant=\"lyc\">"
assert s.count(a) == 1
s = s.replace(a, "<SelectContent>", 1)'

plant "UI59-C2" "a profile validation error is no longer an alert" \
  "$B59" \
  "client/src/pages/profile-complete.tsx" \
  'a = "            tone=\"danger\""
assert s.count(a) == 1
s = s.replace(a, "            tone=\"neutral\"", 1)'

plant "UI59-C3" "the date of birth loses autocomplete=bday" \
  "$B59" \
  "client/src/pages/profile-complete.tsx" \
  'a = "autoComplete=\"bday\""
assert s.count(a) == 1
s = s.replace(a, "autoComplete=\"off\"", 1)'

plant "UI59-U1" "the update-password refusal is no longer an alert" \
  "$B59" \
  "client/src/pages/update-password.tsx" \
  'a = "{error && <Notice tone=\"danger\" title={error} />}"
assert s.count(a) == 1
s = s.replace(a, "{error && <Notice tone=\"info\" title={error} />}", 1)'

plant "UI59-R1" "the recovered Sign in is not filled" \
  "$B59" \
  "client/src/pages/account-recover.tsx" \
  'a = "              variant: \"lyc-primary\","
assert s.count(a) == 1
s = s.replace(a, "              variant: \"lyc-outline\",", 1)'

plant "UI59-R2" "a raw hex colour on the recovery page" \
  "$B59" \
  "client/src/pages/account-recover.tsx" \
  'a = "const BODY = \"m-0 text-lyc-body text-lyc-ink\";"
assert s.count(a) == 1
s = s.replace(a, "const BODY = \"m-0 text-lyc-body text-[#1f2a33]\";", 1)'

plant "UI59-G1" "guardian-required's Sign out is filled" \
  "$B59" \
  "client/src/pages/guardian-required.tsx" \
  'a = "        variant=\"lyc-outline\""
assert s.count(a) == 1
s = s.replace(a, "        variant=\"lyc-primary\"", 1)'

plant "UI59-G2" "guardian-required's footnote leaves the student tokens" \
  "$B59" \
  "client/src/pages/guardian-required.tsx" \
  'a = "<p className=\"m-0 text-lyc-body text-lyc-muted\">"
assert s.count(a) == 1
s = s.replace(a, "<p className=\"m-0 text-sm text-muted-foreground\">", 1)'

plant "UI59-D1" "the pending-deletion Sign out is filled" \
  "$B59" \
  "client/src/components/account-deletion/PendingDeletionScreen.tsx" \
  'a = "          variant=\"lyc-quiet\""
assert s.count(a) == 1
s = s.replace(a, "          variant=\"lyc-primary\"", 1)'

plant "UI59-D2" "the pending-deletion screen draws its own full-screen frame" \
  "$B59" \
  "client/src/components/account-deletion/PendingDeletionScreen.tsx" \
  'a = "<div className=\"flex flex-col gap-6\" data-testid=\"pending-deletion\">"
assert s.count(a) == 1
s = s.replace(a, "<div className=\"flex min-h-screen flex-col gap-6\" data-testid=\"pending-deletion\">", 1)'

plant "UI59-D3" "the pending-deletion heading is not an H1" \
  "$B59" \
  "client/src/components/account-deletion/PendingDeletionScreen.tsx" \
  'a = "<BareCardHeader title=\"Your account is scheduled for deletion\" />"
assert s.count(a) == 1
s = s.replace(a, "<h2>Your account is scheduled for deletion</h2>", 1)'

# OQ-60 (e) (Karl, 2026-10-05): RequireRole's loader follows the device theme on Bare routes.
L60="client/src/components/auth/RequireRole.loader-theme.test.tsx"

plant "UI59-RL1" "the route guard's loader pinned light on every route again" \
  "$L60" \
  "client/src/components/auth/RequireRole.tsx" \
  'a = "    return requireRoleLoaderThemeLock(location) === \"light\" ? ("
assert s.count(a) == 1
s = s.replace(a, "    return true ? (", 1)'

plant "UI59-RL2" "the loader unlocks on every table route, not only the Bare ones" \
  "$L60" \
  "client/src/lib/route-shells.ts" \
  'a = "  return spec?.shell === \"bare\" ? spec.themeLock : \"light\";"
assert s.count(a) == 1
s = s.replace(a, "  return spec !== undefined ? spec.themeLock : \"light\";", 1)'

# OQ-60 (f) (Karl, 2026-10-05): tighter paragraph leading inside the Bare card only.
plant "UI59-CL1" "the card's paragraphs fall back to the global 1.75 leading" \
  "$B59" \
  "client/src/components/layout/BareCardShell.tsx" \
  'a = "          BARE_CARD_PROSE_LEADING,\n"
assert s.count(a) == 1
s = s.replace(a, "          undefined,\n", 1)'

plant "UI59-CL2" "the card leading at class specificity (it would override a meta line's own)" \
  "$B59" \
  "client/src/components/layout/BareCardShell.tsx" \
  'a = "\"[:where(&)_p]:leading-[1.55]\""
assert s.count(a) == 1
s = s.replace(a, "\"[&_p]:leading-[1.55]\"", 1)'

# ── F-69 — nothing positioned escapes the Focus shell's scroll area (2026-10-05) ─────────
# Owner ruling (Karl, 2026-10-05): fix in the shared Focus shell. The browser measurement
# (document vs viewport at 390x844) is the student harness's `expectFitsViewport`
# (docs/plans/student-ui/evidence/wave5/F-69.md); these pin the two classes it depends on.
plant "F69-S1" "the Focus shell's <main> is no longer a containing block" \
  "client/src/components/layout/FocusShell.test.tsx" \
  "client/src/components/layout/FocusShell.tsx" \
  'a = "className=\"relative min-h-0 flex-1 overflow-y-auto\""
assert s.count(a) == 1
s = s.replace(a, "className=\"min-h-0 flex-1 overflow-y-auto\"", 1)'

plant "F69-R1" "the choice's sr-only letter escapes its button" \
  "client/src/components/question-renderer.display-letters.test.tsx" \
  "client/src/components/question-renderer.tsx" \
  'a = "\"relative flex w-full items-center gap-4 rounded-lg px-5"
assert s.count(a) == 1
s = s.replace(a, "\"flex w-full items-center gap-4 rounded-lg px-5", 1)'

# ── Owner rulings (Karl, 2026-10-05): mobile tab bar, avatar menu, Full-Length naming ─────
# The later 2026-10-05 ruling (supersedes OQ-4, OQ-48 and the Full-Length part of OQ-62, and the
# earlier same-day ruling built in #1108): phone tabs Home, Review, Practice, Calendar, LISA; the
# avatar menu Settings, Help, Sign out (admins add Crisis review); Full-Length on neither phone
# surface, reached on a phone from a calendar block or Home's card; the desktop rail unchanged.
# FU-M1–M4 re-pointed from #1108's `inTabBar` flags to `TAB_BAR_KEYS` and the menu's `items`.
# The phone notice with "Continue anyway" stays, now one shared pre-start check (FU-N1–N8, FU-C1–C2,
# FU-H1–H3; OQ-63, below); every
# student-facing "Tests" label is "Full-Length" (FU-T1–T3).
T41_RAIL="client/src/components/layout/app-shell.rail.test.tsx"
T50_HOME="client/src/pages/lyceon-dashboard.test.tsx"

plant "FU-M1" "Full-Length back on the phone tab bar" \
  "$T41_RAIL" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "  \"calendar\",\n  \"lisa\",\n] as const;"
assert s.count(a) == 1
s = s.replace(a, "  \"calendar\",\n  \"full-length\",\n  \"lisa\",\n] as const;", 1)'

plant "FU-M2" "the tab bar goes back to #1108's order (Practice before Review)" \
  "$T41_RAIL" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "  \"review\",\n  \"practice\",\n"
assert s.count(a) == 1
s = s.replace(a, "  \"practice\",\n  \"review\",\n", 1)'

plant "FU-M3" "Full-Length back in the avatar menu (#1108's menu)" \
  "$T41_RAIL" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "      items={<MenuLink href={HELP_PATH} label=\"Help\" testId=\"menu-help\" />}"
assert s.count(a) == 1
s = s.replace(a, "      items={<><MenuLink href=\"/tests\" label=\"Full-Length\" testId=\"menu-full-length\" /><MenuLink href={HELP_PATH} label=\"Help\" testId=\"menu-help\" /></>}", 1)'

plant "FU-M4" "Calendar off the phone tab bar" \
  "$T41_RAIL" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "  \"practice\",\n  \"calendar\",\n"
assert s.count(a) == 1
s = s.replace(a, "  \"practice\",\n", 1)'

plant "FU-M5" "the tab bar takes the rail's order instead of its own" \
  "$T41_RAIL" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "TAB_BAR_KEYS.map(railItem);"
assert s.count(a) == 1
s = s.replace(a, "RAIL_ITEMS.filter((i) => (TAB_BAR_KEYS as readonly string[]).includes(i.key));", 1)'

plant "FU-M6" "the admin menu loses Help" \
  "$T41_RAIL" \
  "client/src/components/layout/HeaderUserMenu.tsx" \
  'a = "        {items}\n"
assert s.count(a) == 1
s = s.replace(a, "        {isAdmin ? null : items}\n", 1)'

# F-70: the avatar dropdown follows the page theme (student tokens, the shell's theme lock).
plant "F70-1" "the App shell's menu back on the app-wide tone (outside any .lyc root)" \
  "$T41_RAIL" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "      tone=\"student\"\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "F70-2" "the menu ignores the shell's light lock" \
  "$T41_RAIL" \
  "client/src/components/layout/HeaderUserMenu.tsx" \
  'a = "portalThemeLock: themeLock }"
assert s.count(a) == 1
s = s.replace(a, "portalThemeLock: null }", 1)'

plant "F70-3" "the student menu panel drawn with the app-wide light tokens" \
  "$T41_RAIL" \
  "client/src/components/layout/HeaderUserMenu.tsx" \
  'a = "    content: \"w-56 border-lyc-rule bg-lyc-sheet text-lyc-ink\","
assert s.count(a) == 1
s = s.replace(a, "    content: \"w-56 bg-background border-border\",", 1)'

plant "F70-4" "student menu items take the app-wide accent on focus" \
  "$T41_RAIL" \
  "client/src/components/layout/HeaderUserMenu.tsx" \
  'a = "  \"text-lyc-ink focus:bg-lyc-hover focus:text-lyc-ink-strong\";"
assert s.count(a) == 1
s = s.replace(a, "  \"text-lyc-ink focus:bg-accent focus:text-lyc-ink-strong\";", 1)'

# Home's "Start a full-length test" card (the ruling's item 4).
plant "HC-1" "no full-length card on the paid Home" \
  "$T50_HOME" \
  "client/src/components/home/PaidHome.tsx" \
  'a = "      <FullLengthCard />\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "HC-2" "no full-length card on the free Home" \
  "$T50_HOME" \
  "client/src/components/home/FreeHome.tsx" \
  'a = "      <FullLengthCard />\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "HC-3" "a locked card navigates instead of opening the modal" \
  "$T50_HOME" \
  "client/src/components/home/FullLengthCard.tsx" \
  'a = "        {reason === null ? ("
assert s.count(a) == 1
s = s.replace(a, "        {true ? (", 1)'

plant "HC-4" "the locked card opens the modal for the wrong feature" \
  "$T50_HOME" \
  "client/src/components/home/FullLengthCard.tsx" \
  'a = "open(\"exam_full_length\", reason)"
assert s.count(a) == 1
s = s.replace(a, "open(\"tutor_access\", reason)", 1)'

plant "HC-5" "the card links somewhere other than the Full-Length page" \
  "$T50_HOME" \
  "client/src/components/home/FullLengthCard.tsx" \
  'a = "const FULL_LENGTH_HREF = \"/tests\";"
assert s.count(a) == 1
s = s.replace(a, "const FULL_LENGTH_HREF = \"/practice\";", 1)'

plant "HC-6" "the card's link becomes a second filled primary" \
  "$T50_HOME" \
  "client/src/components/home/FullLengthCard.tsx" \
  'a = "<Button asChild variant=\"lyc-outline\" size=\"lyc\">"
assert s.count(a) == 1
s = s.replace(a, "<Button asChild variant=\"lyc-primary\" size=\"lyc\">", 1)'

plant "HC-7" "the card is hidden on a phone" \
  "$T50_HOME" \
  "client/src/components/home/FullLengthCard.tsx" \
  'a = "className=\"flex flex-col gap-4 rounded-lg border"
assert s.count(a) == 1
s = s.replace(a, "className=\"hidden lg:flex flex-col gap-4 rounded-lg border", 1)'

plant "HC-8" "the card's line drifts from the approved Full-Length subtitle" \
  "$T50_HOME" \
  "client/src/components/home/FullLengthCard.tsx" \
  'a = "and a scored report at the end.\";"
assert s.count(a) == 1
s = s.replace(a, "and a score at the end.\";", 1)'

# OQ-63 (owner ruling, Karl, 2026-10-05): "show it for every full-length start on a phone,
# including calendar-launched starts. One shared pre-start check, same \"Continue anyway\"."
# FU-N1/N2 re-pointed from the Full-Length home's page-gating notice (`held`, `setContinued`) to
# the shared check, `useFullLengthPhonePrecheck.tsx`, which every full-length start now calls.
PRECHECK="client/src/features/exam/lib/useFullLengthPhonePrecheck.tsx"

plant "FU-N1" "the shared check never asks on a phone" \
  "$T54_HOME" \
  "$PRECHECK" \
  'a = "    (): boolean => phone && !readPhoneNoticeContinued(),"
assert s.count(a) == 1
s = s.replace(a, "    (): boolean => false,", 1)'

plant "FU-N2" "the notice blocks: Continue anyway does not perform the start" \
  "$T54_HOME" \
  "$PRECHECK" \
  'a = "    proceed?.();\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "FU-N3" "the notice drifts from the ruling's words" \
  "$T54_HOME" \
  "client/src/features/exam/lib/phone-notice.ts" \
  'a = "  \"Full-length tests are built for a laptop or tablet, like test day.\";"
assert s.count(a) == 1
s = s.replace(a, "  \"Full-length tests work best on a laptop or tablet.\";", 1)'

plant "FU-T1" "the Full-Length home's title goes back to the old label" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "        title=\"Full-Length\""
assert s.count(a) == 1
s = s.replace(a, "        title=\"Full-length practice tests\"", 1)'

plant "FU-T2" "the exam load error's way out says tests" \
  "$T54_REPORT" \
  "client/src/features/exam/components/ExamStatus.tsx" \
  'a = "              Back to Full-Length"
assert s.count(a) == 1
s = s.replace(a, "              Back to tests", 1)'

plant "FU-T3" "the unscored attempt points back to Tests" \
  "$T54_REPORT" \
  "client/src/features/exam/pages/ExamReportPage.tsx" \
  'a = "You can start a new attempt from Full-Length."
assert s.count(a) == 1
s = s.replace(a, "You can start a new attempt from Tests.", 1)'

# ── Form names (owner ruling, Karl, 2026-10-05) ──────────────────────────────────────
# "Form names: display \"Full-Length Test 1/2/3\" in student UI as a display mapping only. Do
# not rename test_forms rows (forms are immutable)." Each plant drops `displayFormName` at one
# student surface, so the stored "Practice Test N" reaches the page again.
plant "FN-1" "the Full-Length home's rows show the stored form name" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "  const name = displayFormName(row.form.name);"
assert s.count(a) == 1
s = s.replace(a, "  const name = row.form.name;", 1)'

plant "FN-2" "the Full-Length home's score history shows the stored form name" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "                  {displayFormName(row.test_form_name)}"
assert s.count(a) == 1
s = s.replace(a, "                  {row.test_form_name}", 1)'

plant "FN-3" "the report top bar shows the stored form name" \
  "$T54_REPORT" \
  "client/src/features/exam/pages/ExamReportPage.tsx" \
  'a = "            {displayFormName(payload.test_form_name)} report"
assert s.count(a) == 1
s = s.replace(a, "            {payload.test_form_name} report", 1)'

plant "FN-4" "the review picker's full-length row shows the stored form name" \
  "client/src/pages/review.test.tsx client/src/lib/review-session-picker.test.ts" \
  "client/src/lib/review-session-picker.ts" \
  'a = "    return displayFormName(bag.test_form_name);"
assert s.count(a) == 1
s = s.replace(a, "    return bag.test_form_name;", 1)'

plant "FN-5" "Home's in-progress test row shows the stored form name" \
  "client/src/pages/lyceon-dashboard.test.tsx" \
  "client/src/components/home/PaidHome.tsx" \
  'a = "              title: displayFormName(f.name),"
assert s.count(a) == 1
s = s.replace(a, "              title: f.name,", 1)'

plant "FN-6" "the calendar's form picker shows the stored form name" \
  "client/src/features/calendar/components/FullLengthFields.wording.test.tsx" \
  "client/src/features/calendar/components/FullLengthFields.tsx" \
  'a = "              {displayFormName(form.name)}"
assert s.count(a) == 1
s = s.replace(a, "              {form.name}", 1)'

plant "FN-7" "the mapping forgets the seed's 'Full-Length Practice Test N' shape" \
  "packages/shared/src/__tests__/exam-form-display.test.ts $T54_HOME" \
  "packages/shared/src/exam-form-display.ts" \
  'a = "const STORED_FORM_NAME = /^(?:Full-Length )?Practice Test ([0-9]+)$/;"
assert s.count(a) == 1
s = s.replace(a, "const STORED_FORM_NAME = /^Practice Test ([0-9]+)$/;", 1)'

plant "FU-N4" "the Full-Length home's Start skips the shared check" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "        onClick={() => precheck.run(() => void start())}"
assert s.count(a) == 1
s = s.replace(a, "        onClick={() => void start()}", 1)'

plant "FU-N5" "the Full-Length home's Resume skips the shared check" \
  "$T54_HOME" \
  "client/src/features/exam/pages/TestsHomePage.tsx" \
  'a = "          onClick={precheck.onLinkClick(href)}\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

plant "FU-N6" "closing the notice performs the start anyway" \
  "$T54_HOME" \
  "$PRECHECK" \
  'a = "    if (next) return;\n    held.current = null;"
assert s.count(a) == 1
s = s.replace(a, "    if (next) return;\n    held.current?.();\n    held.current = null;", 1)'

plant "FU-N7" "Continue anyway is not remembered for the tab" \
  "$T54_HOME" \
  "$PRECHECK" \
  'a = "    rememberPhoneNoticeContinued();\n    const proceed"
assert s.count(a) == 1
s = s.replace(a, "    const proceed", 1)'

plant "FU-N8" "the exam session page asks the check itself" \
  "$T54_HOME" \
  "client/src/features/exam/pages/ExamSessionPage.tsx" \
  'i = s.index("\nimport ") + 1
s = s[:i] + "import { useFullLengthPhonePrecheck } from \"../lib/useFullLengthPhonePrecheck\";\nvoid useFullLengthPhonePrecheck;\n" + s[i:]'

plant "FU-C1" "a calendar full-length block launches without the check" \
  "$T55" \
  "client/src/pages/calendar.tsx" \
  'a = "            blockType === \"full_length\"\n              ? precheck.run("
assert s.count(a) == 1
s = s.replace(a, "            false\n              ? precheck.run(", 1)'

plant "FU-C2" "every calendar block asks the check (practice too)" \
  "$T55" \
  "client/src/pages/calendar.tsx" \
  'a = "            blockType === \"full_length\"\n              ? precheck.run("
assert s.count(a) == 1
s = s.replace(a, "            true\n              ? precheck.run(", 1)'

plant "FU-C3" "the block sheet falls back under the phone tab bar (Start untappable at 390)" \
  "$T55" \
  "client/src/features/calendar/calendar-student.css" \
  'a = ".lyceon-calendar.lyc-cal .sheet {\n  z-index: 45;"
assert s.count(a) == 1
s = s.replace(a, ".lyceon-calendar.lyc-cal .sheet {\n  z-index: 9;", 1)'

# ── Codex audit finding 2 (owner ruling, Karl, 2026-10-05: "split it"): the student calendar
# draws with calendar-student.css alone; the legacy calendar.css is the guardian's. The page test
# walks the student page's import graph, so a re-import on the page or in a shared module it
# reaches (CalendarView) turns it red. ──

plant "UI55-SPLIT1" "the student calendar page imports the legacy calendar.css again" \
  "$T55" \
  "client/src/pages/calendar.tsx" \
  'a = "import \"@/features/calendar/calendar-student.css\";\n"
assert s.count(a) == 1
s = s.replace(a, "import \"@/features/calendar/calendar.css\";\n" + a, 1)'

plant "UI55-SPLIT2" "the shared CalendarView pulls calendar.css into the student tree" \
  "$T55" \
  "client/src/features/calendar/CalendarView.tsx" \
  'a = "import { WeekGrid } from \"./components/WeekGrid\";\n"
assert s.count(a) == 1
s = s.replace(a, "import \"./calendar.css\";\n" + a, 1)'

# ── Production QA 2026-10-07 item 11 (the student calendar). (a) the month view's first render is
# the whole month: Week → Month opens today's month, and that month is read ahead in week view. ──

plant "QA11-A1" "Week → Month opens the month of the week's Monday again (September on 1 October)" \
  "$T55" \
  "client/src/features/calendar/CalendarView.tsx" \
  'a = "                next === \"month\" && view === \"week\"\n                  ? monthCursorForWeek(cursor, today)\n                  : cursor,"
assert s.count(a) == 1
s = s.replace(a, "                cursor,", 1)'

plant "QA11-A2" "week view no longer reads the month ahead (the toggle draws the held-over week)" \
  "$T55" \
  "client/src/features/calendar/api/queries.ts" \
  'a = "              : [rangeForView(\"month\", monthCursorForWeek(cursor, today))]),"
assert s.count(a) == 1
s = s.replace(a, "              : []),", 1)'

plant "FU-H1" "Home's Today's plan launches a full-length block without the check" \
  "$T50_HOME" \
  "client/src/components/home/PaidHome.tsx" \
  'a = "    if (block.block_type === \"full_length\")\n"
assert s.count(a) == 1
s = s.replace(a, "    if (false)\n", 1)'

plant "FU-H2" "Home's Pick up row for a sitting skips the check" \
  "$T50_HOME" \
  "client/src/components/home/PaidHome.tsx" \
  'a = "                ? { onClick: onFullLengthClick(row.href) }"
assert s.count(a) == 1
s = s.replace(a, "                ? {}", 1)'

plant "FU-H3" "Home's Today's plan asks the check for every block (review too)" \
  "$T50_HOME" \
  "client/src/components/home/PaidHome.tsx" \
  'a = "    if (block.block_type === \"full_length\")\n"
assert s.count(a) == 1
s = s.replace(a, "    if (true)\n", 1)'

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
