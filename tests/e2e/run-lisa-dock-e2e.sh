#!/usr/bin/env bash
# =============================================================================
# The LISA chat dock's browser spec against the student harness (real routers, real database).
# =============================================================================
# @spec [owner ruling on #1300 (Karl, 2026-10-23): "Add the dock's browser tests
#        (tests/e2e/lisa-dock.spec.ts, plus the new ones) to CI ... no new dependencies"]
#        | @implemented [2026-10-23]
#
# plain English: starts the student harness server (tests/e2e/student-harness/server.ts) with the
# `lisa-dock` seed (review history, exam history, LISA history; it rebuilds its database from
# supabase/migrations on start), waits for its `student harness ready {...}` line and keeps that
# JSON as the manifest the spec reads, builds the client for production (the dev server's
# StrictMode double effects make the runner ask /next twice) and serves it with `vite preview`
# (which proxies /api to the harness, vite.config.ts), then runs the spec. Everything it started
# is stopped on exit. The same steps the spec's own header describes for a local run.
#
# Why a script and not inline CI YAML: starting the harness names its directory, and harness
# paths stay inside tests/ (the exam harness's I1 rule, scripts/ci/exam-harness-isolation.sh,
# which the student harness reuses through its module hooks).
#
# needs (the caller provides): Postgres reachable via PGHOST/PGPORT/PGUSER/PGPASSWORD with rights
# to CREATE DATABASE; Chromium for @playwright/test (E2E_CHROMIUM names one explicitly).
# env: HARNESS_PORT (default 5066), LISA_DOCK_PREVIEW_PORT (default 5184), LOG_DIR (default
# $RUNNER_TEMP or /tmp).
#
# usage: bash tests/e2e/run-lisa-dock-e2e.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

HARNESS_PORT="${HARNESS_PORT:-5066}"
PREVIEW_PORT="${LISA_DOCK_PREVIEW_PORT:-5184}"
LOG_DIR="${LOG_DIR:-${RUNNER_TEMP:-/tmp}}"
mkdir -p "$LOG_DIR"
SERVER_LOG="$LOG_DIR/lisa-dock-harness.log"
MANIFEST="$LOG_DIR/lisa-dock-manifest.json"
WEB="$LOG_DIR/lisa-dock-web"

pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

HARNESS_PORT="$HARNESS_PORT" NODE_ENV=development STUDENT_HARNESS_SEED=lisa-dock \
  nohup pnpm exec tsx --import ./tests/e2e/student-harness/register.mjs \
  tests/e2e/student-harness/server.ts > "$SERVER_LOG" 2>&1 &
pids+=("$!")

ready=0
for i in $(seq 1 300); do
  if grep -q '^student harness ready {' "$SERVER_LOG"; then
    grep '^student harness ready {' "$SERVER_LOG" | tail -1 | sed 's/^student harness ready //' > "$MANIFEST"
    echo "student harness (lisa-dock seed) ready after ${i}s"
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
  > "$LOG_DIR/lisa-dock-build.log" 2>&1 || { tail -n 40 "$LOG_DIR/lisa-dock-build.log"; exit 1; }

PORT="$HARNESS_PORT" VITE_SUPABASE_URL=http://localhost:9 VITE_SUPABASE_ANON_KEY=ci \
  nohup pnpm exec vite preview --outDir "$WEB" --port "$PREVIEW_PORT" --strictPort \
  > "$LOG_DIR/lisa-dock-preview.log" 2>&1 &
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
  pnpm exec playwright test tests/e2e/lisa-dock.spec.ts --forbid-only --reporter=list --workers=1 \
  || status=$?
if [ "$status" != 0 ]; then
  echo "---- student harness log (last 60 lines) ----"
  tail -n 60 "$SERVER_LOG"
fi
exit "$status"
