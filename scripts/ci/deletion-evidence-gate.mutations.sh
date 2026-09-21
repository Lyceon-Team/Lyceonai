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
# Needs a Postgres reachable through PG* env (each suite bootstraps its own database from
# supabase/migrations). Runs four suites thirty-eight times between them; each run is ~2s on the CI
# service container.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SUITE="tests/ci/deletion-evidence-bundle.pg.ci.test.ts"
EXEC="server/lib/account-deletion-execute.ts"
MIG="supabase/migrations/20260917000000_deletion_evidence_bundle.sql"
MIG3="supabase/migrations/20260917100000_deletion_audit_actions.sql"
MIG2="supabase/migrations/20260917110000_deletion_suppression_outcome.sql"
MIG5="supabase/migrations/20260917120000_deletion_sweeps_and_config.sql"
DISPATCH="server/lib/notifications/dispatch.ts"
RECONSENT="server/services/email-reconsent-audit.ts"
MIGFK="supabase/migrations/20260917130000_declarative_fk_delete_actions.sql"
GUARD="scripts/ci/fk-delete-action-guard.sql"
MIG6="supabase/migrations/20260918000000_crisis_severance_and_verification.sql"
MIG7="supabase/migrations/20260921000000_operational_log_retention.sql"
JSON="/tmp/vitest-deletion-evidence-mutations.json"
BACKUP="$(mktemp -d)"
cp "$EXEC" "$BACKUP/exec.ts"
cp "$MIG"  "$BACKUP/mig.sql"
cp "$MIG3" "$BACKUP/mig3.sql"
cp "$MIG2" "$BACKUP/mig2.sql"
cp "$MIG5" "$BACKUP/mig5.sql"
cp "$DISPATCH" "$BACKUP/dispatch.ts"
cp "$RECONSENT" "$BACKUP/reconsent.ts"
cp "$MIGFK" "$BACKUP/migfk.sql"
cp "$GUARD" "$BACKUP/guard.sql"
cp "$MIG6" "$BACKUP/mig6.sql"
cp "$MIG7" "$BACKUP/mig7.sql"
# ONE restore covering every file any mutation below may touch, hoisted here so the trap is
# armed before the first plant. A per-block restore() would leave a mutation on disk if a later
# block redefined it.
restore() {
  cp "$BACKUP/exec.ts" "$EXEC"
  cp "$BACKUP/mig.sql" "$MIG"
  cp "$BACKUP/mig3.sql" "$MIG3"
  cp "$BACKUP/mig2.sql" "$MIG2"
  cp "$BACKUP/mig5.sql" "$MIG5"
  cp "$BACKUP/dispatch.ts" "$DISPATCH"
  cp "$BACKUP/reconsent.ts" "$RECONSENT"
  cp "$BACKUP/migfk.sql" "$MIGFK"
  cp "$BACKUP/guard.sql" "$GUARD"
  cp "$BACKUP/mig6.sql" "$MIG6"
  cp "$BACKUP/mig7.sql" "$MIG7"
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
[ "$count" -ge 10 ] || { echo "  FAIL: expected >= 10 passing tests at baseline, saw $count"; exit 1; }
echo "  ok   baseline green ($count tests)"

echo "==> (M1) remove ORDER BY profile_id from the executor's due-request select"
plant M1 "$EXEC" 's.replace(".order(\"profile_id\", { ascending: true })", "")'
expect_red M1 "C3.3 rank"

# Targets MIGFK, not MIG: migration 20260917130000 REPLACES execute_account_deletion_cascade to
# drop the steps the foreign keys now perform, so the cascade body lives there. Planting into the
# older copy would mutate a function that the pipeline immediately overwrites — the same way M9
# silently stopped biting when Phase 3 landed.
echo "==> (M2) write evidence rows inside the cascade transaction (shared xmin)"
# The consent rows, not the log rows: T3 re-stamps the log rows afterwards, which would hide
# the leak from a current-version xmin read; the consent rows are never touched after T1.
plant M2 "$MIGFK" 's.replace("    ON CONFLICT (actor_id) DO NOTHING;\n", "    ON CONFLICT (actor_id) DO NOTHING;\n    UPDATE public.deletion_consent_evidence SET minor = minor;\n", 1)'
expect_red M2 "C3.2 cross-universe xmin"

echo "==> (M3) touch a live student's consent row inside the guardian's cascade transaction"
plant M3 "$MIGFK" 's.replace("    ON CONFLICT (actor_id) DO NOTHING;\n", "    ON CONFLICT (actor_id) DO NOTHING;\n    UPDATE public.guardian_consent_requests SET guardian_email = guardian_email;\n", 1)'
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
# Targets MIG3: migration 20260917100000 REPLACES cancel_account_deletion and
# restore_account_deletion to add their audit rows, so it — not 20260917000000 — is where those
# bodies now live. This mutation silently stopped biting when Phase 3 landed and the gate read
# green while proving nothing; this harness is what caught it (2026-09-17).
plant M9 "$MIG3" 's.replace("SET status = \x27cancelled\x27, responded_on = (now() AT TIME ZONE \x27utc\x27)::date", "SET status = status")'
expect_red M9 "C3.5 cancelled"

echo "==> (M10) put actor_id on the billing record (the reverse map Doc 05E §3 Rule 2 forbids)"
plant M10 "$MIG" 's.replace("  cancelled_on                date NOT NULL,\n", "  cancelled_on                date NOT NULL,\n  actor_id                    uuid,\n", 1)'
expect_red M10 "B3.3 billing record structural"

echo "==> (M11) drop the ledger rewrite's table lock (concurrent cascade row could be lost)"
plant M11 "$MIG" 's.replace("  LOCK TABLE public.anonymized_actors IN ACCESS EXCLUSIVE MODE;\n", "", 1)'
expect_red M11 "C3.2 cross-universe xmin"

echo "==> (M12) swap the item-count branch: a build that always removes items"
plant M12 "$EXEC" 's.replace("} else if (sub.items.data.length <= 1) {", "} else if (sub.items.data.length < 1) {")'
expect_red M12 "B3.5 single-item subscription"

echo "==> (M13) copy the raw IP into the consent evidence (drop the §5.1 redaction)"
plant M13 "$MIG" 's.replace("         public.redact_evidence_ip(la.ip_address),\n", "         la.ip_address,\n", 1)'
expect_red M13 "C3.8 consent evidence"

# ===========================================================================
# PHASES 2 / 3 / 5 — same harness, second suite (owner brief 2026-09-17)
# ===========================================================================
# run_suite and expect_red read $SUITE at call time, so pointing it at the phases suite reuses
# the whole harness rather than forking a second copy of it. Every file these mutations touch is
# backed up and restored by the single hoisted restore() above.
SUITE="tests/ci/deletion-phases-235.pg.ci.test.ts"

echo "==> (0b) the phases suite must be green before planting"
base2="$(run_suite)"
if printf '%s\n' "$base2" | grep -q "^failed"; then
  echo "  FAIL: phases suite is not green before planting"
  printf '%s\n' "$base2" | sed 's/^/       | /'
  exit 1
fi
echo "  ok   phases baseline green ($(printf '%s\n' "$base2" | grep -c '^passed') tests)"

# THE ONE THAT MATTERS. The brief's §3: "Ordering is the whole design." A build that suppresses
# before the completion notice passes every other test in this file, and loses the one message
# confirming the deletion to the person who asked for it.
echo "==> (M14) the suppression call happens BEFORE the completion notice"
plant M14 "$EXEC" 's.replace("""        const completedAt = new Date().toISOString();
        try {""", """        const completedAt = new Date().toISOString();
        if (pending.log_id !== null) { await applyRequestedSuppression(admin, pending.log_id, recipientEmail, requestId); }
        try {""", 1)'
expect_red M14 "P2.1 the completion notice reaches the provider BEFORE"

echo "==> (M15) the address is suppressed although suppression_requested is false"
plant M15 "$EXEC" 's.replace("  if (!requested) return;", "  if (false) return;", 1)'
expect_red M15 "P2.2 the suppression call is made only when"

echo "==> (M16) the audit_logs guard silently swallows the mutation instead of refusing"
plant M16 "$MIG3" 's.replace("  RAISE EXCEPTION \x27Table % is append-only; UPDATE and DELETE are not permitted\x27, TG_TABLE_NAME;", "  RETURN NULL;", 1)'
expect_red M16 "P3.1 audit_logs refuses"

echo "==> (M17) profile_hard_deleted written WITH the deleted profile ids"
plant M17 "$MIG3" 's.replace("  SELECT NULL, NULL, \x27profile_hard_deleted\x27, NULL,", "  SELECT c.profile_id, c.profile_id, \x27profile_hard_deleted\x27, NULL,", 1)'
expect_red M17 "P3.5 profile_hard_deleted"

echo "==> (M18) the evidence sweep DELETES the row instead of stripping it"
plant M18 "$MIG5" 's.replace("  UPDATE public.deletion_request_log\n     SET subject_email = NULL, requester_email = NULL\n   WHERE log_id = ANY (v_ids);", "  DELETE FROM public.deletion_request_log WHERE log_id = ANY (v_ids);", 1)'
expect_red M18 "P5.1 a terminal row past 24 months"

echo "==> (M19) the evidence window is read as days instead of months"
plant M19 "$MIG5" 's.replace("make_interval(months => public.deletion_evidence_retention_months())", "make_interval(days => public.deletion_evidence_retention_months())", 1)'
expect_red M19 "P5.2 a row inside the window"

echo "==> (M20) a failed suppression is not recorded, so nothing is left to retry"
plant M20 "$EXEC" 's.replace("""  await recordSuppressionOutcome(admin, logId, "failed_manual", requestId);
}

/** The one writer""", """}

/** The one writer""", 1)'
expect_red M20 "P2.3 a suppression failure records"

echo "==> (M21) a sweep run that changed nothing stops saying so"
plant M21 "$EXEC" 's.replace("\"evidence_sweep_complete\",", "\"evidence_sweep_quiet\",", 1)'
expect_red M21 "P5.4 both sweeps log a run"

echo "==> (M22) the audit purge hardcodes 365 instead of reading the configured window"
plant M22 "$MIG3" 's.replace("  RETURN v_days;", "  RETURN 365;", 1)'
expect_red M22 "P5.5 the audit purge runs only through"

echo "==> (M23) the retry sweep never runs"
plant M23 "$EXEC" 's.replace("  await retryFailedSuppressions(admin, requestId);", "", 1)'
expect_red M23 "P2.4 the retry sweep re-attempts"

echo "==> (M24) the retry sweep re-suppresses an address that was already applied"
plant M24 "$EXEC" 's.replace("""    if (row.suppression_status === "applied") return false;""", "", 1)'
expect_red M24 "P2.4 the retry sweep re-attempts"

echo "==> (M25) clearing a suppression stops recording the re-consent"
plant M25 "$RECONSENT" 's.replace("    action: EMAIL_RECONSENT_ACTION,", "    action: \"unrecorded\",", 1)'
expect_red M25 "P2.5 clearing from account settings"

# ===========================================================================
# DECLARATIVE FK DELETE ACTIONS — third suite (owner brief 2026-09-17 step 4)
# ===========================================================================
# Same harness again, pointed at the FK suite. Two mutations, one per half of the
# redesign: the migration that fixes today's nine edges, and the guard that is
# supposed to catch the tenth.
SUITE="tests/ci/deletion-fk-actions.pg.ci.test.ts"

echo "==> (0c) the FK suite must be green before planting"
base3="$(run_suite)"
if printf '%s\n' "$base3" | grep -q "^failed"; then
  echo "  FAIL: FK suite is not green before planting"
  printf '%s\n' "$base3" | sed 's/^/       | /'
  exit 1
fi
echo "  ok   FK baseline green ($(printf '%s\n' "$base3" | grep -c '^passed') tests)"

# The migration half: drop one tutor edge from the list and it keeps its RESTRICT, which
# is exactly the prod defect — DELETE FROM profiles raises for anyone who used the tutor.
echo "==> (M26) tutor_conversations.student_id is left off the FK action list"
plant M26 "$MIGFK" "s.replace(\"      ('tutor_conversations','student_id','c'),\n\", '', 1)"
expect_red M26 "FK1 a profile with rows in all seven tutor tables"

# The guard half: this is the deliverable the brief calls the most important one. Put the
# hand-maintained list back — G1 enumerating named tables instead of the catalog — and the
# brand-new unclassified foreign key walks straight past it.
echo "==> (M27) the guard reads a hand-maintained table list instead of pg_constraint"
plant M27 "$GUARD" "s.replace(\"\"\"         AND ((tn.nspname = 'public' AND tgt.relname = 'profiles')
           OR (tn.nspname = 'auth'   AND tgt.relname = 'users'))\"\"\", \"\"\"         AND ((tn.nspname = 'public' AND tgt.relname = 'profiles')
           OR (tn.nspname = 'auth'   AND tgt.relname = 'users'))
         AND src.relname IN ('tutor_conversations','tutor_messages','practice_sessions','entitlements','guardian_links')\"\"\", 1)"
expect_red M27 "FK4 the guard reddens when a new FK arrives"

echo "==> (27c) restored: the FK suite must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: FK suite not green after restore"; fails=1; else echo "  ok   FK suite green after restore"; fi

# ===========================================================================
# PHASE 6 — crisis severance + the verification record (owner brief 2026-09-17)
# ===========================================================================
SUITE="tests/ci/deletion-phase-6.pg.ci.test.ts"

echo "==> (0d) the phase-6 suite must be green before planting"
base4="$(run_suite)"
if printf '%s\n' "$base4" | grep -q "^failed"; then
  echo "  FAIL: phase-6 suite is not green before planting"
  printf '%s\n' "$base4" | sed 's/^/       | /'
  exit 1
fi
echo "  ok   phase-6 baseline green ($(printf '%s\n' "$base4" | grep -c '^passed') tests)"

# The production blocker, planted: leave crisis_review_cases.student_id RESTRICT and the two
# accounts that cannot be deleted today stay undeletable.
echo "==> (M28) crisis_review_cases.student_id is left off the SET NULL list"
plant M28 "$MIG6" "s.replace(\"      ('crisis_review_cases',     'student_id'),\n\", '', 1)"
expect_red M28 "P6.1 a student with a crisis-flagged conversation"

# SET NULL on a NOT NULL column does not fail at migration time — it fails at DELETE time.
# Drop the nullability change and the fix becomes a different defect that still blocks deletion.
echo "==> (M29) the DROP NOT NULL is skipped, so SET NULL has nowhere to put the NULL"
plant M29 "$MIG6" "s.replace('ALTER TABLE public.crisis_review_cases     ALTER COLUMN student_id      DROP NOT NULL;', '', 1)"
expect_red M29 "P6.1 a student with a crisis-flagged conversation"

# THE CHOKEPOINT. Remove the trigger and the severance on crisis_review_cases.conversation_id
# is decoration: the value is recoverable from the denormalized copy with one join on case_id.
echo "==> (M30) the denormalized conversation_id copy is left intact"
plant M30 "$MIG6" "s.replace('  AFTER DELETE ON public.tutor_conversations', '  AFTER UPDATE ON public.tutor_conversations', 1)"
expect_red M30 "P6.2 the crisis case survives the deletion"

# The manifest hash must be DERIVED from the record, not stamped. A constant passes every
# other assertion in the file and proves nothing about the record's integrity.
echo "==> (M31) proof_manifest_ref is a constant instead of a digest of the record"
plant M31 "$MIG6" "s.replace(\"v_hash := 'sha256:' || encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');\", \"v_hash := 'sha256:constant';\", 1)"
expect_red M31 "P6.5 a verification record is written"

# The carve-out sweep must actually bite: if audit_logs keeps the dead profile uuid, the
# verification record is no longer the only place it survives.
echo "==> (M32) the audit_logs identity strip stops nulling target_profile_id"
plant M32 "$MIG3" "s.replace('       SET actor_profile_id  = NULL,\n           target_profile_id = NULL', '       SET actor_profile_id  = NULL,\n           target_profile_id = target_profile_id', 1)"
expect_red M32 "P6.6 the deleted profile's uuid survives ONLY on the evidence side"

# =============================================================================
# Operational-log retention (v3 §6.7 / SCL-101) — B1
# =============================================================================
# The catch-all sweep is the one gate here that guards a PUBLISHED sentence with
# no other enforcement behind it, so each of its assertions gets a mutation.
SUITE="tests/ci/operational-log-retention.pg.ci.test.ts"

echo "==> (M33) the retention window stops being 90 days"
plant M33 "$MIG7" "s.replace('  SELECT 90;', '  SELECT 3650;', 1)"
expect_red M33 "B1.1 — the window is defined once, in SQL, and is 90 days"

echo "==> (M34) rate_limit_ledger ages on updated_at instead of window_end"
plant M34 "$MIG7" "s.replace(\"['rate_limit_ledger',            'window_end'],\", \"['rate_limit_ledger',            'updated_at'],\", 1)"
expect_red M34 "B1.5 — each table ages on the column the migration names"

echo "==> (M35) the sweep stops emitting a row for a table it deleted nothing from"
plant M35 "$MIG7" "s.replace('    RETURN NEXT;', '    IF v_deleted > 0 THEN RETURN NEXT; END IF;', 1)"
expect_red M35 "B1.4 — a zero-row run still reports every table, with its cutoff"

echo "==> (M36) the sweep deletes newest-first instead of oldest-first"
plant M36 "$MIG7" "s.replace('ORDER BY t.%I ASC', 'ORDER BY t.%I DESC', 1)"
expect_red M36 "B1.7 — oldest goes first"

echo "==> (M37) the sweep becomes callable by authenticated"
plant M37 "$MIG7" "s.replace('GRANT EXECUTE ON FUNCTION public.sweep_operational_log_retention(integer) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.sweep_operational_log_retention(integer) TO service_role, authenticated;', 1)"
expect_red M37 "B1.8 — the sweep is not callable by anon or authenticated"

# SINGLE-quoted outer string: the mutation text contains `$2`, which bash would
# expand to the script's own second positional argument (empty, and fatal under
# `set -u`). Every other plant here is double-quoted because none of them names a
# shell variable; this one must not be.
echo "==> (M38) the per-table batch bound stops being honoured"
plant M38 "$MIG7" 's.replace("          LIMIT $2", "          LIMIT GREATEST($2 - 1, 0)", 1)'
expect_red M38 "B1.6 — the batch bound is per table, not per call"

echo "==> (29d) restored: the operational-log suite must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: operational-log suite not green after restore"; fails=1; else echo "  ok   operational-log suite green after restore"; fi

SUITE="tests/ci/deletion-phase-6.pg.ci.test.ts"
echo "==> (29c) restored: the phase-6 suite must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: phase-6 suite not green after restore"; fails=1; else echo "  ok   phase-6 suite green after restore"; fi

echo "==> (28) restored: the other two suites must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: phases suite not green after restore"; fails=1; else echo "  ok   phases suite green after restore"; fi
SUITE="tests/ci/deletion-evidence-bundle.pg.ci.test.ts"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: evidence suite not green after restore"; fails=1; else echo "  ok   evidence suite green after restore"; fi

if [ "$fails" -ne 0 ]; then echo "DELETION EVIDENCE GATE SELF-TEST: FAIL"; exit 1; fi
echo "DELETION EVIDENCE GATE SELF-TEST: PASS"
