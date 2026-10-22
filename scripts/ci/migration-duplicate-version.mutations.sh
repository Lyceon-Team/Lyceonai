#!/usr/bin/env bash
# Duplicate migration versions — mutation harness.
#
# @spec [owner brief "migration inventory gate fails on duplicate versions" (Karl, 2026-10-21):
#       "with a test and a planted defect"] | @implemented [2026-10-21]
#
# Each plant breaks ONE rule of scripts/ci/lib/migration-versions.sh or its I0 case in the
# migration inventory gate, and must turn a NAMED test in
# tests/ci/migration-duplicate-version.contract.test.ts red. Same rules as the other harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED TEST. Only vitest's failure lines (FAIL / ×) are matched.
# After every plant the file is restored and `cmp`'d byte-identical to its snapshot.
# No Postgres needed: the test proves the gate stops on I0 before it would connect.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LIB="scripts/ci/lib/migration-versions.sh"
GATE="scripts/ci/migration-inventory-gate.sh"
TEST=tests/ci/migration-duplicate-version.contract.test.ts
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/migver-mut.XXXX)"

FILES=("$LIB" "$GATE")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() {
  for f in "${FILES[@]}"; do
    cp "$BACKUPS/$f" "$f"
    cmp -s "$BACKUPS/$f" "$f" || { echo "  !! REVERT NOT BYTE-IDENTICAL: $f"; FAIL=$((FAIL+1)); }
  done
}
trap 'for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> — old exactly once, or STALE.
plant() {
  python3 - "$@" <<'PY'
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

check() { pnpm exec vitest run "$TEST" 2>&1; }

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  local failures
  failures="$(printf '%s\n' "$3" | grep -E '(FAIL |×)' || true)"
  case "$failures" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

run() {
  local name="$1" sub="$2" out rc
  out="$(check)"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check)"; RC=$?
[ "$RC" = 0 ] && ok "suite green" || { bad "suite not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "MIGRATION DUPLICATE VERSION MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== (1) a new duplicate version is not reported ==="
plant "$LIB" '    if [ -z "$expected" ]; then' '    if false; then' || { bad "V1 STALE"; exit 1; }
run "V1 new duplicate fails" "D2: a new duplicate version fails"

echo "=== (2) the version is read as the whole filename, so nothing is ever a duplicate ==="
plant "$LIB" 'sub(/_.*/, "", v);' 'sub(/\.sql$/, "", v);' || { bad "V2 STALE"; exit 1; }
run "V2 version is the leading timestamp" "D2: a new duplicate version fails"

echo "=== (3) the version is the first 14 characters, not the digits before the underscore ==="
plant "$LIB" 'sub(/_.*/, "", v);' 'v = substr(v, 1, 14);' || { bad "V3 STALE"; exit 1; }
run "V3 prefix is not a version" "D3: a version that only shares a prefix"

echo "=== (4) a frozen duplicate may grow ==="
plant "$LIB" '    elif [ "$expected" != "$files" ]; then' '    elif false; then' || { bad "V4 STALE"; exit 1; }
run "V4 frozen sets are exact" "D4: a third file joining a frozen duplicate"

echo "=== (5) a resolved duplicate may stay on the list ==="
plant "$LIB" '    if ! grep -q "^$version|" <<<"$actual"; then' '    if false; then' || { bad "V5 STALE"; exit 1; }
run "V5 the list only shrinks" "D5: a resolved frozen duplicate"

echo "=== (6) the gate reports I0 but carries on ==="
plant "$GATE" '  echo "MIGRATION INVENTORY GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
pass I0' '  echo "MIGRATION INVENTORY GATE: FAIL ($FAILURES case(s))"
fi
pass I0' || { bad "V6 STALE"; exit 1; }
run "V6 I0 is fatal" "D6: the inventory gate stops on I0"

echo "=== (7) the gate never asks ==="
plant "$GATE" 'I0_OUT="$(migration_version_findings "${MIGRATION_VERSIONS_DIR:-$ROOT/supabase/migrations}")"' 'I0_OUT=""' || { bad "V7 STALE"; exit 1; }
run "V7 the gate runs I0" "D6: the inventory gate stops on I0"

echo
echo "MIGRATION DUPLICATE VERSION MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
