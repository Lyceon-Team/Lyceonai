#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the sign-in notice (SCL-222, owner ruling 2026-10-09)
# ============================================================================
# @spec [SCL-222: the standard sign-in notice replaces the Terms checkbox; acceptance is recorded
#   at account creation; a returning user's sign-in records nothing] | @implemented [2026-10-09]
#
# Each mutation plants a defect, runs the test that guards it, and requires that test to go RED on
# a NAMED assertion. Same rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants, and the files are
#            restored after each one (and on exit).
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/signin-notice-mut.XXXX)"

CALLBACK=server/routes/oauth-callback-routes.ts
NEWACCT=server/lib/new-auth-account.ts
SIGNUP=server/routes/supabase-auth-routes.ts
FORM=client/src/components/auth/SupabaseAuthForm.tsx
FILES=("$CALLBACK" "$NEWACCT" "$SIGNUP" "$FORM")
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
CALLBACK_T=tests/ci/oauth-callback.contract.test.ts
NEWACCT_T=tests/ci/new-auth-account.contract.test.ts
SIGNUP_T=tests/ci/auth-signup.contract.test.ts
FORM_T=tests/ci/signup-frontend.contract.test.ts

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
OUT="$(check "$CALLBACK_T" "$NEWACCT_T" "$SIGNUP_T" "$FORM_T")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | tail -30; exit 1; fi

echo "=== (1) a returning user's Google sign-in records acceptance ==="
plant "$CALLBACK" \
  "        otp === null && isNewlyCreatedAccount(user.created_at, new Date());" \
  "        otp === null && true;" || { bad "M1 STALE"; exit 1; }
run "M1 creation check dropped" "a returning user's sign-in records nothing" "$CALLBACK_T"

echo "=== (2) the new-account test ignores the account's age ==="
plant "$NEWACCT" \
  "  if (Number.isNaN(created)) return false;" \
  "  if (Number.isNaN(created)) return false;
  return true;" || { bad "M2 STALE"; exit 1; }
run "M2 window ignored" "a returning account (created months ago) is not new" "$NEWACCT_T"

echo "=== (3) email signup records nothing unless the client sends consent flags ==="
plant "$SIGNUP" \
  "        resolved === null
          ? { durable: false as const }" \
  "        resolved === null || legalConsent?.studentTermsAccepted !== true
          ? { durable: false as const }" || { bad "M3 STALE"; exit 1; }
run "M3 creation record tied to a client claim" "a signup with no legalConsent is accepted and records both documents" "$SIGNUP_T"

echo "=== (4) Continue with Google is disabled again ==="
plant "$FORM" \
  "            onClick={handleGoogleSignIn}
            disabled={isLoading}" \
  "            onClick={handleGoogleSignIn}
            disabled={true}" || { bad "M4 STALE"; exit 1; }
run "M4 Google gated" "Google is first and never disabled" "$FORM_T"

echo "=== (5) restored: everything green again ==="
OUT="$(check "$CALLBACK_T" "$NEWACCT_T" "$SIGNUP_T" "$FORM_T")"; RC=$?
if [ "$RC" = 0 ]; then ok "green after restore"; else bad "not green after restore"; echo "$OUT" | tail -30; fi

echo
echo "signin-notice mutations: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
