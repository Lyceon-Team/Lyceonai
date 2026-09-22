#!/usr/bin/env bash
# ============================================================================
# Engine schema-types gate (STRUCTURAL 1)
# ============================================================================
# Validates that the schema-derived TS types match the columns in the genesis
# schema (scripts/ci/genesis-schema.expected.sql).
# Any phantom column in the TS types that doesn't exist in the schema is a
# COMPILE ERROR caught by this gate. Any schema column missing from the TS
# types is flagged.
#
# Covers two engines from one script (R3, 2026-09-21). Review was NOT given a
# second copy of this gate: the last review vertical died on code naming columns
# that do not exist, and a forked gate is how the two copies drift apart until
# one of them stops being run. Same checker, one more types file.
#
# This is a static check — no database required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXPECTED="$ROOT/scripts/ci/genesis-schema.expected.sql"
PRACTICE_TYPES="$ROOT/packages/shared/src/practice-schema.ts"
REVIEW_TYPES="$ROOT/packages/shared/src/review-table-schema.ts"

if [ ! -f "$EXPECTED" ]; then echo "FAIL: $EXPECTED not found"; exit 1; fi
for f in "$PRACTICE_TYPES" "$REVIEW_TYPES"; do
  if [ ! -f "$f" ]; then echo "FAIL: $f not found"; exit 1; fi
done

FAIL=0

check_table() {
  local table_name="$1"
  local type_name="$2"
  local types_file="$3"

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
  ts_cols=$(sed -n "/^export type $type_name = {/,/^};/p" "$types_file" \
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

check_table "questions"              "QuestionsRow"            "$PRACTICE_TYPES"
check_table "practice_sessions"      "PracticeSessionRow"      "$PRACTICE_TYPES"
check_table "practice_session_items" "PracticeSessionItemRow"  "$PRACTICE_TYPES"
check_table "review_sessions"        "ReviewSessionRow"        "$REVIEW_TYPES"
check_table "review_session_items"   "ReviewSessionItemRow"    "$REVIEW_TYPES"
check_table "review_schedule"        "ReviewScheduleRow"       "$REVIEW_TYPES"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "ENGINE SCHEMA-TYPES GATE: FAIL (phantom columns detected)"
  exit 1
fi

echo ""
echo "ENGINE SCHEMA-TYPES GATE: PASS"
