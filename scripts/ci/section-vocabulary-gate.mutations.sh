#!/usr/bin/env bash
# ============================================================================
# Section vocabulary gate — MUTATION HARNESS
# ============================================================================
# A gate is only worth its runtime if it can go red, and if each red is the one it
# claims. Three hazards observed in this repo, in consecutive steps: a mutation
# that never applied and read as PASS; a mutation that reddened an EARLIER check
# than the one it named; and an assertion that could not fail because a different
# mechanism answered first.
#
#   RULE 1 — STALE IS A HARD FAILURE. Every mutation asserts its target text
#            appears EXACTLY ONCE before patching. Not found, or found twice, is a
#            hard failure (exit 9), never a pass.
#   RULE 2 — EACH MUTATION NAMES ITS RED, BY RULE AND BY LOCATION. A run passes only
#            if the output contains the rule id AND the file:line it must fire on.
#            Reddening the gate somewhere else proves nothing.
#   RULE 3 — GREEN BASELINE, GREEN RESTORE. Proven green before the first mutation
#            and after the last, so a permanently-red tree cannot read as
#            "every mutation reds".
#
# THE MUTATIONS — the owner's two, plus the two structural ones every gate needs:
#
#   M1  introduce `section: "Math"` on a data path   -> RULE A, at the injected line
#   M2  introduce the literal "MATH"                 -> RULE B, at the injected line
#   M3  point the gate at zero files                 -> ZERO-FILE tripwire
#   M4  delete Rule B's enforcement                  -> M2 stops redding (self-test)
#
# M1 and M2 are attacked separately and MUST fire on different rules: M1 uses a
# spelling Rule B does not know about, so a gate that only implemented Rule B would
# fail M1. M2 injects into a file Rule A EXEMPTS (shared/section-display.ts), so a
# gate whose Rule B carried a file allowlist would fail M2. Neither mutation can be
# caught by the other's rule, which is what makes them two proofs and not one.
#
# Output is captured to a variable and matched with `case`, never piped to `grep -q`:
# grep closes the pipe at its first match and can kill the producer on SIGPIPE before
# it flushes, which has previously produced a false "did not fire".
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

GATE="scripts/ci/section-vocabulary-gate.mjs"
# M1's victim: a real data path, in a route, not a test.
VICTIM_A="server/routes/practice-canonical.ts"
# M2's victim: a Rule A EXEMPT file, to prove Rule B has no file allowlist.
VICTIM_B="shared/section-display.ts"

cp "$GATE" /tmp/svm_gate.bak
cp "$VICTIM_A" /tmp/svm_victim_a.bak
cp "$VICTIM_B" /tmp/svm_victim_b.bak
restore() {
  cp /tmp/svm_gate.bak "$GATE"
  cp /tmp/svm_victim_a.bak "$VICTIM_A"
  cp /tmp/svm_victim_b.bak "$VICTIM_B"
}
trap restore EXIT

fail() { echo "MUTATION HARNESS: FAIL — $1"; exit 1; }

# ---------------------------------------------------------------------------
# RULE 1 helper. Asserts EXACTLY ONE occurrence, then patches in place.
# ---------------------------------------------------------------------------
patch_once() {
  local file="$1" target="$2" replacement="$3" label="$4"
  local n
  n="$(grep -F -c -- "$target" "$file")"
  if [ "$n" -ne 1 ]; then
    echo "STALE TARGET ($label): expected exactly 1 occurrence of the anchor in $file, found $n."
    echo "  anchor: $target"
    echo "  A refactor moved it. This harness must be updated, not ignored — a mutation that"
    echo "  never applies reads as a passing gate."
    exit 9
  fi
  python3 - "$file" "$target" "$replacement" <<'PY'
import sys
path, target, replacement = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path, encoding="utf-8").read()
assert s.count(target) == 1
open(path, "w", encoding="utf-8").write(s.replace(target, replacement, 1))
PY
}

run_gate() { node "$GATE" 2>&1; }

# ---------------------------------------------------------------------------
# RULE 3 — GREEN BASELINE
# ---------------------------------------------------------------------------
echo "==> baseline: the gate must be GREEN before any mutation"
OUT="$(run_gate)"; RC=$?
case "$OUT" in
  *"OK: section vocabulary"*) echo "    OK  baseline green" ;;
  *) echo "$OUT"; fail "baseline is not green — every 'mutation reds' below would be meaningless" ;;
esac
[ "$RC" -eq 0 ] || fail "baseline exit code $RC"

# ---------------------------------------------------------------------------
# M1 — a display spelling on a data path. RULE A.
# ---------------------------------------------------------------------------
echo "==> M1: introduce \`section: \"Math\"\` on a data path -> RULE A must red"
patch_once "$VICTIM_A" \
  'function normalizeSectionList(raw: unknown): CanonicalSectionCode[] {' \
  'const MUTATION_M1 = { section: "Math" };
function normalizeSectionList(raw: unknown): CanonicalSectionCode[] {' \
  "M1"
OUT="$(run_gate)"
case "$OUT" in
  *"[section-literal]"*) : ;;
  *) echo "$OUT"; fail "M1 did not fire RULE A (section-literal)" ;;
esac
case "$OUT" in
  *"$VICTIM_A"*) echo "    OK  RULE A red, in $VICTIM_A" ;;
  *) echo "$OUT"; fail "M1 reddened somewhere other than $VICTIM_A" ;;
esac
# It must NOT be caught by Rule B — "Math" is not the retired spelling.
case "$OUT" in
  *"[retired-spelling]"*) fail "M1 also fired RULE B; the two mutations are not independent" ;;
esac
cp /tmp/svm_victim_a.bak "$VICTIM_A"

# ---------------------------------------------------------------------------
# M2 — the retired spelling, inside a RULE A EXEMPT file. RULE B.
# ---------------------------------------------------------------------------
echo "==> M2: introduce the literal \"MATH\" in a Rule A EXEMPT file -> RULE B must red"
patch_once "$VICTIM_B" \
  'const MATH_TOKENS: ReadonlySet<string> = new Set(["m", "m1", "m2"]);' \
  'const MATH_TOKENS: ReadonlySet<string> = new Set(["m", "m1", "m2", "MATH"]);' \
  "M2"
OUT="$(run_gate)"
case "$OUT" in
  *"[retired-spelling]"*) : ;;
  *) echo "$OUT"; fail "M2 did not fire RULE B (retired-spelling) — Rule B must have no file allowlist" ;;
esac
case "$OUT" in
  *"$VICTIM_B"*) echo "    OK  RULE B red, in the Rule A exempt file $VICTIM_B" ;;
  *) echo "$OUT"; fail "M2 reddened somewhere other than $VICTIM_B" ;;
esac
cp /tmp/svm_victim_b.bak "$VICTIM_B"

# ---------------------------------------------------------------------------
# M3 — zero scanned files. CR-STD-01.
# ---------------------------------------------------------------------------
echo "==> M3: point the gate at a pathspec that matches nothing -> tripwire must red"
OUT="$(SECTION_VOCABULARY_PATHSPEC='no/such/path/**' node "$GATE" 2>&1)"; RC=$?
case "$OUT" in
  *"scanned ZERO source files"*) echo "    OK  zero-file tripwire red" ;;
  *) echo "$OUT"; fail "M3 did not trip the zero-file guard — a pathspec that stops matching would report clean forever" ;;
esac
[ "$RC" -ne 0 ] || fail "M3 tripped but exited 0"

# ---------------------------------------------------------------------------
# M4 — SELF-TEST. Delete Rule B's enforcement; M2 must stop redding.
#      Without this, a Rule B that was accidentally unreachable would still let
#      M2 "pass" if some other rule happened to fire on the same line.
# ---------------------------------------------------------------------------
echo "==> M4: disable RULE B in the gate -> M2 must stop redding (proves M2 tested RULE B)"
patch_once "$GATE" \
  '    if (text === RETIRED_SPELLING) {' \
  '    if (false) {' \
  "M4"
patch_once "$VICTIM_B" \
  'const MATH_TOKENS: ReadonlySet<string> = new Set(["m", "m1", "m2"]);' \
  'const MATH_TOKENS: ReadonlySet<string> = new Set(["m", "m1", "m2", "MATH"]);' \
  "M4-inject"
OUT="$(run_gate)"
case "$OUT" in
  *"[retired-spelling]"*) echo "$OUT"; fail "RULE B still fired with its condition disabled — M2 was not testing RULE B" ;;
  *) echo "    OK  RULE B silent once disabled; M2's red came from RULE B and nothing else" ;;
esac
restore

# ---------------------------------------------------------------------------
# RULE 3 — GREEN RESTORE
# ---------------------------------------------------------------------------
echo "==> restore: the gate must be GREEN again"
OUT="$(run_gate)"; RC=$?
case "$OUT" in
  *"OK: section vocabulary"*) echo "    OK  restored green" ;;
  *) echo "$OUT"; fail "tree did not restore to green — a mutation leaked" ;;
esac
[ "$RC" -eq 0 ] || fail "restore exit code $RC"

echo
echo "SECTION VOCABULARY MUTATION HARNESS: PASS (M1 RULE A, M2 RULE B, M3 tripwire, M4 self-test)"
