#!/usr/bin/env bash
# Doc 10B Phase 1 (blog pipeline) — mutation harness.
#
# @spec [docs/Spec/Lyceon_Doc_10B.md §2.14 ("tests with planted defects"); owner brief "Doc 10B
#       Phase 1 — blog pipeline" (Karl, 2026-10-11) "Planted defects: removing each rule turns its
#       test red"] | @implemented [2026-10-11]
#
# Each plant breaks ONE rule and must turn a NAMED test red. Same rules as the other
# *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other test is a failure.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
SCHEDULE="shared/content/schedule.ts"
BLOG="shared/content/blog.ts"
PLUGIN="vite-plugin-content-schedule.ts"
WITHHELD="scripts/content/withheld-posts.ts"
GATE="shared/seo/content-gate.ts"
JOB="server/services/content/publish-job.ts"
STAMP="scripts/content/stamp-approval.ts"
REVIEW="scripts/content/review-record.ts"
BANNED="shared/seo/banned-phrases.ts"
VALE_INI=".vale.ini"
LYCHEE="lychee.toml"
SATDATES="shared/sat-test-dates.ts"
NOTIFY="scripts/content/notify-batch.ts"
PLAN="scripts/content/plan-skeleton.ts"
ENTRY="client/src/prerender/entry-server.tsx"
CHECKPR="scripts/content/check-batch-pr.ts"
CHECKS_WF=".github/workflows/content-batch-checks.yml"
APPROVAL_WF=".github/workflows/content-batch-approval.yml"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/content-mut.XXXX)"

FILES=("$SCHEDULE" "$BLOG" "$PLUGIN" "$WITHHELD" "$GATE" "$JOB" "$STAMP" "$REVIEW" "$BANNED" "$VALE_INI" "$LYCHEE" "$SATDATES" "$NOTIFY" "$PLAN" "$ENTRY" "$CHECKPR" "$CHECKS_WF" "$APPROVAL_WF")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> — exactly one occurrence, or STALE.
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

check() { pnpm exec vitest run "$@" 2>&1; }
SCHED_T=tests/ci/content-schedule.test.ts
JOB_T=tests/ci/content-publish-job.test.ts
STAMP_T=tests/ci/content-approval-stamp.test.ts
REVIEW_T=tests/ci/content-review-record.test.ts
QG_T=tests/ci/content-quality-gates.test.ts
SAT_T=tests/ci/sat-test-dates.contract.test.ts
NOTIFY_T=tests/ci/content-batch-notify.test.ts
PLAN_T=tests/ci/content-plan.test.ts
DRAFT_T=tests/ci/content-drafts-gate.test.ts
BRANCH_T=tests/ci/content-branch.test.ts
# The Vale and lychee plants (Q8, Q9) need both tools: the quality-gates suite skips them without,
# which would read here as a plant that stayed green. Fail loudly instead.
command -v vale >/dev/null && command -v lychee >/dev/null || { echo "vale and lychee must be on PATH (.github/actions/content-tools)"; exit 1; }

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$SCHED_T" "$JOB_T" "$STAMP_T" "$REVIEW_T" "$QG_T" "$SAT_T" "$NOTIFY_T" "$PLAN_T" "$DRAFT_T" "$BRANCH_T")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "CONTENT OPS MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== (S1) an unapproved page is public ==="
plant "$SCHEDULE" "  if (!page.approved) return false;" "" || { bad "S1 STALE"; exit 1; }
run "S1 unapproved never public" "an unapproved page is never public" "$SCHED_T"

echo "=== (S2) publishAt is ignored ==="
plant "$SCHEDULE" "  return page.publishAt <= chicagoWallClock(now);" "  return true;" || { bad "S2 STALE"; exit 1; }
run "S2 future publishAt withheld" "an approved page with a future publishAt is not public" "$SCHED_T"

echo "=== (S3) a post approves itself (no merge stamp needed) ==="
plant "$BLOG" "  const approved = approvalFor(spec.batch, approvals);" '  const approved = { by: "Karl" as const, date: publishDate };' || { bad "S3 STALE"; exit 1; }
run "S3 approval only from the merge stamp" "an unstamped cycle is not" "$SCHED_T"

echo "=== (S4) the build plugin stubs nothing ==="
plant "$PLUGIN" '      return withheld.has(file) ? "export default null;\n" : null;' "      return null;" || { bad "S4 STALE"; exit 1; }
run "S4 withheld words stay out of the bundle" "ships the public post and not the withheld one" "$SCHED_T"

echo "=== (S5) a withheld post with no module of its own is shipped anyway ==="
plant "$WITHHELD" "      if (!fileExists(file)) {" "      if (false) {" || { bad "S5 STALE"; exit 1; }
run "S5 no module stops the build" "a withheld post without a module of its own stops the build" "$SCHED_T"

echo "=== (S6) a correction after publication keeps the old approval ==="
plant "$GATE" "    page.lastModified === page.publishAt.slice(0, 10);" "    true;" || { bad "S6 STALE"; exit 1; }
run "S6 correction needs a new approval" "a correction after publication needs a new approval" "$SCHED_T"

echo "=== (S7) the Chicago clock ignores the time zone ==="
plant "$SCHEDULE" '    timeZone: "America/Chicago",' '    timeZone: "UTC",' || { bad "S7 STALE"; exit 1; }
run "S7 DST-safe Chicago clock" "reads 07:00 at 12:00 UTC in summer time" "$SCHED_T"

echo "=== (P1) the publish job ignores the Chicago hour ==="
plant "$JOB" "  if (hour !== CONTENT_PUBLISH_HOUR) {" "  if (false) {" || { bad "P1 STALE"; exit 1; }
run "P1 one run a day acts" "the 13:05 UTC run is the 08:00 hour" "$JOB_T"

echo "=== (P2) an unapproved post due today triggers the build ==="
plant "$JOB" "        p.page.publishAt?.slice(0, 10) === today && isPagePublic(p.page, now)," "        p.page.publishAt?.slice(0, 10) === today," || { bad "P2 STALE"; exit 1; }
run "P2 unapproved never builds" "an unapproved post due today never triggers a build" "$JOB_T"

echo "=== (P3) the hook fires every day ==="
plant "$JOB" '    decision.action === "deploy"' "    true" || { bad "P3 STALE"; exit 1; }
run "P3 rebuild only on publish days" "exactly once on a publish day, never otherwise" "$JOB_T"

echo "=== (P4) any weekday is on cadence ==="
plant "$SCHEDULE" "  return CONTENT_PUBLISH_WEEKDAYS.includes(weekday)" "  return true" || { bad "P4 STALE"; exit 1; }
run "P4 Mon/Wed/Fri only" "another weekday or another time is refused" "$JOB_T"

echo "=== (A1) a merge by anyone stamps the approval ==="
plant "$STAMP" "  if (event.mergedBy !== approverLogin) {" "  if (false) {" || { bad "A1 STALE"; exit 1; }
run "A1 only the approver's merge" "a merge by anyone else records nothing" "$STAMP_T"

echo "=== (A2) a re-run overwrites the first stamp ==="
plant "$STAMP" "    if (next[cycle]) continue;" "" || { bad "A2 STALE"; exit 1; }
run "A2 first stamp kept" "a re-run keeps the first stamp" "$STAMP_T"

echo "=== (A3) a hand-added stamp passes the PR check ==="
plant "$STAMP" "  return a === read(before)" "  return true" || { bad "A3 STALE"; exit 1; }
run "A3 no stamps by hand" "adding, editing or removing a stamp is" "$STAMP_T"

echo "=== (R1) a ready record without Codex verdicts passes ==="
plant "$REVIEW" "  if (!ctx.ready) return problems;" "  return problems;" || { bad "R1 STALE"; exit 1; }
run "R1 ready needs the Codex section" "is blocked when the Codex section has not been written" "$REVIEW_T"

echo "=== (R2) a REVISE needs no Claude response ==="
plant "$REVIEW" '    if (verdict === "APPROVE") continue;' "    continue;" || { bad "R2 STALE"; exit 1; }
run "R2 a response to every REVISE" "is blocked when a REVISE has no Claude response" "$REVIEW_T"

echo "=== (R3) Codex may edit other sections ==="
plant "$REVIEW" "    if (withoutCodex(before) !== withoutCodex(after)) {" "    if (false) {" || { bad "R3 STALE"; exit 1; }
run "R3 Codex writes only its section" "a Codex commit that edits a post, or another section, is refused" "$REVIEW_T"

echo "=== (Q1) gate 11: a duplicate target keyword passes ==="
plant "$GATE" "    if (first !== undefined) {" "    if (false) {" || { bad "Q1 STALE"; exit 1; }
run "Q1 no duplicate targeting" "a second page targeting an owned term, in plural and capitals, is rejected" "$QG_T"

echo "=== (Q2) gate 12: an AI mention in a post passes ==="
plant "$GATE" "      const phrase = firstPipelinePhrase(text);" "      const phrase = null;" || { bad "Q2 STALE"; exit 1; }
run "Q2 no AI in posts" "an AI mention in a post is rejected" "$QG_T"

echo "=== (Q3) gate 12: LISA as a feature is no longer excepted ==="
plant "$BANNED" '  const rest = text.replace(LISA_AS_FEATURE, " ");' "  const rest = text;" || { bad "Q3 STALE"; exit 1; }
run "Q3 the LISA exception" '"LISA, your AI tutor" is the one AI mention allowed' "$QG_T"

echo "=== (Q4) gate 12: a page without the trademark notice passes ==="
plant "$GATE" "  if (!bodyTextOf(body).includes(SAT_TRADEMARK_NOTICE)) {" "  if (false) {" || { bad "Q4 STALE"; exit 1; }
run "Q4 the trademark notice" "a built page without the trademark notice is rejected" "$QG_T"

echo "=== (Q5) gate 2: an internal label passes ==="
plant "$GATE" "    const label = firstInternalLabel(text);" "    const label = null;" || { bad "Q5 STALE"; exit 1; }
run "Q5 no internal labels" "a register ID in a post is rejected" "$QG_T"

echo "=== (Q6) gate 7: a post with no practice or score link passes ==="
plant "$GATE" "      !linksOn.some((h) =>" "      false && !linksOn.some((h) =>" || { bad "Q6 STALE"; exit 1; }
run "Q6 links on to practice or score" "a post whose practice and score links are removed is rejected" "$QG_T"

echo "=== (Q7) gate 11: a post needs no target keyword ==="
plant "$GATE" "    if (page.targetKeyword === undefined) {" "    if (false) {" || { bad "Q7 STALE"; exit 1; }
run "Q7 every post has a target" "a blog post with no target keyword is rejected" "$QG_T"

echo "=== (Q8) gate 6: Vale without the ai-tells rule set ==="
plant "$VALE_INI" "BasedOnStyles = Vale, Microsoft, ai-tells" "BasedOnStyles = Vale, Microsoft" || { bad "Q8 STALE"; exit 1; }
run "Q8 Vale runs ai-tells" "Vale rejects planted AI-tell prose in a real post's export" "$QG_T"

echo "=== (Q9) gate 8: lychee accepts a 404 ==="
plant "$LYCHEE" 'accept = ["200..=299", "429"]' 'accept = ["200..=299", "404", "429"]' || { bad "Q9 STALE"; exit 1; }
run "Q9 links resolve" "lychee passes a live College Board page and rejects one that 404s" "$QG_T"

echo "=== (C1) the score release date is read from the wrong column ==="
plant "$SATDATES" "            scores_released: deadlines[2]," "            scores_released: deadlines[1]," || { bad "C1 STALE"; exit 1; }
run "C1 published dates as read" "every confirmed date carries College Board's published deadlines and score release" "$SAT_T"

echo "=== (C2) the plan's calendar runs past its month ==="
plant "$SATDATES" "    .filter((e) => e.date >= from && e.date <= to)" "    .filter((e) => e.date >= from)" || { bad "C2 STALE"; exit 1; }
run "C2 one month's events" "November 2026's calendar" "$SAT_T"

echo "=== (N1) the summary drops Codex's verdicts ==="
plant "$NOTIFY" '  if (!["APPROVE", "REVISE", "REJECT"].includes(verdict))' "  if (true)" || { bad "N1 STALE"; exit 1; }
run "N1 verdicts in the summary" "lists every post in publish order with its date, title and Codex verdict" "$NOTIFY_T"

echo "=== (N2) the summary is not in publish order ==="
plant "$NOTIFY" '        (a.page.publishAt ?? "").localeCompare(b.page.publishAt ?? ""),' "        0," || { bad "N2 STALE"; exit 1; }
run "N2 publish order" "lists every post in publish order with its date, title and Codex verdict" "$NOTIFY_T"

echo "=== (N3) a pull request without content posts ==="
plant "$NOTIFY" "  if (cycles.length === 0) {" "  if (false) {" || { bad "N3 STALE"; exit 1; }
run "N3 no content, no post" "a pull request without content posts nothing" "$NOTIFY_T"

echo "=== (W1) ISO weeks start on the wrong day ==="
plant "$SCHEDULE" "  d.setUTCDate(d.getUTCDate() + 4 - weekday); // the Thursday of this week" "  d.setUTCDate(d.getUTCDate() + 1 - weekday);" || { bad "W1 STALE"; exit 1; }
run "W1 ISO weeks" "names a date's ISO week, across year ends" "$PLAN_T"

echo "=== (W2) a post outside its batch's week passes ==="
plant "$SCHEDULE" "  return week === batch" "  return true" || { bad "W2 STALE"; exit 1; }
run "W2 batch week" "a post outside its batch's week is reported" "$PLAN_T"

echo "=== (W3) the plan counts days to a past test ==="
plant "$PLAN" "SAT_TEST_DATES.find((t) => t.date >= date)" "SAT_TEST_DATES.find((t) => t.date <= date)" || { bad "W3 STALE"; exit 1; }
run "W3 days to the next test" "has one row per slot, each with its cycle and the days to the next test" "$PLAN_T"

echo "=== (D1) a draft's data is not gated ==="
plant "$ENTRY" "    problems.push(...contentPageProblems(asMerged, ctx));" "" || { bad "D1 STALE"; exit 1; }
run "D1 draft data gated" "fails a draft with an unsourced paragraph" "$DRAFT_T"

echo "=== (D2) a draft's rendered article is not gated ==="
plant "$ENTRY" "    problems.push(...articleProblems(page.path, article, ctx));" "" || { bad "D2 STALE"; exit 1; }
run "D2 draft article gated" "fails a draft whose article links to a page that does not exist" "$DRAFT_T"

echo "=== (D3) gate 11 compares drafts only with each other ==="
plant "$ENTRY" "  const problems = duplicateTargetProblems([...byPath.values()]);" "  const problems = duplicateTargetProblems(posts);" || { bad "D3 STALE"; exit 1; }
run "D3 drafts against live pages" "fails a draft that targets a term a live page owns" "$DRAFT_T"

echo "=== (B1) a batch merged into seo is approved ==="
plant "$STAMP" "  if (event.base !== CONTENT_BRANCH) {" "  if (false) {" || { bad "B1 STALE"; exit 1; }
run "B1 approved only from social" "a merge by the approver into seo (or any base but social) records nothing" "$STAMP_T"

echo "=== (B2) a batch PR into seo passes the PR check ==="
plant "$CHECKPR" "  if (cycles.length === 0 || base === CONTENT_BRANCH) return null;" "  return null;" || { bad "B2 STALE"; exit 1; }
run "B2 PR check refuses seo" "a batch PR into seo fails; the same into social passes" "$BRANCH_T"

echo "=== (B3) the review-record check also runs on PRs into seo ==="
plant "$CHECKS_WF" "    branches: [social]" "    branches: [seo, social]" || { bad "B3 STALE"; exit 1; }
run "B3 trigger is social only" "a batch PR into social triggers the review-record check; the same into seo does not" "$BRANCH_T"

echo "=== (AP1) a push that is not the pull request's merge commit is stamped ==="
plant "$STAMP" "  if (pr.merge_commit_sha !== pushSha)" "  if (false)" || { bad "AP1 STALE"; exit 1; }
run "AP1 this push's merge only" "a push that is not that pull request's merge commit stamps nothing" "$STAMP_T"

echo "=== (AP2) the stamp is pushed with the workflow token, not the App's ==="
plant "$APPROVAL_WF" "          token: \${{ steps.app.outputs.token }}" "          token: \${{ github.token }}" || { bad "AP2 STALE"; exit 1; }
run "AP2 pushed as the App" "the stamp is pushed to social with the App token, never the workflow token" "$BRANCH_T"

echo "=== (AP3) the stamp job runs outside the Environment that guards the App key ==="
plant "$APPROVAL_WF" "    environment: content-approval" "" || { bad "AP3 STALE"; exit 1; }
run "AP3 key only in the Environment" "the approval stamp runs only on a push to social, in the Environment that holds the App key" "$BRANCH_T"

echo
echo "CONTENT OPS MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
