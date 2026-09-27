#!/usr/bin/env bash
# Self-test for exam-harness-isolation.sh: each rule turns red on a planted violation.
# @spec [E7b owner ruling 6] | @implemented [2026-09-25]
set -uo pipefail
GATE="$(cd "$(dirname "$0")" && pwd)/exam-harness-isolation.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/root/server" "$T/root/tests/e2e/exam-harness" "$T/dist"
echo 'export const ok = 1;' > "$T/root/server/a.ts"
echo 'console.log(1)' > "$T/dist/index.js"
bad=0
bash "$GATE" "$T/root" "$T/dist" >/dev/null 2>&1 || { echo "SELFTEST FAIL: clean tree should pass"; bad=1; }
echo 'import "../tests/e2e/exam-harness/server";' > "$T/root/server/b.ts"
bash "$GATE" "$T/root" "$T/dist" >/dev/null 2>&1 && { echo "SELFTEST FAIL: I1 plant not caught"; bad=1; } || echo "ok   [SELFTEST I1] a server import of the harness turns the gate red"
rm "$T/root/server/b.ts"
echo 'var m="exam e2e harness listening"' > "$T/dist/leak.js"
bash "$GATE" "$T/root" "$T/dist" >/dev/null 2>&1 && { echo "SELFTEST FAIL: I2 plant not caught"; bad=1; } || echo "ok   [SELFTEST I2] a harness marker in dist turns the gate red"
exit $bad
