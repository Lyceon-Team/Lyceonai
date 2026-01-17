#!/bin/bash
# CI Guardrail: Check for raw SQL outside DAO layer
# Fails if FROM user tables are found outside apps/api/src/dao/

set -e

echo "🔍 Checking for raw SQL queries outside DAO layer..."
echo ""

# Tables that should only be accessed via DAOs
USER_TABLES=(
  "progress"
  "attempts"
  "practice_sessions"
  "exam_attempts"
  "notifications"
  "chat_messages"
  "memberships"
)

VIOLATIONS=0

for table in "${USER_TABLES[@]}"; do
  # Search for "FROM table" or "from table" outside the DAO directory
  # Exclude:
  # - apps/api/src/dao/ (DAO layer - allowed)
  # - tests/ (test files - allowed)
  # - node_modules/ (dependencies)
  # - .sql files (migrations)
  
  if grep -r --include="*.ts" --include="*.js" \
    --exclude-dir=node_modules \
    --exclude-dir=apps/api/src/dao \
    --exclude-dir=tests \
    -i "from $table" . 2>/dev/null | grep -v ".sql:"; then
    
    echo "❌ Found raw SQL for '$table' outside DAO layer!"
    ((VIOLATIONS++))
  fi
done

echo ""

if [ $VIOLATIONS -eq 0 ]; then
  echo "✅ PASS: No raw SQL found outside DAO layer"
  exit 0
else
  echo "💥 FAIL: Found $VIOLATIONS violation(s)"
  echo ""
  echo "All SQL queries for user tables must go through the DAO layer!"
  echo "Move queries to apps/api/src/dao/ and use req.dbRun()"
  exit 1
fi
