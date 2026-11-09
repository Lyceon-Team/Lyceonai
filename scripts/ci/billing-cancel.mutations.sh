#!/usr/bin/env bash
# ============================================================================
# Mutation harness for subscription cancellation at any status
# ============================================================================
# @spec [SCL-271 (cancellation always works; `past_due` ends billing now and holds access to the
#   grace deadline); SCL-272 (payer-only self-service, decided by the server); Doc-01_V8 §21, §23;
#   owner rulings Karl 2026-11-03] | @implemented [2026-11-03]
#
# Each mutation plants a defect, runs the test that guards it, and requires that test to go RED on
# a NAMED assertion. Same rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants, and the files are
#            restored after each one (and on exit).
#
# WHY THE CLIENT IS PLANTED TOO (P6-P9). The dates and the promises a customer reads are the whole
# point of this change, and `tsconfig.json` excludes `**/*.test.tsx` — so nothing but a plant
# distinguishes "the component renders the server's date" from "the component renders a date".
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/billing-cancel-mut.XXXX)"

DECIDE=server/lib/stripe/cancellation.ts
EXEC=server/lib/stripe/cancellation-execute.ts
SUBJECT=server/lib/stripe/cancellation-subject.ts
DIALOG=client/src/components/billing/CancelSubscriptionDialog.tsx
SETTINGS=client/src/components/settings/BillingSection.tsx
GUARDIAN=client/src/features/guardian/GuardianStudentsPage.tsx
FILES=("$DECIDE" "$EXEC" "$SUBJECT" "$DIALOG" "$SETTINGS" "$GUARDIAN")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> — exactly one occurrence, or STALE (exit 9).
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
DECIDE_T=tests/ci/billing-cancel-decision.contract.test.ts
ROUTE_T=tests/ci/billing-cancel.contract.test.ts
UI_T=client/src/components/billing/CancelSubscriptionDialog.test.tsx
GUARDIAN_T=client/src/features/guardian/students-cancel.test.tsx

# expect_red <name> <expected substring> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

# run <name> <substring> <check files...> — after a plant
run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$DECIDE_T" "$ROUTE_T" "$UI_T" "$GUARDIAN_T")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | tail -30; exit 1; fi

echo "=== (P1) only the LATEST open invoice is voided ==="
# The defect this exists to catch: cancelling a subscription sets auto_advance=false on its open
# invoices and leaves each one PAYABLE. Voiding one of three still shows the customer money owed
# on a subscription they cancelled, which is the message the owner's brief started from.
plant "$EXEC" \
  "  for (const invoice of open) {" \
  "  for (const invoice of open.slice(-1)) {" || { bad "P1 STALE"; exit 1; }
run "P1 void only the latest" "voids EVERY open invoice" "$ROUTE_T"

echo "=== (P2) past_due schedules at the period end instead of the grace deadline ==="
# The period end is a date NOBODY HAS PAID FOR. Using it would hand a defaulting customer free
# access past the grace window; the deadline is the one moment the ruling names.
plant "$EXEC" \
  "            cancel_at: plan.cancelAtEpoch," \
  "            cancel_at_period_end: true," || { bad "P2 STALE"; exit 1; }
run "P2 wrong schedule anchor" "scheduled to stop at the deadline" "$ROUTE_T"

echo "=== (P3) an already-stopping subscription is acted on a second time ==="
plant "$EXEC" \
  "        return { kind: \"noop\" };" \
  "        return { kind: \"applied\", voided: 0, openInvoicesRemaining: 0 };" \
  || { bad "P3 STALE"; exit 1; }
run "P3 no already-stopping noop" "sends nothing and emails nobody" "$ROUTE_T"

echo "=== (P4) the payer check is removed ==="
plant "$SUBJECT" \
  "  if (customerIdOf(subscription) !== callerCustomerId) {
    return { ok: false, code: \"NOT_THE_PAYER\" };
  }

" \
  "" || { bad "P4 STALE"; exit 1; }
# Named on the GUARDIAN case deliberately. The "student whose guardian pays" denial is refused
# earlier, at NO_STRIPE_CUSTOMER, so it stays green under this plant and would be a dead name
# here; these two are the cases the comparison itself decides.
run "P4 anyone may cancel anything" "the guardian is refused when the student pays for themselves" "$ROUTE_T"

echo "=== (P5) the grace window is hard-coded past the one constant ==="
# Owner ruling: "define the 7 as a named constant in one place, not inline."
plant "$DECIDE" \
  "    PAST_DUE_GRACE_DAYS * SECONDS_PER_DAY" \
  "    3 * SECONDS_PER_DAY" || { bad "P5 STALE"; exit 1; }
run "P5 inline grace window" "the deadline helper uses it" "$DECIDE_T"

echo "=== (P6) the confirmation stops naming the date ==="
plant "$DIALOG" \
  "          ? \`You will not be charged again. You keep full access until \${when}, the end of the period you have already paid for, and then move to the free plan.\`" \
  "          ? \`You will not be charged again. You keep full access to the end of the period you have already paid for, and then move to the free plan.\`" \
  || { bad "P6 STALE"; exit 1; }
run "P6 no date before committing" "keeps the period already paid for" "$UI_T"

echo "=== (P7) an undo is offered after a cancellation that already took effect ==="
plant "$DIALOG" \
  "    const undoable =
      cancel.result.decision === \"at_period_end\" ||
      cancel.result.decision === \"past_due_scheduled\";" \
  "    const undoable = true;" || { bad "P7 STALE"; exit 1; }
run "P7 undo for a done deal" "offers no undo for a cancellation" "$UI_T"

echo "=== (P8) the portal copy claims cancellation again ==="
# SCL-272 makes our endpoint the single cancellation path; the portal's own cancel control stays
# enabled only until the amended Notice is published, and the copy must not advertise it.
plant "$SETTINGS" \
  "          Opens Stripe, where you can update your card or see invoices." \
  "          Opens Stripe, where you can update your card, see invoices or cancel." \
  || { bad "P8 STALE"; exit 1; }
run "P8 portal copy regressed" "no longer offers the portal for cancelling" "$UI_T"

echo "=== (P9) a subscription already stopping is offered a second Cancel ==="
plant "$DIALOG" \
  "  const alreadyStopping =
    subscription.decision === \"already_scheduled\" ||
    subscription.decision === \"already_canceled\";" \
  "  const alreadyStopping = false;" || { bad "P9 STALE"; exit 1; }
run "P9 second cancel offered" "offers neither button" "$UI_T"

echo "=== (P10) the guardian row lookup is keyed on the wrong field ==="
# A mis-keyed map is the defect that puts a cancel button in the WRONG student's row, or in none.
plant "$GUARDIAN" \
  "      .map((row) => [row.studentProfileId as string, row] as const)," \
  "      .map((row) => [row.subscriptionId, row] as const)," || { bad "P10 STALE"; exit 1; }
run "P10 wrong row key" "appears only in the row of the student" "$GUARDIAN_T"

echo "=== (P11) the guardian billing copy sends people back to the portal to cancel ==="
plant "$GUARDIAN" \
  "            Manage billing for every student you pay for — payment method and" \
  "            Manage billing for every student you pay for — payment method," || { bad "P11 STALE"; exit 1; }
run "P11 portal signpost restored" "no longer sends guardians to the portal" "$GUARDIAN_T"

echo
echo "================================"
echo " PASS: $PASS   FAIL: $FAIL"
echo "================================"
[ "$FAIL" = 0 ] || exit 1
