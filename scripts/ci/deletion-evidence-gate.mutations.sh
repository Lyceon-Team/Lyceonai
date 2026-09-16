#!/usr/bin/env bash
# =============================================================================
# deletion-evidence-bundle gate self-test — every assertion proven by a planted mutation
# =============================================================================
# @spec [owner brief 2026-09-16 "Deletion Vertical" DoD: "every new gate observed failing once
#        on the assertion it names; Test 3 fails when ORDER BY profile_id is removed";
#        plan v4 §1 rules 1-3; SCL-088] | @implemented [2026-09-16]
#
# A gate is worth exactly what its red proof is worth. This plants ONE mutation per assertion
# in tests/ci/deletion-evidence-bundle.pg.ci.test.ts — into the executor or the migration that
# the suite builds its throwaway database from — runs the suite, asserts that the NAMED test
# (and only a test with that name is checked) turned red, restores the file, and moves on.
# Baseline green is asserted first, and restoration is trap-guaranteed, so a crashed run cannot
# leave a mutation on disk.
#
# Needs a Postgres reachable through PG* env (the suite bootstraps its own database from
# supabase/migrations). Runs the suite twelve times; each run is ~2s on the CI service container.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SUITE="tests/ci/deletion-evidence-bundle.pg.ci.test.ts"
EXEC="server/lib/account-deletion-execute.ts"
MIG="supabase/migrations/20260917000000_deletion_evidence_bundle.sql"
JSON="/tmp/vitest-deletion-evidence-mutations.json"
BACKUP="$(mktemp -d)"
cp "$EXEC" "$BACKUP/exec.ts"
cp "$MIG"  "$BACKUP/mig.sql"
restore() { cp "$BACKUP/exec.ts" "$EXEC"; cp "$BACKUP/mig.sql" "$MIG"; }
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
[ "$count" -ge 10 ] || { echo "  FAIL: expected >= 10 passing tests at baseline, saw $count"; exit 1; }
echo "  ok   baseline green ($count tests)"

echo "==> (M1) remove ORDER BY profile_id from the executor's due-request select"
plant M1 "$EXEC" 's.replace(".order(\"profile_id\", { ascending: true })", "")'
expect_red M1 "C3.3 rank"

echo "==> (M2) write evidence rows inside the cascade transaction (shared xmin)"
# The consent rows, not the log rows: T3 re-stamps the log rows afterwards, which would hide
# the leak from a current-version xmin read; the consent rows are never touched after T1.
plant M2 "$MIG" 's.replace("    ON CONFLICT (actor_id) DO NOTHING;\n", "    ON CONFLICT (actor_id) DO NOTHING;\n    UPDATE public.deletion_consent_evidence SET minor = minor;\n", 1)'
expect_red M2 "C3.2 cross-universe xmin"

echo "==> (M3) touch a live student's consent row inside the guardian's cascade transaction"
plant M3 "$MIG" 's.replace("    ON CONFLICT (actor_id) DO NOTHING;\n", "    ON CONFLICT (actor_id) DO NOTHING;\n    UPDATE public.guardian_consent_requests SET guardian_email = guardian_email;\n", 1)'
expect_red M3 "C3.4 guardian pre-clear"

echo "==> (M4) give the log the genesis-style created_at timestamptz column"
plant M4 "$MIG" 's.replace("  suppression_requested boolean NOT NULL DEFAULT false\n", "  suppression_requested boolean NOT NULL DEFAULT false,\n  created_at timestamptz NOT NULL DEFAULT now()\n", 1)'
expect_red M4 "C3.1 structural"

echo "==> (M5) disable the reconciler (executing rows are never resolved)"
plant M5 "$EXEC" 's.replace("\"reconcile_deletion_log\"", "\"reconcile_deletion_log_disabled\"")'
expect_red M5 "C3.6 rolled-back cascade"

echo "==> (M6) cancel WITH proration"
plant M6 "$EXEC" 's.replace("{ prorate: false }", "{ prorate: true }")'
expect_red M6 "B3.1 Stripe"

echo "==> (M7) a Stripe failure no longer records failed_manual"
plant M7 "$EXEC" 's.replace("finalStatus: \"failed_manual\",", "finalStatus: \"none_active\",")'
expect_red M7 "B3.2 Stripe failure"

echo "==> (M8) copy the request row's free-text deletion_reason onto the log"
plant M8 "$MIG" 's.replace("  GET DIAGNOSTICS v_marked = ROW_COUNT;\n", "  GET DIAGNOSTICS v_marked = ROW_COUNT;\n  UPDATE public.deletion_request_log l SET denial_basis = adr.deletion_reason FROM public.account_deletion_requests adr WHERE adr.log_id = l.log_id AND l.log_id = ANY (p_log_ids);\n", 1)'
expect_red M8 "C3.7 no free text"

echo "==> (M9) cancel / restore stop closing the log row"
plant M9 "$MIG" 's.replace("SET status = '"'"'cancelled'"'"', responded_on = (now() AT TIME ZONE '"'"'utc'"'"')::date", "SET status = status")'
expect_red M9 "C3.5 cancelled"

echo "==> (M10) put actor_id on the billing record (the reverse map Doc 05E §3 Rule 2 forbids)"
plant M10 "$MIG" 's.replace("  cancelled_on           date NOT NULL,\n", "  cancelled_on           date NOT NULL,\n  actor_id               uuid,\n", 1)'
expect_red M10 "B3.3 billing record structural"

echo "==> (11) restored: baseline must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: suite not green after restore"; fails=1; else echo "  ok   green after restore"; fi

if [ "$fails" -ne 0 ]; then echo "DELETION EVIDENCE GATE SELF-TEST: FAIL"; exit 1; fi
echo "DELETION EVIDENCE GATE SELF-TEST: PASS"
