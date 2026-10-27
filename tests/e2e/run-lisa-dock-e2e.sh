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
#
# @updated 2026-10-26: the steps moved to run-student-harness-e2e.sh (shared with the
# smart landing spec); this keeps its name, its CI step and its LISA_DOCK_PREVIEW_PORT.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

PREVIEW_PORT="${LISA_DOCK_PREVIEW_PORT:-5184}" \
  exec bash tests/e2e/run-student-harness-e2e.sh lisa-dock tests/e2e/lisa-dock.spec.ts
