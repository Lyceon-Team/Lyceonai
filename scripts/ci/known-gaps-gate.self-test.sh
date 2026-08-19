#!/usr/bin/env bash
# ============================================================================
# KNOWN-GAPS GATE — proving mechanism
# ============================================================================
# The gate's whole value is that it REFUSES things. A gate that only ever
# passes is indistinguishable from no gate, which is the failure this entire
# workstream exists to remove — so the refusals are asserted here, not assumed.
#
#   G1  EVERY required field, omitted one at a time, is rejected. It used to test
#       only the expiry — which is exactly why CI-GATING-001 survived: an entry
#       with no `id` parsed as ZERO entries, and a loop over zero entries reports
#       zero violations, so the gate reached PASS. Verbatim before the fix:
#       `missing_id rc=0 matched=no` while the other five returned rc=1.
#   G2  an entry PAST its expiry turns the gate red
#   G3  a well-formed, unexpired entry passes (so G1/G2 are not just "always red")
#   G4  MUTATION — with the expiry comparison removed, G2 goes green. This is
#       what proves the expiry check is load-bearing rather than decoration.
#   G6  a file that parses to ZERO entries is rejected. The defect class is
#       "validation that iterates over parsed results cannot detect a parse
#       failure" — zero entries and zero violations are indistinguishable unless
#       something counts the SOURCE.
#   G7  an orphan field with no `- id:` opener is a parse ERROR, not a skip.
#   G8  a count above the declared ceiling turns the gate red — an accepted gap
#       may sit at a size, it may not grow quietly.
#   G9  MUTATION — with the ceiling comparison removed, G8 goes green.
#
# Fixtures are written to a temp dir and fed in via KNOWN_GAPS_FILE; the clock
# is pinned with KNOWN_GAPS_NOW so nothing here depends on the wall date.
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/known-gaps-gate.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

write_entry() { # $1=file  $2=extra lines
  cat > "$1" <<YAML
entries:
  - id: fixture-entry
    owner: someone
$2
    command: pnpm run nothing
    count_command: echo 1
    findings_ceiling: 1
    reason: fixture
    re_arm: fixture
YAML
}

run_gate() {
  KNOWN_GAPS_FILE="$1" KNOWN_GAPS_NOW="2026-08-19" KNOWN_GAPS_SKIP_COUNTS=1 node "$GATE" 2>&1
}
run_gate_with_counts() {
  KNOWN_GAPS_FILE="$1" KNOWN_GAPS_NOW="2026-08-19" node "$GATE" 2>&1
}

# ── G1 — EVERY required field, omitted one at a time, is rejected ───────────
# A complete, valid entry; each case deletes exactly one line from it.
write_full() {
  cat > "$1" <<'YAML'
entries:
  - id: fixture-entry
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 1
    findings_ceiling: 1
    reason: fixture
    re_arm: fixture
YAML
}
G1_OK=1
for field in id owner expires command count_command findings_ceiling reason re_arm; do
  write_full "$TMP/full.yaml"
  grep -v "^    $field:\|^  - $field:" "$TMP/full.yaml" > "$TMP/missing-$field.yaml"
  OUT="$(run_gate "$TMP/missing-$field.yaml")"; RC=$?
  if [ "$RC" -eq 0 ]; then
    fail G1 "an entry with NO \`$field\` was ACCEPTED (rc=0). A required field that can be
       omitted is not required. This is the CI-GATING-001 shape."
    G1_OK=0
  fi
done
[ "$G1_OK" = 1 ] && pass G1 "all 8 required fields rejected when omitted"

# the original single-field case, kept explicit because it is the one with a
# bespoke message
write_entry "$TMP/no-expiry.yaml" ""
OUT="$(run_gate "$TMP/no-expiry.yaml")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G1b "an entry with NO expiry was accepted — the schema check is not enforcing"
else
  pass G1b "an entry without an expiry is rejected"
fi

# ── G2 — an expired entry is red ────────────────────────────────────────────
write_entry "$TMP/expired.yaml" "    expires: 2026-01-01"
OUT="$(run_gate "$TMP/expired.yaml")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G2 "an entry that expired 2026-01-01 did not turn the gate red"
elif ! grep -q "expired" <<<"$OUT"; then
  fail G2 "red, but not for expiry: $(head -3 <<<"$OUT" | tr '\n' ' ')"
else
  pass G2 "an entry past its expiry turns the gate red"
fi

# ── G3 — a good entry passes ────────────────────────────────────────────────
write_entry "$TMP/good.yaml" "    expires: 2099-01-01"
OUT="$(run_gate "$TMP/good.yaml")"; RC=$?
if [ "$RC" -ne 0 ]; then
  fail G3 "a well-formed unexpired entry was rejected — G1/G2 may just be always-red
       $(head -5 <<<"$OUT")"
else
  pass G3 "a well-formed, unexpired entry passes"
fi

# ── G4 — mutation: without the expiry comparison, G2 must go green ──────────
MUT="$TMP/gate-without-expiry-check.mjs"
sed 's/^  if (expires < now) {$/  if (false) {/' "$GATE" > "$MUT"
if ! grep -q "if (false) {" "$MUT"; then
  fail G4 "could not stage the mutation — the expiry comparison was not found where expected"
else
  OUT="$(KNOWN_GAPS_FILE="$TMP/expired.yaml" KNOWN_GAPS_NOW="2026-08-19" node "$MUT" 2>&1)"; RC=$?
  if [ "$RC" -ne 0 ]; then
    fail G4 "with the expiry comparison removed the expired entry is STILL red — then
       something other than the expiry check is failing it, and G2 proves less than it claims
       $(head -5 <<<"$OUT")"
  else
    pass G4 "removing the expiry comparison makes the expired entry pass — the check is load-bearing"
  fi
fi

# ── G6 — a file that parses to ZERO entries is rejected ─────────────────────
printf 'entries:\n' > "$TMP/empty.yaml"
OUT="$(run_gate "$TMP/empty.yaml")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G6 "an accept-list with ZERO entries reached PASS. Zero entries and zero violations
       must never be indistinguishable — that is the whole defect class."
else
  pass G6 "a zero-entry accept-list is rejected"
fi

# ── G7 — an orphan field with no `- id:` opener is a parse error ────────────
cat > "$TMP/orphan.yaml" <<'YAML'
entries:
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 1
    findings_ceiling: 1
    reason: fixture
    re_arm: fixture
YAML
OUT="$(run_gate "$TMP/orphan.yaml")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G7 "a block whose \`- id:\` opener was deleted was ACCEPTED — the parser is still
       skipping orphans instead of refusing them"
elif ! grep -q "before any" <<<"$OUT"; then
  fail G7 "rejected, but not as a parse error: $(head -3 <<<"$OUT" | tr '\n' ' ')"
else
  pass G7 "an orphan field with no opener is a parse error"
fi

# ── G8 — a count above the declared ceiling is red ──────────────────────────
cat > "$TMP/over-ceiling.yaml" <<'YAML'
entries:
  - id: fixture-entry
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 7
    findings_ceiling: 3
    reason: fixture
    re_arm: fixture
YAML
OUT="$(run_gate_with_counts "$TMP/over-ceiling.yaml")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G8 "7 findings against a ceiling of 3 was ACCEPTED — an accepted gap can grow
       without limit, which is how 2 type errors became 41"
elif ! grep -q "GREW by 4" <<<"$OUT"; then
  fail G8 "red, but not for the ceiling: $(head -3 <<<"$OUT" | tr '\n' ' ')"
else
  pass G8 "a count above the declared ceiling turns the gate red"
fi

# ── G9 — MUTATION: without the ceiling comparison, G8 must go green ─────────
MUT2="$TMP/gate-without-ceiling-check.mjs"
sed 's/^    if (actual > ceiling) {$/    if (false) {/' "$GATE" > "$MUT2"
if ! grep -q "if (false) {" "$MUT2"; then
  fail G9 "could not stage the mutation — the ceiling comparison was not found where expected"
else
  OUT="$(KNOWN_GAPS_FILE="$TMP/over-ceiling.yaml" KNOWN_GAPS_NOW="2026-08-19" node "$MUT2" 2>&1)"; RC=$?
  if [ "$RC" -ne 0 ]; then
    fail G9 "with the ceiling comparison removed the over-ceiling entry is STILL red — then
       something other than the ceiling check is failing it, and G8 proves less than it claims
       $(head -5 <<<"$OUT")"
  else
    pass G9 "removing the ceiling comparison makes the over-ceiling entry pass — it is load-bearing"
  fi
fi

# ── the real list must be valid ─────────────────────────────────────────────
OUT="$(KNOWN_GAPS_SKIP_COUNTS=1 node "$GATE" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ]; then
  fail G5 "ci/known-gaps.yaml itself does not pass the gate
       $(head -8 <<<"$OUT")"
else
  pass G5 "the committed ci/known-gaps.yaml is valid and unexpired"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "KNOWN-GAPS GATE SELF-TEST: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "KNOWN-GAPS GATE SELF-TEST: PASS"
