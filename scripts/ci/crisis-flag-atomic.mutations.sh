#!/usr/bin/env bash
# =============================================================================
# crisis-flag-atomic gate self-test — every assertion proven by a planted mutation
# =============================================================================
# @spec [owner ruling 2026-09-22 D1 ("one transaction or one RPC — with a test
#        that a forced failure after the flag write leaves nothing");
#        Doc-03_V3 §21.2/§21.3; WS-L8 Item 4b] | @implemented [2026-09-22]
#
# A gate is worth exactly what its red proof is worth. This plants ONE mutation per
# assertion into the migration the suite builds its throwaway database from, runs the
# suite, asserts that the NAMED test (and only a test with that name is checked) turned
# red, restores the file, and moves on. Baseline green is asserted first, and restoration
# is trap-guaranteed, so a crashed run cannot leave a mutation on disk.
#
# D1's own mutation is M1: it re-plants the PRE-D1 behaviour — the case insert's failure
# swallowed, the flag left standing — and requires D1.3 to notice. That is the ruling's
# test, observed failing on the thing it is about.
#
# Needs a Postgres reachable through PG* env; the suite bootstraps its own database from
# supabase/migrations. ~1s per run.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SUITE="tests/ci/crisis-flag-atomic.pg.ci.test.ts"
MIG="supabase/migrations/20260922100000_crisis_flag_atomic.sql"
SVC="server/services/crisis-review-queue.ts"
JSON="/tmp/vitest-crisis-flag-atomic-mutations.json"
BACKUP="$(mktemp -d)"
cp "$MIG" "$BACKUP/mig.sql"
cp "$SVC" "$BACKUP/svc.ts"

restore() {
  cp "$BACKUP/mig.sql" "$MIG"
  cp "$BACKUP/svc.ts" "$SVC"
}
trap 'restore; rm -rf "$BACKUP"' EXIT

fails=0

run_suite() {  # prints the suite's per-test verdicts as "<status>\t<name>" lines
  pnpm -s exec vitest run "$SUITE" --reporter=json --outputFile="$JSON" >/dev/null 2>&1 || true
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const f of r.testResults ?? []) for (const a of f.assertionResults ?? [])
      console.log(a.status + "\t" + a.title);
  ' "$JSON"
}

# plant <label> <file> <python-expression over s that returns the mutated text>
plant() {
  local label="$1" file="$2" expr="$3"
  python3 - "$file" "$expr" "$label" <<'PY'
import sys
path, expr, label = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
out = eval(expr, {"s": s})
if out == s:
    print(f"  FAIL: mutation {label} did not change {path} (anchor missing)"); sys.exit(2)
open(path, "w").write(out)
PY
}

expect_red() {  # $1 = mutation label, $2 = test-name prefix that must be red
  local label="$1" name="$2" verdicts
  verdicts="$(run_suite)"
  if printf '%s\n' "$verdicts" | grep -q "^failed	$name"; then
    echo "  ok   $label -> $name RED"
  else
    echo "  FAIL: $label did not redden $name"
    printf '%s\n' "$verdicts" | sed 's/^/       | /'
    fails=1
  fi
  restore
}

echo "==> (0) baseline must be green, or nothing below means anything"
base="$(run_suite)"
if printf '%s\n' "$base" | grep -q "^failed"; then
  echo "  FAIL: suite is not green before planting"; printf '%s\n' "$base" | sed 's/^/       | /'; exit 1
fi
count="$(printf '%s\n' "$base" | grep -c '^passed')"
if [ "$count" -lt 10 ]; then
  echo "  FAIL: expected >= 10 passing tests at baseline, saw $count"; exit 1
fi
echo "  ok   baseline green ($count tests)"

echo "==> (M1) the flag survives a failed case insert — the state D1 removes"
plant M1 "$MIG" "s.replace('      v_source := v_fallback;\n  END;', '      v_source := v_fallback;\n    WHEN foreign_key_violation THEN\n      RETURN jsonb_build_object(\x27case_id\x27, gen_random_uuid(), \x27sla_deadline\x27, v_deadline, \x27already_existed\x27, false, \x27persisted_source\x27, v_source);\n  END;', 1)"
expect_red M1 "D1.3 — a failure AFTER the flag write leaves NOTHING (the ruling's test)"

echo "==> (M2) the SLA window drifts off Doc 03 §21.3's published 48 hours"
plant M2 "$MIG" "s.replace('  SELECT 48;', '  SELECT 72;', 1)"
expect_red M2 "D1.1 — the SLA window is defined once, in SQL, and is 48 hours"

echo "==> (M3) a duplicate signal restarts the SLA clock"
plant M3 "$MIG" "s.replace(\"        FROM public.crisis_review_cases c\n       WHERE c.conversation_id = p_conversation_id\", \"        FROM public.crisis_review_cases c\n       WHERE c.conversation_id = p_conversation_id AND false OR c.conversation_id = p_conversation_id\", 1).replace(\"        'sla_deadline',     v_found_at,\", \"        'sla_deadline',     now() + make_interval(hours => 96),\", 1)"
expect_red M3 "D1.4 — a second signal returns the FIRST case and does not move its deadline"

echo "==> (M4) the schema-drift fallback widens beyond WS-L8 4b's two values"
plant M4 "$MIG" "s.replace(\"           WHEN 'infrastructure_failure'       THEN 'classifier_degraded'\", \"           WHEN 'infrastructure_failure'       THEN 'classifier_degraded'\n           WHEN 'signature'                    THEN 'model'\", 1)"
expect_red M4 "D1.9 — the fallback map has exactly the two values WS-L8 4b names"

echo "==> (M5) ANY check violation is swallowed instead of blocking the turn"
# D1.7 forces a violation on `category`, not on `source` — the narrow WS-L8 4b
# tolerance must not become a general one. Planting a source fallback does not
# express that (the retry carries the same bad category and still throws), so
# the mutation swallows the whole check_violation branch instead.
plant M5 "$MIG" "s.replace('    WHEN check_violation THEN\n      v_fallback := public.crisis_source_fallback(p_source);', \"    WHEN check_violation THEN\n      RETURN jsonb_build_object('case_id', gen_random_uuid(), 'sla_deadline', v_deadline, 'already_existed', false, 'persisted_source', v_source);\n      v_fallback := public.crisis_source_fallback(p_source);\", 1)"
expect_red M5 "D1.7 — a CHECK violation with no fallback still fails, and rolls the flag back"

echo "==> (M9) the WS-L8 4b fallback is not applied, so a newer source fails the turn"
plant M9 "$MIG" "s.replace('      v_source := v_fallback;\n  END;', '      RAISE;\n  END;', 1)"
expect_red M9 "D1.6 — a source newer than the CHECK constraint degrades, it does not fail (WS-L8 4b)"

echo "==> (M6) a missing conversation reports success again"
plant M6 "$MIG" "s.replace('  IF v_rows = 0 THEN', '  IF false THEN', 1)"
expect_red M6 "D1.8 — a conversation that does not exist fails instead of reporting success"

echo "==> (M7) the function is granted to authenticated"
plant M7 "$MIG" "s.replace('GRANT EXECUTE ON FUNCTION public.flag_conversation_for_crisis_review(uuid, uuid, text, uuid, numeric, text) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.flag_conversation_for_crisis_review(uuid, uuid, text, uuid, numeric, text) TO service_role, authenticated;', 1)"
expect_red M7 "D1.10 — the function is not callable by anon or authenticated"

echo "==> (M8) a TypeScript copy of the SLA constant comes back"
plant M8 "$SVC" "s.replace('// ── Types ─────────────────────────────────────────────────────────────', 'const SLA_HOURS = 48;\n\n// ── Types ─────────────────────────────────────────────────────────────', 1)"
expect_red M8 "D1.11 — no TypeScript copy of the SLA or the fallback map survives"

echo "==> (M10) the duplicate branch hardcodes case_status instead of reading the row"
# evaluateNotificationPolicy throttles on this value. A hardcoded 'open' would
# re-page on every signal while a human is already working the case — exactly
# the event the throttle exists for.
plant M10 "$MIG" "s.replace(\"        'case_status',      v_status,\n        'persisted_source', NULL\", \"        'case_status',      'open',\n        'persisted_source', NULL\", 1)"
expect_red M10 "D1.12 — case_status is read back from the row, not assumed"

echo "==> (1) restored: the suite must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then
  echo "  FAIL: suite not green after restore"; fails=1
else
  echo "  ok   suite green after restore"
fi

echo ""
if [ "$fails" -ne 0 ]; then
  echo "CRISIS FLAG ATOMIC GATE SELF-TEST: FAIL"; exit 1
fi
echo "CRISIS FLAG ATOMIC GATE SELF-TEST: PASS"
