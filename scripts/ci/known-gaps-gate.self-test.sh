#!/usr/bin/env bash
# ============================================================================
# KNOWN-GAPS GATE — proving mechanism
# ============================================================================
# The gate's whole value is that it REFUSES things. A gate that only ever
# passes is indistinguishable from no gate, which is the failure this entire
# workstream exists to remove — so the refusals are asserted here, not assumed.
#
#   G1  an entry with NO EXPIRY is rejected
#   G2  an entry PAST its expiry turns the gate red
#   G3  a well-formed, unexpired entry passes (so G1/G2 are not just "always red")
#   G4  MUTATION — with the expiry comparison removed, G2 goes green. This is
#       what proves the expiry check is load-bearing rather than decoration.
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
    reason: fixture
    re_arm: fixture
YAML
}

run_gate() { KNOWN_GAPS_FILE="$1" KNOWN_GAPS_NOW="2026-08-19" node "$GATE" 2>&1; }

# ── G1 — no expiry is rejected ──────────────────────────────────────────────
write_entry "$TMP/no-expiry.yaml" ""
OUT="$(run_gate "$TMP/no-expiry.yaml")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G1 "an entry with NO expiry was accepted — the schema check is not enforcing"
elif ! grep -q "missing expires" <<<"$OUT"; then
  fail G1 "rejected, but not for the missing expiry: $(head -3 <<<"$OUT" | tr '\n' ' ')"
else
  pass G1 "an entry without an expiry is rejected"
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

# ── the real list must be valid ─────────────────────────────────────────────
OUT="$(node "$GATE" 2>&1)"; RC=$?
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
