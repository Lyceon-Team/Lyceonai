#!/usr/bin/env bash
# ============================================================================
# Review route gate — PLANT self-test (A1-A14)
# ============================================================================
# @spec [brief R3 §4 "with every one planted"; owner ruling 2026-09-21 (A14)]
#
# A gate counts only after its plant has turned THAT SPECIFIC assertion red and
# been reverted byte-identically. This harness applies one source mutation per
# assertion, runs ONLY that assertion, and requires it to fail. A mutation that
# leaves the suite green means the assertion was not testing what it claims.
#
# It mutates PRODUCT source, never the test file. A plant in the test proves
# nothing: the test would be asserting against itself.
#
# Requires PGHOST (a Postgres service). Without it the suite skips, and a
# skipped suite exits 0 — which is why this script refuses to run without one
# rather than reporting a vacuous pass.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -z "${PGHOST:-}" ]; then
  echo "FAIL: PGHOST is not set. Every assertion would skip and this script"
  echo "      would report success for a suite that never ran."
  exit 1
fi

TEST_FILE="tests/ci/review.routes.pg.ci.test.ts"
ROUTES="server/routes/review-canonical.ts"
POOL="server/services/review-pool.ts"
SWEEP="server/lib/review-stale-session-sweep.ts"
PRACTICE="server/routes/practice-canonical.ts"
CSRF="server/middleware/csrf-double-submit.ts"
INDEX="server/index.ts"

BACKUP="$(mktemp -d)"
trap 'restore_all; rm -rf "$BACKUP"' EXIT

SOURCES=("$ROUTES" "$POOL" "$SWEEP" "$PRACTICE" "$CSRF" "$INDEX")

snapshot_all() {
  for f in "${SOURCES[@]}"; do
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp "$f" "$BACKUP/$f"
  done
}

restore_all() {
  for f in "${SOURCES[@]}"; do
    [ -f "$BACKUP/$f" ] && cp "$BACKUP/$f" "$f"
  done
}

verify_reverted() {
  for f in "${SOURCES[@]}"; do
    if ! cmp -s "$BACKUP/$f" "$f"; then
      echo "FAIL: $f was not reverted byte-identically"
      exit 1
    fi
  done
}

FAILURES=0
PASSES=0

# mutate <file> <python-literal-old> <python-literal-new>
mutate() {
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(path, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write(f"PLANT ANCHOR MISSED in {path}: found {n} occurrences\n")
    sys.exit(2)
io.open(path, "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
}

# plant <label> <test-name-filter> then the mutation is applied by the caller
run_plant() {
  local label="$1" filter="$2"
  if pnpm exec vitest run "$TEST_FILE" -t "$filter" >/tmp/plant-$label.log 2>&1; then
    echo "  GREEN  [$label] PLANT DID NOT FIRE — the assertion does not test what it claims"
    sed -n '1,25p' /tmp/plant-$label.log
    FAILURES=$((FAILURES + 1))
  else
    echo "  RED    [$label] $3"
    PASSES=$((PASSES + 1))
  fi
  restore_all
  verify_reverted
}

snapshot_all

echo "=== Review route plants (A1-A14) ==="

# --- A1: include the snapshot's answer in the next-item payload -------------
mutate "$ROUTES" \
  '    stats: await getSessionStats(args.sessionId, args.studentId),
    totalQuestions: await countSessionItems(args.sessionId),
  });
}' \
  '    stats: await getSessionStats(args.sessionId, args.studentId),
    totalQuestions: await countSessionItems(args.sessionId),
    explanation: canonicalQuestion.explanation,
  });
}' || exit 2
run_plant A1 "A1:" "leak the explanation into the next-item payload"

# --- A2: withhold the reveal ------------------------------------------------
mutate "$ROUTES" \
  '    ...answerRevealFields(canonicalQuestion, graded.correctOptionId),
    explanation: canonicalQuestion.explanation ?? null,
    feedback: graded.isCorrect ? "Correct" : "Incorrect",' \
  '    ...answerRevealFields(canonicalQuestion, null),
    explanation: null,
    feedback: graded.isCorrect ? "Correct" : "Incorrect",' || exit 2
run_plant A2 "A2:" "withhold the answer and explanation post-submit"

# --- A3: remove the CAS status guard ----------------------------------------
mutate "$ROUTES" \
  '  if (sessionItem.status !== "served") {
    if (sessionItem.outcome) {
      const replayCorrectOptionId = resolveCorrectOptionId(' \
  '  if (false) {
    if (sessionItem.outcome) {
      const replayCorrectOptionId = resolveCorrectOptionId(' || exit 2
run_plant A3 "A3:" "remove the replay status guard on answer"

# --- A4: remove the create replay scan --------------------------------------
mutate "$ROUTES" \
  '  let replay: ReviewSessionRecord | null = null;
  if (args.idempotencyKey) {' \
  '  let replay: ReviewSessionRecord | null = null;
  if (false && args.idempotencyKey) {' || exit 2
run_plant A4 "A4:" "remove the session-create idempotency replay scan"

# --- A5: drop the ownership check -------------------------------------------
mutate "$ROUTES" \
  '    .eq("id", sessionId)
    .eq("student_id", studentId)
    .maybeSingle();' \
  '    .eq("id", sessionId)
    .maybeSingle();' || exit 2
run_plant A5 "A5:" "drop the ownership predicate on session load"

# --- A6: remove the CSRF middleware from the review mount -------------------
mutate "$INDEX" \
  'app.use(
  "/api/review",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  doubleCsrfProtection,
  reviewCanonicalRouter,
);' \
  'app.use(
  "/api/review",
  requireSupabaseAuth,
  requireStudentOrAdmin,
  reviewCanonicalRouter,
);' || exit 2
run_plant A6 "A6:" "remove doubleCsrfProtection from the production review mount"

# --- A6b: disable CSRF in the middleware itself -----------------------------
# The mount assertion above is static; this one proves the RUNTIME 403 is real.
#
# NOTE the plant that did NOT work, recorded because it is informative: making
# `isSafeMethod` return true for every method left A6 green. That function gates only
# the Origin allowlist; the token check is csrf-csrf's own, and it rejected the request
# anyway. The 403 A6 sees therefore comes from the token check, and the plant has to
# disable THAT to be falsifiable.
mutate "$CSRF" \
  'function doubleCsrfProtection(req: Request, res: Response, next: NextFunction) {' \
  'function doubleCsrfProtection(req: Request, res: Response, next: NextFunction) {
  if (true) { void req; void res; return next(); }' || exit 2
run_plant A6b "A6:" "let every write through the CSRF middleware"

# --- A7: join to the raw bank instead of the servable view ------------------
mutate "$POOL" \
  '      .from("servable_questions")' \
  '      .from("questions")' || exit 2
run_plant A7 "A7:" "read the raw questions table instead of servable_questions"

# --- A8: reverse the pool order ---------------------------------------------
mutate "$POOL" \
  '    .order("queued_at", { ascending: true })
    .order("question_id", { ascending: true });' \
  '    .order("queued_at", { ascending: false })
    .order("question_id", { ascending: false });' || exit 2
run_plant A8 "A8:" "reverse the oldest-first pool ordering"

# --- A9: restrict session mode to active entries from that session ----------
mutate "$POOL" \
  '    .eq("source_engine", sourceEngine)
    .eq("source_session_id", sourceSessionId);' \
  '    .eq("source_engine", sourceEngine)
    .eq("status", "active")
    .eq("source_session_id", sourceSessionId);' || exit 2
run_plant A9 "A9:" "restrict session mode to entries still open from that session"

# --- A10: pass the attempt's client id as the mastery event id --------------
mutate "$ROUTES" \
  '    eventId: args.item.id,
    questionId: canonicalId,' \
  '    eventId: args.item.client_attempt_id ?? args.item.id,
    questionId: canonicalId,' || exit 2
run_plant A10 "A10:" "use the client attempt id as the mastery event id"

# --- A11: list every session status -----------------------------------------
mutate "$ROUTES" \
  '      .eq("student_id", studentId)
      .in("status", [...OPEN_STATUSES])
      .order("created_at", { ascending: false });

    if (error) {' \
  '      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (error) {' || exit 2
run_plant A11 "A11:" "include abandoned and completed in the open-sessions list"

# --- A12: drop the sweep status predicate -----------------------------------
mutate "$SWEEP" \
  '    .in("status", ["created", "active"])
    .lt("last_activity_at", cutoff)' \
  '    .lt("last_activity_at", cutoff)' || exit 2
run_plant A12 "A12:" "drop the status predicate from the review sweep"

# --- A13: revert practice to a private shuffle ------------------------------
mutate "$PRACTICE" '  buildServedOptions,' '  // buildServedOptions removed by plant' || exit 2
mutate "$PRACTICE" \
  '// The option shuffle moved to shared/question-bank-contract.ts on 2026-09-21' \
  'function fisherYates<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildServedOptions(options: McOption[]): {
  optionOrder: string[];
  optionTokenMap: Record<string, string>;
  safeOptions: StudentSafeOption[];
} {
  const shuffled = fisherYates(options);
  const optionOrder = shuffled.map((o) => o.key);
  const { optionTokenMap, safeOptions } = buildStudentSafeOptionTokens(
    shuffled,
    optionOrder,
  );
  return { optionOrder, optionTokenMap, safeOptions };
}

// The option shuffle moved to shared/question-bank-contract.ts on 2026-09-21' || exit 2
run_plant A13 "A13:" "give practice back its private Fisher-Yates copy"

# --- A14: rename one response field -----------------------------------------
mutate "$ROUTES" \
  '    totalQuestions: await countSessionItems(args.sessionId),' \
  '    totalItems: await countSessionItems(args.sessionId),' || exit 2
run_plant A14 "A14:" "rename totalQuestions in the next-item response"

echo ""
echo "plants fired: $PASSES   plants that did not fire: $FAILURES"
if [ "$FAILURES" -ne 0 ]; then
  echo "REVIEW ROUTE PLANT SELF-TEST: FAIL"
  exit 1
fi

echo "Re-running the unmutated suite to prove the revert was clean..."
if ! pnpm exec vitest run "$TEST_FILE" >/tmp/plant-final.log 2>&1; then
  echo "FAIL: the suite is red after revert"
  tail -40 /tmp/plant-final.log
  exit 1
fi

echo "REVIEW ROUTE PLANT SELF-TEST: PASS"
