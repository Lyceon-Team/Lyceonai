#!/usr/bin/env bash
# =============================================================================
# guardian-dead-code-gate self-test — the gate is proven to fail before it is believed
# =============================================================================
# @spec [guardian closeout brief 2026-10-01, Part B step 4 ("show it red on one planted unused
#        export, then green")] | @implemented [2026-10-01]
#
# A gate that reports zero findings reads exactly like a gate that cannot see. This plants:
#   (A) an unused export in a live guardian module, and asserts the gate fails NAMING it;
#   (B) a guardian module that only a test imports, and asserts the gate fails naming it;
# restores each, and asserts green again. Output is captured to a variable, never piped into
# `grep -q` (SIGPIPE can kill node before it flushes — see guardian-schema-truth-gate.selftest).
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
GATE="node scripts/ci/guardian-dead-code-gate.mjs"
LIVE="client/src/features/guardian/paths.ts"
BACKUP="$(mktemp)"
ORPHAN="client/src/features/guardian/planted-orphan.ts"
ORPHAN_TEST="client/src/features/guardian/planted-orphan.test.ts"
fails=0

cp "$LIVE" "$BACKUP"
cleanup() { cp "$BACKUP" "$LIVE"; rm -f "$BACKUP" "$ORPHAN" "$ORPHAN_TEST"; }
trap cleanup EXIT

echo "==> (0) baseline must be green, or nothing below means anything"
if ! out=$($GATE 2>&1); then echo "$out" | tail -5; echo "  FAIL: gate is not green before planting"; exit 1; fi
echo "  ok   baseline green"

echo "==> (A) an unused export in a live guardian module"
printf '\nexport const PLANTED_UNUSED_EXPORT = 1;\n' >> "$LIVE"
out=$($GATE 2>&1); rc=$?
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qE "^unused-export  $LIVE:[0-9]+  PLANTED_UNUSED_EXPORT$"; then
  echo "  ok   red, naming $LIVE PLANTED_UNUSED_EXPORT"
else
  echo "  FAIL: (A) did not fire (rc=$rc)"; printf '%s\n' "$out" | tail -3; fails=$((fails + 1))
fi
cp "$BACKUP" "$LIVE"

echo "==> (B) a guardian module that only a test imports"
printf 'export function plantedOrphan(): number {\n  return 1;\n}\n' > "$ORPHAN"
printf 'import { plantedOrphan } from "./planted-orphan";\nvoid plantedOrphan;\n' > "$ORPHAN_TEST"
out=$($GATE 2>&1); rc=$?
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qE "^test-only-module  $ORPHAN:1  "; then
  echo "  ok   red, naming $ORPHAN as test-only"
else
  echo "  FAIL: (B) did not fire (rc=$rc)"; printf '%s\n' "$out" | tail -3; fails=$((fails + 1))
fi
rm -f "$ORPHAN" "$ORPHAN_TEST"

echo "==> (1) restored: green again"
if out=$($GATE 2>&1); then echo "  ok   green"; else echo "$out" | tail -3; echo "  FAIL: not green after restore"; fails=$((fails + 1)); fi

[ "$fails" -eq 0 ] && echo "GUARDIAN DEAD-CODE GATE SELFTEST: PASS" || { echo "GUARDIAN DEAD-CODE GATE SELFTEST: FAIL ($fails)"; exit 1; }
