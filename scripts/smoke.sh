#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:5000}"
USER="${API_USER_TOKEN:-changeme}"

echo "🧪 SAT MVP Smoke Test"
echo "========================================"
echo "Base URL: $BASE"
echo ""

# Health Check
echo "1️⃣  Health Check"
echo "-------------------"
echo "Testing: GET /healthz"
HEALTH_RESPONSE=$(curl -fsS "$BASE/healthz" || echo '{"status":"error"}')
echo "$HEALTH_RESPONSE"
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi

# RAG Test
echo ""
echo "2️⃣  RAG Test"
echo "-------------------"
echo "Testing: POST /api/rag"
RAG_RESPONSE=$(curl -s -X POST "$BASE/api/rag" \
  -H "Authorization: Bearer $USER" \
  -H "Content-Type: application/json" \
  -d '{"query":"solve 2x+3=11","section":"Math","topK":5}')
echo "$RAG_RESPONSE"
if echo "$RAG_RESPONSE" | grep -q '"answer"'; then
    echo "✅ RAG passed"
else
    echo "❌ RAG failed"
    exit 1
fi

# Summary
echo ""
echo "========================================"
echo "✅ All MVP smoke tests passed!"
echo "========================================"
echo ""
echo "Test Results:"
echo "  ✓ Health check (/healthz)"
echo "  ✓ RAG endpoint (/api/rag)"
echo ""
