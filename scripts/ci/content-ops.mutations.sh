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
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/content-mut.XXXX)"

FILES=("$SCHEDULE" "$BLOG" "$PLUGIN" "$WITHHELD" "$GATE" "$JOB" "$STAMP")
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
OUT="$(check "$SCHED_T" "$JOB_T" "$STAMP_T")"; RC=$?
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

echo
echo "CONTENT OPS MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
