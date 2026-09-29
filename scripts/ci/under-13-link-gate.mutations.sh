#!/usr/bin/env bash
# ============================================================================
# Under-13 link gate (G2-04) — PLANT self-test (P1-P6)
# ============================================================================
# @spec [Guardian_Closure_Plan G2-04; owner ruling R6; SCL-187 rule 1]
#       | @implemented [2026-09-29]
#
# The G2-04 suite (tests/ci/under-13-link-gate.pg.ci.test.ts) counts only if each
# assertion goes red when the property it guards is broken in PRODUCT source. This
# harness applies one mutation per property, runs only the assertion that guards it,
# requires it to fail, and restores the source byte-identically. It never mutates
# the test file: a plant in the test proves nothing.
#
# P3 is the one the owner named: "a guardian unlinks partway through a session and
# the student's very next learning request gets 403 without signing in again". Its
# plant caches the link answer per student — exactly the stored-flag design this row
# replaces — and the assertion must catch it.
#
# Requires PGHOST (a Postgres service). Without it the suite skips, and a skipped
# suite exits 0 — which is why this script refuses to run without one.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -z "${PGHOST:-}" ]; then
  echo "FAIL: PGHOST is not set. Every assertion would skip and this script"
  echo "      would report success for a suite that never ran."
  exit 1
fi

TEST_FILE="tests/ci/under-13-link-gate.pg.ci.test.ts"
AUTH="server/middleware/supabase-auth.ts"
RESOURCES="server/routes/student-resources.ts"
BILLING="server/routes/billing-routes.ts"

BACKUP="$(mktemp -d)"
SOURCES=("$AUTH" "$RESOURCES" "$BILLING")

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

trap 'restore_all; rm -rf "$BACKUP"' EXIT

FAILURES=0
PASSES=0

# mutate <file> <old> <new> — the anchor must occur exactly once.
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

# run_plant <label> <test-name-filter> <description>
run_plant() {
  local label="$1" filter="$2"
  local log
  log="$(mktemp)"
  # NO_COLOR, and colour codes stripped anyway: in CI vitest colours its summary, which split
  # "Tests  1 failed" with escape codes so the match below missed every plant that DID fire.
  if NO_COLOR=1 FORCE_COLOR=0 pnpm exec vitest run "$TEST_FILE" -t "$filter" 2>&1 \
    | sed -E 's/\x1b\[[0-9;]*m//g' >"$log"; test "${PIPESTATUS[0]}" -eq 0; then
    echo "  GREEN  [$label] PLANT DID NOT FIRE — the assertion does not test what it claims"
    sed -n '1,25p' "$log"
    FAILURES=$((FAILURES + 1))
  elif grep -qE "Tests +[0-9]+ failed|\([0-9]+ tests? \| [1-9][0-9]* failed" "$log"; then
    echo "  RED    [$label] $3"
    PASSES=$((PASSES + 1))
  else
    # Red for the wrong reason (a crash, an import error) is not a proof.
    echo "  ERROR  [$label] the run failed without a failing assertion"
    sed -n '1,40p' "$log"
    FAILURES=$((FAILURES + 1))
  fi
  rm -f "$log"
  restore_all
  verify_reverted
}

snapshot_all

echo "=== Under-13 link gate plants (P1-P6) ==="

# --- P1: the gate never reads the link (always passes) ----------------------
mutate "$AUTH" \
  '    linked = await hasActiveGuardianLink(supabaseServer, user.id);' \
  '    linked = true || (await hasActiveGuardianLink(supabaseServer, user.id));' || exit 2
run_plant P1 "under-13, unlinked" "an unlinked under-13 student reaches learning endpoints"

# --- P2: requireStudentOrAdmin stops ending in the link gate ----------------
mutate "$AUTH" \
  '  return requireGuardianLinkForUnder13(req, res, next);
}' \
  '  return next();
}' || exit 2
run_plant P2 "under-13, unlinked" "the student-or-admin mounts lose the link gate"

# --- P3: the link answer is cached per student (the stored-flag design) -----
mutate "$AUTH" \
  '    linked = await hasActiveGuardianLink(supabaseServer, user.id);' \
  '    const cache = ((globalThis as unknown as { __g204?: Map<string, boolean> }).__g204 ??= new Map());
    linked = cache.get(user.id) ?? (await hasActiveGuardianLink(supabaseServer, user.id));
    cache.set(user.id, linked);' || exit 2
run_plant P3 "without signing in again" "a guardian's unlink does not close the student's next request"

# --- P4: the student's own learning reads lose the gate ---------------------
mutate "$RESOURCES" \
  '    `/:studentId${path}`,
    resolveSubject,
    requireGuardianLinkForUnder13,' \
  '    `/:studentId${path}`,
    resolveSubject,' || exit 2
run_plant P4 "approved allowed set" "an ungated learning read under /api/students is not in the allowed set"

# --- P5: billing checkout loses the gate -----------------------------------
mutate "$BILLING" \
  '  "/checkout",
  requireSupabaseAuth,
  doubleCsrfProtection,
  // G2-04 (owner approval 2026-09-29): an under-13 student with no active guardian link cannot
  // start a purchase or open the portal. A gate only — no Stripe logic changes. It reads the
  // CALLER, so a guardian paying for a linked under-13 student passes.
  requireGuardianLinkForUnder13,' \
  '  "/checkout",
  requireSupabaseAuth,
  doubleCsrfProtection,' || exit 2
run_plant P5 "cannot start checkout" "an unlinked under-13 student starts checkout"

# --- P6: the gate reaches guardians too (reads the wrong party) ------------
mutate "$AUTH" \
  '  if (user.isAdmin || user.role !== "student" || user.is_under_13 !== true) {' \
  '  if (user.isAdmin || (user.role !== "student" && user.role !== "guardian") || (user.role === "student" && user.is_under_13 !== true)) {' || exit 2
run_plant P6 "can still start checkout" "a guardian paying for a linked under-13 student is refused"

echo
echo "plants fired: $PASSES, did not fire / errored: $FAILURES"
if [ "$FAILURES" -ne 0 ]; then
  exit 1
fi
