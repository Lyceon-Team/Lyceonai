#!/usr/bin/env bash
# =============================================================================
# The exam + calendar browser specs against the E7b exam harness, one fresh database each.
# =============================================================================
# @spec [n/a — e2e CI tooling; owner decision 2026-10-07, CI audit item 6: the four specs below
#        ran in no CI job and must run nightly] | @implemented [2026-10-07]
#
# plain English: for each spec, (re)starts the exam harness server (tests/e2e/exam-harness), which
# drops and rebuilds its database from supabase/migrations on start, waits until it answers, then
# runs that spec. A fresh database per spec because the four share one student, the exam allows
# one live sitting per student, and exam-shell needs both forms "Not started": a sitting left by
# one spec would fail the next for a reason that is not the next spec's. Every spec runs even when
# an earlier one fails (a nightly run reports all four); the script exits non-zero if any failed.
#
# Why a script and not inline CI YAML: scripts/ci/exam-harness-isolation.sh (I1) fails if any file
# outside tests/ names the harness directory, and starting the harness has to name it.
#
# needs (the caller provides): Postgres reachable via PGHOST/PGPORT/PGUSER/PGPASSWORD with
# rights to CREATE DATABASE; the client (Vite) up at E2E_BASE_URL, proxying /api to
# localhost:$HARNESS_PORT (vite.config.ts reads PORT); Chromium for @playwright/test.
# env: HARNESS_PORT (default 5055), LOG_DIR (default $RUNNER_TEMP or /tmp), plus whatever the
# specs read (E2E_BASE_URL, E2E_SHOT_DIR, E2E_DESMOS_STUB, E2E_CHROMIUM).
#
# usage: bash tests/e2e/run-exam-calendar-e2e.sh [spec ...]   (default: the four below)
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

HARNESS_PORT="${HARNESS_PORT:-5055}"
export HARNESS_PORT
LOG_DIR="${LOG_DIR:-${RUNNER_TEMP:-/tmp}}"
SERVER=tests/e2e/exam-harness/server.ts

if [ "$#" -gt 0 ]; then
  SPECS=("$@")
else
  SPECS=(
    tests/e2e/exam-shell.spec.ts
    tests/e2e/exam-desmos.spec.ts
    tests/e2e/exam-disclosure.spec.ts
    tests/e2e/calendar-full-length.spec.ts
  )
fi

stop_harness() {
  pkill -f "$SERVER" || true
  for _ in $(seq 1 30); do
    if ! curl -s -o /dev/null "http://localhost:${HARNESS_PORT}/"; then return 0; fi
    sleep 1
  done
  echo "the previous harness still holds :${HARNESS_PORT}"
  return 1
}
trap stop_harness EXIT

failed=()
for spec in "${SPECS[@]}"; do
  stop_harness || exit 1
  log="$LOG_DIR/exam-harness-$(basename "$spec" .spec.ts).log"
  nohup pnpm exec tsx --import ./tests/e2e/exam-harness/register.mjs "$SERVER" > "$log" 2>&1 &
  up=0
  for i in $(seq 1 180); do
    if curl -sf -o /dev/null "http://localhost:${HARNESS_PORT}/api/profile"; then
      echo "exam harness (fresh database) up after ${i}s for $spec"
      up=1
      break
    fi
    sleep 1
  done
  if [ "$up" != 1 ]; then
    echo "exam harness did not come up for $spec:"
    cat "$log"
    exit 1
  fi
  if ! pnpm exec playwright test "$spec" --forbid-only --reporter=list --workers=1; then
    failed+=("$spec")
    echo "---- harness log for $spec (last 50 lines) ----"
    tail -n 50 "$log"
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "all ${#SPECS[@]} specs passed"
