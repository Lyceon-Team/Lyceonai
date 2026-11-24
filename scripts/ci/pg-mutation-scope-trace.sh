#!/usr/bin/env bash
# ============================================================================
# Scope trace: a scoped pg-mutations group's tests read only files in its computed dependencies.
# ============================================================================
# @spec [CI scope ruling (Karl, 2026-11-04): scope the media and marketing checks "to the right
#   files"] | @implemented [2026-11-04]
#
# plain English: scripts/ci/pg-mutation-scope.mjs skips a scoped group when a change touches none
# of its dependencies, which it computes by reading imports and path strings. Static reading
# cannot see a path built in pieces at run time, so this runs the group's tests (the ones its
# harness runs, every test included) under strace and fails if they read any repository file
# outside the computed set. Each scoped group runs this before its harness, so the scope is
# re-proved every time the group runs, which is every time one of its dependencies changes.
#
# Usage: bash scripts/ci/pg-mutation-scope-trace.sh <group>
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
GROUP="${1:?usage: pg-mutation-scope-trace.sh <group>}"

command -v strace >/dev/null 2>&1 || { echo "scope trace: strace is not installed (a trace not taken is not a pass)"; exit 1; }
mapfile -t TESTS < <(node scripts/ci/pg-mutation-scope.mjs tests "$GROUP") || exit 1
[ "${#TESTS[@]}" -gt 0 ] || { echo "scope trace: $GROUP names no test file"; exit 1; }

TRACE="$(mktemp /tmp/scope-trace.XXXX)"
trap 'rm -f "$TRACE"' EXIT
echo "scope trace: $GROUP: ${TESTS[*]}"
strace -f -qq -e trace=openat,open -o "$TRACE" pnpm exec vitest run "${TESTS[@]}" >/tmp/scope-trace-run.log 2>&1
RC=$?
if [ "$RC" != 0 ]; then
  echo "scope trace: $GROUP's tests are not green under the trace (exit $RC)"; tail -30 /tmp/scope-trace-run.log; exit 1
fi
node scripts/ci/pg-mutation-scope.mjs check-trace "$GROUP" "$TRACE"
