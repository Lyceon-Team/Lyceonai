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
#  G10  the count check is ADVISORY off CI and FATAL on it. The owner ruling is
#       that the CI runner's reading is authoritative; a ratchet that fires or
#       passes depending on which machine measured last gets loosened until it
#       stops firing.
#  G11  `tolerance` is read FROM THE ENTRY: at ceiling+tolerance the gate passes,
#       one above it the gate is red.
#  G12  MUTATION — a tolerance widened silently INSIDE the gate makes G8 go green.
#       That is what proves G8 is the case that catches a gate-side widening, and
#       why the tolerance belongs on the entry where a reviewer of the accept-list
#       can see it.
#  G13  a ceiling raised without a trailer is rejected (CI-GATING-003)
#  G14  a ceiling raised with trailer but STALE ceiling_source is rejected —
#       the trailer records the decision; ceiling_source records the reason
#  G15  a ceiling raised with trailer AND updated ceiling_source passes
#  G16  a ceiling DECREASED passes without a trailer
#  G17  a NEW entry (absent at base) requires a trailer — raise from 0
#  G18  a REMOVED entry passes — gap closed, no trailer needed
#  G19  running on the base branch itself (HEAD == base) — no raise, passes
#
# Fixtures are written to a temp dir and fed in via KNOWN_GAPS_FILE; the clock
# is pinned with KNOWN_GAPS_NOW so nothing here depends on the wall date.
# Ratchet tests use KNOWN_GAPS_BASE_FILE and KNOWN_GAPS_RAISE_IDS to avoid
# depending on real git history.
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
    tolerance: 0
    ceiling_source: fixture
    reason: fixture
    re_arm: fixture
YAML
}

run_gate() {
  CI=1 KNOWN_GAPS_FILE="$1" KNOWN_GAPS_NOW="2026-08-19" KNOWN_GAPS_SKIP_COUNTS=1 KNOWN_GAPS_SKIP_RATCHET=1 node "$GATE" 2>&1
}
# CI=1 == the authoritative environment. Counts are only fatal there.
run_gate_with_counts() {
  CI=1 KNOWN_GAPS_FILE="$1" KNOWN_GAPS_NOW="2026-08-19" KNOWN_GAPS_SKIP_RATCHET=1 node "$GATE" 2>&1
}
# `env -u CI` is required, not cosmetic: this self-test itself runs under CI=true
# in the workflow, so the local case has to unset it explicitly.
run_gate_with_counts_local() {
  env -u CI KNOWN_GAPS_FILE="$1" KNOWN_GAPS_NOW="2026-08-19" KNOWN_GAPS_SKIP_RATCHET=1 node "$GATE" 2>&1
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
    tolerance: 0
    ceiling_source: fixture
    reason: fixture
    re_arm: fixture
YAML
}
G1_OK=1
for field in id owner expires command count_command findings_ceiling tolerance ceiling_source reason re_arm; do
  write_full "$TMP/full.yaml"
  grep -v "^    $field:\|^  - $field:" "$TMP/full.yaml" > "$TMP/missing-$field.yaml"
  OUT="$(run_gate "$TMP/missing-$field.yaml")"; RC=$?
  if [ "$RC" -eq 0 ]; then
    fail G1 "an entry with NO \`$field\` was ACCEPTED (rc=0). A required field that can be
       omitted is not required. This is the CI-GATING-001 shape."
    G1_OK=0
  fi
done
[ "$G1_OK" = 1 ] && pass G1 "all 10 required fields rejected when omitted"

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
    tolerance: 0
    ceiling_source: fixture
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
    tolerance: 0
    ceiling_source: fixture
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
sed 's/^    if (actual > limit) {$/    if (false) {/' "$GATE" > "$MUT2"
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

# ── G10 — the count check is FATAL on CI and ADVISORY off it ────────────────
# G8 above already proved the fatal half (it runs with CI=1). This is the other
# half of the owner ruling: a local reading is information, not a verdict.
OUT="$(run_gate_with_counts_local "$TMP/over-ceiling.yaml")"; RC=$?
if [ "$RC" -ne 0 ]; then
  fail G10 "off CI, an over-ceiling count was FATAL. Then the same commit passes on one
       machine and fails on another, which is how a ceiling gets raised until it stops firing.
       $(head -5 <<<"$OUT")"
elif ! grep -q "ADVISORY" <<<"$OUT"; then
  fail G10 "off CI the gate exited 0 but printed no advisory — the growth is now SILENT,
       which is worse than fatal. It must still be reported, just not as a verdict.
       $(head -5 <<<"$OUT")"
else
  pass G10 "off CI an over-ceiling count is advisory and reported; on CI it is fatal"
fi

# ── G11 — the tolerance is read from the ENTRY ──────────────────────────────
# Same 7 findings, same ceiling of 3. With `tolerance: 4` the limit is exactly 7
# and the gate must pass; with `tolerance: 3` the limit is 6 and it must be red.
# If the gate ignored the field, both cases would land the same way.
write_tolerance_fixture() { # $1=file $2=tolerance
  cat > "$1" <<YAML
entries:
  - id: fixture-entry
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 7
    findings_ceiling: 3
    tolerance: $2
    ceiling_source: fixture
    reason: fixture
    re_arm: fixture
YAML
}
write_tolerance_fixture "$TMP/tol-exact.yaml" 4
write_tolerance_fixture "$TMP/tol-short.yaml" 3
OUT_EXACT="$(run_gate_with_counts "$TMP/tol-exact.yaml")"; RC_EXACT=$?
OUT_SHORT="$(run_gate_with_counts "$TMP/tol-short.yaml")"; RC_SHORT=$?
if [ "$RC_EXACT" -ne 0 ]; then
  fail G11 "7 findings against ceiling 3 + tolerance 4 was REJECTED — the stated tolerance
       is not being honoured, so declaring one does nothing
       $(head -5 <<<"$OUT_EXACT")"
elif [ "$RC_SHORT" -eq 0 ]; then
  fail G11 "7 findings against ceiling 3 + tolerance 3 was ACCEPTED — the tolerance is not
       bounding anything; any value would pass"
else
  pass G11 "the tolerance is read from the entry — exact passes, one short is red"
fi

# ── G12 — MUTATION: a tolerance widened silently IN THE GATE ────────────────
# This is the mutation the tolerance mechanism exists to make catchable. Widen
# the limit inside the gate rather than on the entry; G8's scenario must go
# green, which is what proves G8 is the case that catches it — and why the
# tolerance lives on the entry, where a reviewer of the accept-list sees it.
MUT3="$TMP/gate-with-hidden-slack.mjs"
sed 's/^    const limit = ceiling + tolerance;$/    const limit = ceiling + tolerance + 50;/' "$GATE" > "$MUT3"
if ! grep -q "tolerance + 50;" "$MUT3"; then
  fail G12 "could not stage the mutation — the limit expression was not found where expected"
else
  OUT="$(CI=1 KNOWN_GAPS_FILE="$TMP/over-ceiling.yaml" KNOWN_GAPS_NOW="2026-08-19" node "$MUT3" 2>&1)"; RC=$?
  if [ "$RC" -ne 0 ]; then
    fail G12 "with 50 of hidden slack added inside the gate the over-ceiling entry is STILL
       red — then G8 is not the case that catches a gate-side widening
       $(head -5 <<<"$OUT")"
  else
    pass G12 "a tolerance widened inside the gate makes G8 go green — G8 is what catches it"
  fi
fi

# ── the real list must be valid ─────────────────────────────────────────────
OUT="$(KNOWN_GAPS_SKIP_COUNTS=1 KNOWN_GAPS_SKIP_RATCHET=1 node "$GATE" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ]; then
  fail G5 "ci/known-gaps.yaml itself does not pass the gate
       $(head -8 <<<"$OUT")"
else
  pass G5 "the committed ci/known-gaps.yaml is valid and unexpired"
fi

# ============================================================================
# RATCHET TESTS (G13–G19)
# ============================================================================
# The ratchet uses KNOWN_GAPS_BASE_FILE and KNOWN_GAPS_RAISE_IDS instead of
# git operations, so these tests work without a real git history.
#
# Seven cases — a gate never observed failing is not known to work:
#  G13  raise without trailer → FAIL
#  G14  raise with trailer but stale ceiling_source → FAIL
#  G15  raise with trailer and updated ceiling_source → PASS
#  G16  lower a ceiling → PASS, no trailer needed
#  G17  add a new entry without a trailer → FAIL
#  G18  remove an entry → PASS
#  G19  run on the base branch itself (HEAD == base) → no raise, PASS
# ============================================================================

# Helper: run gate with ratchet in test mode
run_gate_ratchet() {
  # $1 = HEAD file, $2 = base file (empty string if no base), $3 = raise IDs (empty = none)
  CI=1 KNOWN_GAPS_FILE="$1" KNOWN_GAPS_NOW="2026-08-19" KNOWN_GAPS_SKIP_COUNTS=1 \
    KNOWN_GAPS_BASE="test-base" \
    KNOWN_GAPS_BASE_FILE="${2:-__nonexistent__}" \
    KNOWN_GAPS_RAISE_IDS="${3:-}" \
    node "$GATE" 2>&1
}

# Shared fixtures: base has ceiling 30 with ceiling_source "original measurement"
cat > "$TMP/ratchet-base.yaml" <<'YAML'
entries:
  - id: fixture-entry
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 1
    findings_ceiling: 30
    tolerance: 0
    ceiling_source: original measurement
    reason: fixture
    re_arm: fixture
YAML

# ── G13 — raise without trailer → FAIL ────────────────────────────────────
cat > "$TMP/ratchet-raised.yaml" <<'YAML'
entries:
  - id: fixture-entry
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 1
    findings_ceiling: 50
    tolerance: 0
    ceiling_source: original measurement
    reason: fixture
    re_arm: fixture
YAML
OUT="$(run_gate_ratchet "$TMP/ratchet-raised.yaml" "$TMP/ratchet-base.yaml" "")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G13 "a ceiling raised from 30 to 50 without a trailer was ACCEPTED — the ratchet
       is not enforcing"
elif ! echo "$OUT" | grep -q "ratchet"; then
  fail G13 "red, but not for the ratchet: $(head -5 <<<"$OUT" | tr '\n' ' ')"
else
  pass G13 "a raised ceiling without a trailer is rejected"
fi

# ── G14 — raise with trailer but stale ceiling_source → FAIL ──────────────
# Same HEAD file as G13: ceiling_source is "original measurement" (unchanged)
OUT="$(run_gate_ratchet "$TMP/ratchet-raised.yaml" "$TMP/ratchet-base.yaml" "fixture-entry")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G14 "a ceiling raised with trailer but STALE ceiling_source was ACCEPTED — the
       justification for the new number is missing
       $(head -5 <<<"$OUT")"
elif ! echo "$OUT" | grep -q "ceiling_source"; then
  fail G14 "red, but not for ceiling_source: $(head -5 <<<"$OUT" | tr '\n' ' ')"
else
  pass G14 "a raised ceiling with trailer but stale ceiling_source is rejected"
fi

# ── G15 — raise with trailer and updated ceiling_source → PASS ────────────
cat > "$TMP/ratchet-raised-justified.yaml" <<'YAML'
entries:
  - id: fixture-entry
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 1
    findings_ceiling: 50
    tolerance: 0
    ceiling_source: new measurement after adding 20 findings from new module
    reason: fixture
    re_arm: fixture
YAML
OUT="$(run_gate_ratchet "$TMP/ratchet-raised-justified.yaml" "$TMP/ratchet-base.yaml" "fixture-entry")"; RC=$?
if [ "$RC" -ne 0 ]; then
  fail G15 "a ceiling raised with trailer AND updated ceiling_source was REJECTED — the
       escape hatch is broken
       $(head -5 <<<"$OUT")"
else
  pass G15 "a raised ceiling with trailer and updated ceiling_source is accepted"
fi

# ── G16 — lower a ceiling → PASS, no trailer needed ───────────────────────
cat > "$TMP/ratchet-lowered.yaml" <<'YAML'
entries:
  - id: fixture-entry
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 1
    findings_ceiling: 20
    tolerance: 0
    ceiling_source: original measurement
    reason: fixture
    re_arm: fixture
YAML
OUT="$(run_gate_ratchet "$TMP/ratchet-lowered.yaml" "$TMP/ratchet-base.yaml" "")"; RC=$?
if [ "$RC" -ne 0 ]; then
  fail G16 "a ceiling decreased from 30 to 20 was REJECTED — decreases should always pass
       $(head -5 <<<"$OUT")"
else
  pass G16 "a decreased ceiling passes without a trailer"
fi

# ── G17 — add a new entry without a trailer → FAIL ────────────────────────
# Base has a different entry; HEAD adds fixture-entry (absent at base = raise from 0)
cat > "$TMP/ratchet-other-base.yaml" <<'YAML'
entries:
  - id: other-entry
    owner: someone
    expires: 2099-01-01
    command: echo ok
    count_command: echo 1
    findings_ceiling: 1
    tolerance: 0
    ceiling_source: fixture
    reason: fixture
    re_arm: fixture
YAML
OUT="$(run_gate_ratchet "$TMP/ratchet-raised.yaml" "$TMP/ratchet-other-base.yaml" "")"; RC=$?
if [ "$RC" -eq 0 ]; then
  fail G17 "a new entry (absent at base) was ACCEPTED without a trailer — adding a new
       accepted failure should require explicit acknowledgment"
elif ! echo "$OUT" | grep -q "ratchet"; then
  fail G17 "red, but not for the ratchet: $(head -5 <<<"$OUT" | tr '\n' ' ')"
else
  pass G17 "a new entry absent at base requires a trailer"
fi

# ── G18 — remove an entry → PASS ──────────────────────────────────────────
# Base has two entries; HEAD keeps only one (fixture-entry was removed = gap closed)
cat > "$TMP/ratchet-two-base.yaml" <<'YAML'
entries:
  - id: fixture-entry
    owner: someone
    expires: 2099-01-01
    command: pnpm run nothing
    count_command: echo 1
    findings_ceiling: 30
    tolerance: 0
    ceiling_source: original measurement
    reason: fixture
    re_arm: fixture
  - id: other-entry
    owner: someone
    expires: 2099-01-01
    command: echo ok
    count_command: echo 1
    findings_ceiling: 1
    tolerance: 0
    ceiling_source: fixture
    reason: fixture
    re_arm: fixture
YAML
cat > "$TMP/ratchet-removed-head.yaml" <<'YAML'
entries:
  - id: other-entry
    owner: someone
    expires: 2099-01-01
    command: echo ok
    count_command: echo 1
    findings_ceiling: 1
    tolerance: 0
    ceiling_source: fixture
    reason: fixture
    re_arm: fixture
YAML
OUT="$(run_gate_ratchet "$TMP/ratchet-removed-head.yaml" "$TMP/ratchet-two-base.yaml" "")"; RC=$?
if [ "$RC" -ne 0 ]; then
  fail G18 "removing an entry (gap closed) was REJECTED — entry removal should always pass
       $(head -5 <<<"$OUT")"
else
  pass G18 "removing an entry passes (gap closed)"
fi

# ── G19 — run on the base branch itself → no raise, PASS ──────────────────
# HEAD and base are identical — every ceiling equals itself, no raise detected
OUT="$(run_gate_ratchet "$TMP/ratchet-base.yaml" "$TMP/ratchet-base.yaml" "")"; RC=$?
if [ "$RC" -ne 0 ]; then
  fail G19 "running with HEAD == base was REJECTED — the ratchet should be a no-op when
       nothing changed
       $(head -5 <<<"$OUT")"
else
  pass G19 "running on the base branch itself detects no raise — passes"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "KNOWN-GAPS GATE SELF-TEST: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "KNOWN-GAPS GATE SELF-TEST: PASS"
