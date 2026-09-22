#!/usr/bin/env bash
# ============================================================================
# Doc 05F — route smoke against a DEPLOYED API (OWNER-RUN)
# ============================================================================
# @spec [Doc-05F_V1.0 §15 (API surface), §15.1 (launch, INV-08-18),
#        INV-08-20 (the streak carries no calendar_access check)]
# @implemented [2026-09-22]
#
# WHAT THIS IS. Three calls against a running deployment, to prove the §15
# surface answers for a real signed-in student after scripts/ops/calendar-prod-smoke.sql
# has generated their plan.
#
# THE AGENT DID NOT RUN THIS. It needs a bearer token only the owner can mint,
# and it POSTs a launch that creates a real practice session.
#
# HOW TO RUN
#   export CAL_API=https://<deployment-host>
#   export CAL_TOKEN=<the student`s Supabase access token>
#   bash scripts/ops/calendar-route-smoke.sh
#
# Optional: CAL_CLIENT_INSTANCE (default calendar-route-smoke) — the launch is
# called TWICE with the SAME value, which is what makes the second call a resume
# rather than a second session.
#
# WHAT IT PRINTS. Status codes and SHAPE — which keys came back, never the
# values. No question content, no session contents, no token. §18 keeps bodies
# out of logs and that applies to an operator script too.
#
# WHAT IT WRITES. One practice session on the first launch. The second launch
# writes nothing: §15.1 hands back the live session with resumed=true.
# ============================================================================
set -uo pipefail

API="${CAL_API:-}"
TOKEN="${CAL_TOKEN:-}"
INSTANCE="${CAL_CLIENT_INSTANCE:-calendar-route-smoke}"

if [ -z "$API" ] || [ -z "$TOKEN" ]; then
  echo "FAIL: set CAL_API and CAL_TOKEN first. See the header."
  exit 1
fi
command -v jq >/dev/null 2>&1 || { echo "FAIL: jq is required"; exit 1; }

PASS=0
FAIL=0
ok()   { echo "    PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "    FAIL  $1"; FAIL=$((FAIL+1)); }

# Prints the status on the first line and the body on the rest. The token goes in
# a header and is never echoed.
call() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" -w $'\n%{http_code}'
  else
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $TOKEN" -w $'\n%{http_code}'
  fi
}

split() {  # $1 = raw response -> sets STATUS and BODY
  STATUS="$(printf '%s' "$1" | tail -n1)"
  BODY="$(printf '%s' "$1" | sed '$d')"
}

keys() { printf '%s' "$1" | jq -r 'if type=="object" then (keys_unsorted | join(",")) else type end' 2>/dev/null || echo "(unparseable)"; }

echo "==> 1. GET /api/calendar"
split "$(call GET /api/calendar)"
echo "    status $STATUS   keys: $(keys "$BODY")"
[ "$STATUS" = "200" ] && ok "200" || bad "expected 200, got $STATUS"
CAL_STATUS="$(printf '%s' "$BODY" | jq -r '.status // "(absent)"')"
echo "    status field: $CAL_STATUS"
if [ "$CAL_STATUS" = "ready" ]; then
  ok "status is \"ready\" — the plan generated"
elif [ "$CAL_STATUS" = "setup_required" ]; then
  bad "status is \"setup_required\" — calendar-prod-smoke.sql has not been run for this account"
else
  bad "status field is \"$CAL_STATUS\", expected ready"
fi
echo "    days: $(printf '%s' "$BODY" | jq -r '.days | length // 0' 2>/dev/null)"

echo ""
echo "==> 2. GET /api/me/streak  (INV-08-20: no calendar_access check)"
split "$(call GET /api/me/streak)"
echo "    status $STATUS   keys: $(keys "$BODY")"
[ "$STATUS" = "200" ] && ok "200 without an entitlement gate" || bad "expected 200, got $STATUS"
printf '%s' "$BODY" | jq -e 'has("current") and has("longest") and has("history_complete")' >/dev/null 2>&1 \
  && ok "carries current / longest / history_complete" \
  || bad "missing one of current / longest / history_complete"

echo ""
echo "==> 3. POST /api/calendar/blocks/:id/launch  (today's first practice block)"
# Re-read the calendar to pick today's first practice block: step 2 overwrote BODY.
split "$(call GET /api/calendar)"
TODAY="$(printf '%s' "$BODY" | jq -r '.days[0].local_date // empty')"
BLOCK_ID="$(printf '%s' "$BODY" | jq -r '[.days[0].blocks[]? | select(.block.block_type=="practice")][0].block.block_id // empty')"
if [ -z "$BLOCK_ID" ]; then
  bad "no practice block on $TODAY to launch — nothing to prove, stopping"
else
  echo "    date $TODAY   block ${BLOCK_ID:0:8}…"
  LAUNCH_BODY="{\"client_instance_id\":\"$INSTANCE\",\"platform\":\"web\"}"

  split "$(call POST "/api/calendar/blocks/$BLOCK_ID/launch" "$LAUNCH_BODY")"
  echo "    first  status $STATUS   keys: $(keys "$BODY")"
  [ "$STATUS" = "200" ] && ok "first launch 200" || bad "first launch expected 200, got $STATUS"
  ENGINE="$(printf '%s' "$BODY" | jq -r '.engine // empty')"
  SESSION1="$(printf '%s' "$BODY" | jq -r '.session_id // empty')"
  NEXT1="$(printf '%s' "$BODY" | jq -r '.next // empty')"
  [ "$ENGINE" = "practice" ] && ok "engine is practice" || bad "engine is \"$ENGINE\""
  [ -n "$SESSION1" ] && ok "session_id present" || bad "no session_id"
  [ -n "$NEXT1" ] && ok "next present ($NEXT1)" || bad "no next"

  # INV-08-18. The SAME client_instance_id, so this must resume, not create.
  split "$(call POST "/api/calendar/blocks/$BLOCK_ID/launch" "$LAUNCH_BODY")"
  echo "    second status $STATUS   keys: $(keys "$BODY")"
  SESSION2="$(printf '%s' "$BODY" | jq -r '.session_id // empty')"
  RESUMED="$(printf '%s' "$BODY" | jq -r '.resumed // empty')"
  [ "$STATUS" = "200" ] && ok "second launch 200" || bad "second launch expected 200, got $STATUS"
  if [ -n "$SESSION1" ] && [ "$SESSION1" = "$SESSION2" ]; then
    ok "same session_id — one session, not two (INV-08-18)"
  else
    bad "session_id CHANGED between launches: a second session was created"
  fi
  [ "$RESUMED" = "true" ] && ok "resumed=true" || bad "resumed=\"$RESUMED\", expected true"
fi

echo ""
echo "================================"
echo " PASS $PASS    FAIL $FAIL"
echo "================================"
[ "$FAIL" -eq 0 ] || exit 1
