#!/usr/bin/env bash
# =============================================================================
# One browser spec against the student harness (real routers, real database), with one seed.
# =============================================================================
# @spec [owner ruling on #1300 (Karl, 2026-10-23): the dock's browser tests in CI, "no new
#        dependencies"; owner change "Smart landing: replacing the multi-section sets" (Karl,
#        2026-10-26) item 4: "an end-to-end test that opens the set_math_5 session and the 5 more
#        session in the real session page and reaches question 1"] | @implemented [2026-10-26]
#
# plain English: starts the student harness server (tests/e2e/student-harness/server.ts) with the
# given seed (it rebuilds its database from supabase/migrations on start), waits for its `student
# harness ready {...}` line and keeps that JSON as the manifest the spec reads, builds the client
# for production (the dev server's StrictMode double effects make the runner ask /next twice) and
# serves it with `vite preview` (which proxies /api to the harness, vite.config.ts), then runs the
# spec. Everything it started is stopped on exit, whole process groups. Extracted from
# run-lisa-dock-e2e.sh (which now calls this with its own seed, spec and port); the one change is
# that stop.
#
# Why a script and not inline CI YAML: starting the harness names its directory, and harness
# paths stay inside tests/ (the exam harness's I1 rule, scripts/ci/exam-harness-isolation.sh,
# which the student harness reuses through its module hooks).
#
# needs (the caller provides): Postgres reachable via PGHOST/PGPORT/PGUSER/PGPASSWORD with rights
# to CREATE DATABASE; Chromium for @playwright/test (E2E_CHROMIUM names one explicitly).
# env: HARNESS_PORT (default 5066), PREVIEW_PORT (default 5184), LOG_DIR (default $RUNNER_TEMP or
# /tmp).
#
# usage: bash tests/e2e/run-student-harness-e2e.sh <seed> <spec path>
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

SEED="${1:?usage: run-student-harness-e2e.sh <seed> <spec path>}"
SPEC="${2:?usage: run-student-harness-e2e.sh <seed> <spec path>}"
HARNESS_PORT="${HARNESS_PORT:-5066}"
PREVIEW_PORT="${PREVIEW_PORT:-5184}"
LOG_DIR="${LOG_DIR:-${RUNNER_TEMP:-/tmp}}"
mkdir -p "$LOG_DIR"
SERVER_LOG="$LOG_DIR/${SEED}-harness.log"
MANIFEST="$LOG_DIR/${SEED}-manifest.json"
WEB="$LOG_DIR/${SEED}-web"

# Each background service runs in its own session (setsid), so stopping it stops the whole
# process group: `pnpm exec` starts node under it, and killing pnpm alone left the harness server
# holding its database, which made the next run in the same shell (the planted-defect run after
# the baseline) fail to rebuild it.
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  done
}
trap cleanup EXIT

HARNESS_PORT="$HARNESS_PORT" NODE_ENV=development STUDENT_HARNESS_SEED="$SEED" \
  setsid nohup pnpm exec tsx --import ./tests/e2e/student-harness/register.mjs \
  tests/e2e/student-harness/server.ts > "$SERVER_LOG" 2>&1 &
pids+=("$!")

ready=0
for i in $(seq 1 300); do
  if grep -q '^student harness ready {' "$SERVER_LOG"; then
    grep '^student harness ready {' "$SERVER_LOG" | tail -1 | sed 's/^student harness ready //' > "$MANIFEST"
    echo "student harness ($SEED seed) ready after ${i}s"
    ready=1
    break
  fi
  if ! kill -0 "${pids[0]}" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "the student harness did not come up:"
  tail -n 80 "$SERVER_LOG"
  exit 1
fi

PORT="$HARNESS_PORT" VITE_SUPABASE_URL=http://localhost:9 VITE_SUPABASE_ANON_KEY=ci \
  NODE_ENV=production pnpm exec vite build --outDir "$WEB" --emptyOutDir \
  > "$LOG_DIR/${SEED}-build.log" 2>&1 || { tail -n 40 "$LOG_DIR/${SEED}-build.log"; exit 1; }

PORT="$HARNESS_PORT" VITE_SUPABASE_URL=http://localhost:9 VITE_SUPABASE_ANON_KEY=ci \
  setsid nohup pnpm exec vite preview --outDir "$WEB" --port "$PREVIEW_PORT" --strictPort \
  > "$LOG_DIR/${SEED}-preview.log" 2>&1 &
pids+=("$!")
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:${PREVIEW_PORT}/"; then
    echo "vite preview up after ${i}s"
    break
  fi
  sleep 1
done

status=0
E2E_BASE_URL="http://localhost:${PREVIEW_PORT}" STUDENT_HARNESS_MANIFEST_FILE="$MANIFEST" \
  pnpm exec playwright test "$SPEC" --forbid-only --reporter=list --workers=1 \
  || status=$?
if [ "$status" != 0 ]; then
  echo "---- student harness log (last 60 lines) ----"
  tail -n 60 "$SERVER_LOG"
fi
exit "$status"
