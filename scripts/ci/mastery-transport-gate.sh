#!/usr/bin/env bash
# ============================================================================
# Mastery emission — REAL TRANSPORT gate (Phase 3 Step 3.1)
# ============================================================================
# The gap this closes: every pre-existing mastery test mocks the Supabase client.
# tests/ci/diagnostic.handler-pg.ci.test.ts vi.mocks BOTH clients and substitutes a
# node-pg adapter running as the `postgres` superuser, so PostgREST, the
# service_role identity, and the supabase-js query builder are all replaced. No
# test anywhere issued a real RPC. A 100%-failure production outage ran for seven
# weeks with every one of those tests green.
#
# This gate stands up the real transport:
#   Postgres (genesis + all migrations)
#     <- PostgREST, with anon/authenticated/service_role and a JWT secret
#       <- a path-shim proxy exposing PostgREST under /rest/v1 (the prefix
#          supabase-js appends), so the REAL supabase-js client can be used
#          unmodified
#         <- the REAL express handler, with NO vi.mock on any Supabase client
#
# Everything the mocked suite replaces is therefore exercised: supabase-js
# serialization, HTTP, PostgREST function resolution, JWT role mapping, and the
# GRANTs (apply_mastery_event is service_role-only; there is no authenticated grant).
#
# Requires: psql, postgrest, node/pnpm, standard PG* env. The shared lib refuses
# non-ephemeral hosts.
# ============================================================================
set -uo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

DB="${MASTERY_TRANSPORT_DB:-mastery_transport_ci}"
PGRST_PORT="${PGRST_PORT:-3999}"
# Test-only signing secret. PostgREST requires >= 32 chars for HS256.
JWT_SECRET="${MASTERY_TRANSPORT_JWT_SECRET:-lyceon-transport-gate-test-secret-0123456789}"
WORKDIR="$(mktemp -d)"
PGRST_PID=""

cleanup() {
  [ -n "$PGRST_PID" ] && kill "$PGRST_PID" 2>/dev/null
  rm -rf "$WORKDIR"
  drop_deletion_rehearsal_db "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v postgrest >/dev/null 2>&1 || {
  echo "FAIL: postgrest not on PATH — this gate needs the real transport, not a stub"
  exit 1
}

echo "==> provision DB (genesis + all migrations)"
setup_genesis_db "$DB" || { echo "FAIL: could not provision $DB"; exit 1; }

echo "==> create the PostgREST authenticator role and role grants"
# `authenticator` is the login role PostgREST connects as; it SETs ROLE to the
# role named in the JWT. The three Supabase roles already exist (created by the
# shared lib) but are NOLOGIN, exactly as in a real Supabase project.
psql -v ON_ERROR_STOP=1 -d "$DB" -q >/dev/null <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authenticator';
  END IF;
END \$\$;
GRANT anon, authenticated, service_role TO authenticator;
SQL

echo "==> start PostgREST on :$PGRST_PORT"
cat > "$WORKDIR/pgrst.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@${PGHOST}:${PGPORT}/${DB}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-port = ${PGRST_PORT}
CONF

postgrest "$WORKDIR/pgrst.conf" > "$WORKDIR/pgrst.log" 2>&1 &
PGRST_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${PGRST_PORT}/" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -fsS "http://localhost:${PGRST_PORT}/" >/dev/null 2>&1; then
  echo "FAIL: PostgREST did not become ready"
  tail -20 "$WORKDIR/pgrst.log"
  exit 1
fi
echo "    PostgREST ready"

echo "==> run the transport test against the real stack"
cd "$ROOT"
MASTERY_TRANSPORT_PGRST_URL="http://localhost:${PGRST_PORT}" \
MASTERY_TRANSPORT_JWT_SECRET="$JWT_SECRET" \
MASTERY_TRANSPORT_DB="$DB" \
  pnpm exec vitest run tests/ci/mastery-emission.transport.ci.test.ts
RC=$?

if [ $RC -ne 0 ]; then
  echo
  echo "--- PostgREST log (last 30 lines) ---"
  tail -30 "$WORKDIR/pgrst.log"
  echo "MASTERY TRANSPORT GATE: FAIL"
  exit $RC
fi

echo "MASTERY TRANSPORT GATE: PASS"
