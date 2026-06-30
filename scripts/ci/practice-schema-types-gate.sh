#!/usr/bin/env bash
# ============================================================================
# Practice schema-types gate (STRUCTURAL 1)
# ============================================================================
# Validates that packages/shared/src/practice-schema.ts type definitions
# match the columns in the genesis schema (scripts/ci/genesis-schema.expected.sql).
# Any phantom column in the TS types that doesn't exist in the schema is a
# COMPILE ERROR caught by this gate. Any schema column missing from the TS
# types is flagged.
#
# This is a static check — no database required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXPECTED="$ROOT/scripts/ci/genesis-schema.expected.sql"
TYPES_FILE="$ROOT/packages/shared/src/practice-schema.ts"

if [ ! -f "$EXPECTED" ]; then echo "FAIL: $EXPECTED not found"; exit 1; fi
if [ ! -f "$TYPES_FILE" ]; then echo "FAIL: $TYPES_FILE not found"; exit 1; fi

FAIL=0

check_table() {
  local table_name="$1"
  local type_name="$2"

  echo "==> checking $type_name against $table_name"

  # Extract columns from genesis schema (pg_dump CREATE TABLE format)
  local schema_cols
  schema_cols=$(sed -n "/^CREATE TABLE public\.$table_name (/,/^);/p" "$EXPECTED" \
    | grep -E '^\s+\w+ ' \
    | grep -vE '^\s+CONSTRAINT ' \
    | awk '{print $1}' \
    | sort)

  # Extract field names from TS type definition
  local ts_cols
  ts_cols=$(sed -n "/^export type $type_name = {/,/^};/p" "$TYPES_FILE" \
    | grep -E '^\s+\w+[:?]' \
    | sed 's/^\s*//; s/[:?].*//' \
    | sort)

  # Compare
  local only_schema only_ts
  only_schema=$(comm -23 <(echo "$schema_cols") <(echo "$ts_cols"))
  only_ts=$(comm -13 <(echo "$schema_cols") <(echo "$ts_cols"))

  if [ -n "$only_schema" ]; then
    echo "  WARN: columns in schema but missing from $type_name:"
    echo "$only_schema" | sed 's/^/    /'
  fi

  if [ -n "$only_ts" ]; then
    echo "  FAIL: fields in $type_name but NOT in schema (phantom columns):"
    echo "$only_ts" | sed 's/^/    /'
    FAIL=1
  fi

  if [ -z "$only_schema" ] && [ -z "$only_ts" ]; then
    echo "    OK exact match"
  elif [ -z "$only_ts" ]; then
    echo "    OK no phantom columns (some schema columns intentionally omitted)"
  fi
}

check_table "questions" "QuestionsRow"
check_table "practice_sessions" "PracticeSessionRow"
check_table "practice_session_items" "PracticeSessionItemRow"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "PRACTICE SCHEMA-TYPES GATE: FAIL (phantom columns detected)"
  exit 1
fi

echo ""
echo "PRACTICE SCHEMA-TYPES GATE: PASS"
