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
MIG8="supabase/migrations/20260922000000_seven_year_retention.sql"
MIG9="supabase/migrations/20260922010000_tutor_lapse_severance.sql"
RPOL="infra/retention-policy-registry.yaml"
YAMLLIB="scripts/ci/lib/minimal-yaml.ts"
SECRETGATE="scripts/ci/secret-class-inventory-check.ts"
SWEEP="server/services/retention-sweep.ts"
SCHEDTF="infra/terraform/cloud-scheduler.tf"
RETROUTE="server/routes/internal-retention-routes.ts"
OBSCFG="supabase/migrations/20260922020000_observability_retention_config.sql"
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
cp "$MIG8" "$BACKUP/mig8.sql"
cp "$MIG9" "$BACKUP/mig9.sql"
cp "$RPOL"       "$BACKUP/retention-policy-registry.yaml"
cp "$YAMLLIB"    "$BACKUP/minimal-yaml.ts"
cp "$SECRETGATE" "$BACKUP/secret-class-inventory-check.ts"
cp "$SWEEP"      "$BACKUP/retention-sweep.ts"
cp "$SCHEDTF"    "$BACKUP/cloud-scheduler.tf"
cp "$RETROUTE"   "$BACKUP/internal-retention-routes.ts"
cp "$OBSCFG"     "$BACKUP/observability_retention_config.sql"
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
  cp "$BACKUP/mig8.sql" "$MIG8"
  cp "$BACKUP/mig9.sql" "$MIG9"
  cp "$BACKUP/retention-policy-registry.yaml" "$RPOL"
  cp "$BACKUP/minimal-yaml.ts" "$YAMLLIB"
  cp "$BACKUP/secret-class-inventory-check.ts" "$SECRETGATE"
  cp "$BACKUP/retention-sweep.ts" "$SWEEP"
  cp "$BACKUP/cloud-scheduler.tf" "$SCHEDTF"
  cp "$BACKUP/internal-retention-routes.ts" "$RETROUTE"
  cp "$BACKUP/observability_retention_config.sql" "$OBSCFG"
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

# =============================================================================
# Seven-year payment-record retention (v3 §6.2 / SCL-101) — B2
# =============================================================================
# This sweep deletes nothing until 2033, so nobody would notice it broken from
# production behaviour alone. Its red proofs are the only thing standing between
# a published seven-year period and an unenforced one.
SUITE="tests/ci/financial-record-retention.pg.ci.test.ts"

echo "==> (M39) the seven-year window becomes seven NON-leap years"
# 2555 vs 2557: a plausible-looking off-by-two that a bare equality on a
# "roughly seven years" assertion would wave through.
plant M39 "$MIG8" "s.replace('  SELECT 2557;', '  SELECT 2555;', 1)"
expect_red M39 "B2.1 — the window is defined once, in SQL, and is seven years"

echo "==> (M40) the financial window collapses onto the 90-day one"
plant M40 "$MIG8" "s.replace('SELECT 2557;', 'SELECT public.operational_log_retention_days();', 1)"
expect_red M40 "B2.2 — the two windows are separate definitions, not one shared constant"

echo "==> (M41) deletion_billing_record ages on the wrong column"
plant M41 "$MIG8" "s.replace(\"['deletion_billing_record', 'cancelled_on'],\", \"['deletion_billing_record', 'final_status'],\", 1)"
expect_red M41 "B2.3 — a row past its window goes"

echo "==> (M42) the sweep stops emitting a row for a table it deleted nothing from"
plant M42 "$MIG8" "s.replace('    RETURN NEXT;', '    IF v_deleted > 0 THEN RETURN NEXT; END IF;', 1)"
expect_red M42 "B2.6 — a zero-row run still reports every table, with its cutoff"

echo "==> (M43) the sweep deletes newest-first instead of oldest-first"
plant M43 "$MIG8" "s.replace('ORDER BY t.%I ASC', 'ORDER BY t.%I DESC', 1)"
expect_red M43 "B2.7 — oldest goes first"

echo "==> (M44) the sweep becomes callable by authenticated"
plant M44 "$MIG8" "s.replace('GRANT EXECUTE ON FUNCTION public.sweep_financial_record_retention(integer)       TO service_role;', 'GRANT EXECUTE ON FUNCTION public.sweep_financial_record_retention(integer)       TO service_role, authenticated;', 1)"
expect_red M44 "B2.8 — the sweep is not callable by anon or authenticated"

# =============================================================================
# Tutor lapse severance (Doc 03 §14.2 / owner ruling C1) — the writer that makes
# Privacy Policy v4's seven-day line publishable.
# =============================================================================
# Every one of these mutations produces a mechanism that LOOKS like it works.
# That is the whole hazard: v3 could not publish the seven-day line because the
# writer was missing, and a writer that silently does the wrong thing is worse
# than a missing one.
SUITE="tests/ci/tutor-lapse-severance.pg.ci.test.ts"

echo "==> (M45) the lapse branch stops stamping deleted_at"
plant M45 "$MIG9" "s.replace('       SET deleted_at = now()', '       SET deleted_at = deleted_at', 1)"
expect_red M45 "C1.2 — a lapse stamps deleted_at"

echo "==> (M46) the restore branch stops clearing — returning students lose history"
plant M46 "$MIG9" "s.replace('       SET deleted_at = NULL', '       SET deleted_at = deleted_at', 1)"
expect_red M46 "C1.4 — resubscribing CLEARS the stamp (owner ruling C1)"

echo "==> (M47) the stamp is rewritten on every lapse, pushing the clock out forever"
plant M47 "$MIG9" "s.replace('       AND deleted_at IS NULL;', '       AND TRUE;', 1)"
expect_red M47 "C1.3 — FIRST LAPSE WINS: a second inactive transition does not move the clock"

echo "==> (M48) the trigger re-lists statuses instead of calling the canonical predicate"
# Double-quoted outer with escaped inner double quotes, like M34 and M41: the
# replacement text contains SQL single quotes, which a single-quoted shell
# string cannot carry.
plant M48 "$MIG9" "s.replace('v_active := public.entitlement_active(NEW.profile_id);', \"v_active := NEW.status IN ('active','past_due','trialing');\", 1)"
expect_red M48 "C1.8 — the trigger calls the canonical predicate, not a re-listed status set"

echo "==> (M49) the trigger watches the wrong column"
plant M49 "$MIG9" "s.replace('AFTER INSERT OR UPDATE OF status ON public.entitlements', 'AFTER INSERT OR UPDATE OF tier ON public.entitlements', 1)"
expect_red M49 "C1.7 — the predicate reads only status, which is what makes UPDATE OF status sufficient"

# =============================================================================
# Retention policy registry (Doc 06D §9.1 / owner ruling F1) — the file that
# makes a published period traceable to the thing that performs it.
# =============================================================================
# A registry is data, and data rots silently: no runtime touches it, so nothing
# fails when a number in it stops matching the SQL constant it describes. These
# mutations are the only thing standing between "documented schedule" and
# "documented schedule that nothing runs".
SUITE="tests/ci/retention-policy-registry.contract.test.ts"

echo "==> (M58) a registry horizon drifts off the SQL constant it describes"
plant M58 "$RPOL" 's.replace("    retention_horizon_seconds: 7776000        # 90 days\n    partial_provable_until: null\n    purge_substrate: scheduled_job\n    purge_lag_allowance_seconds: 86400        # one missed nightly run", "    retention_horizon_seconds: 15552000        # 90 days\n    partial_provable_until: null\n    purge_substrate: scheduled_job\n    purge_lag_allowance_seconds: 86400        # one missed nightly run", 1)'
expect_red M58 "F1.10 — the registry's horizons are the constants the mechanisms use"

echo "==> (M59) a citation points at a superseded policy version"
plant M59 "$RPOL" 's.replace("legal/privacy-policy/v4/en.md §6.7", "legal/privacy-policy/v3/en.md §6.7", 1)'
expect_red M59 "F1.8 — every policy citation points at the CURRENT published version"

echo "==> (M60) an alert id is filled in although the alert registry does not exist"
plant M60 "$RPOL" 's.replace("    purge_alert_id: null                      # see prerequisites", "    purge_alert_id: ALERT-RETENTION-NOTIF-01", 1)'
expect_red M60 "F1.12 — alert ids are null exactly while the alert registry is absent"

echo "==> (M61) a second row goes null-horizon with no forward-ref token"
plant M61 "$RPOL" 's.replace("    partial_provable_until: \x27FWD-07E-V1.1-CARDINALITY-BUCKETING\x27", "    partial_provable_until: null", 1)'
expect_red M61 "F1.7 — §9.3 (i): horizon XOR forward-ref, with the one gap pinned by name"

echo "==> (M62) Doc 07E's row is restated with our own substrate instead of consumed"
plant M62 "$RPOL" 's.replace("    purge_substrate: doc05d_cascade", "    purge_substrate: scheduled_job", 1)'
expect_red M62 "F1.11 — Doc 07E §6's two rows are consumed verbatim, not restated"

echo "==> (M63) the secret-class gate forks its own copy of the scalar parser again"
# Double-quoted outer with escaped inner double quotes, like M34/M41/M48: the
# anchor carries a quoted import path, which a single-quoted shell string
# cannot nest — bash closes the string early and the plant no-ops silently.
plant M63 "$SECRETGATE" "s.replace('import { parseYamlScalar } from \"./lib/minimal-yaml\";', 'function parseYamlScalar(raw: string): string { return raw.trim(); }', 1)"
expect_red M63 "F1.15 — no second copy of parseYamlScalar exists"

echo "==> (M64) the parser classifies before stripping the inline comment again"
plant M64 "$YAMLLIB" 's.replace("  const commentIdx = v.indexOf(\" #\");\n  const clean = commentIdx >= 0 ? v.slice(0, commentIdx).trim() : v;\n\n  if (clean === \"\" || clean === \"null\" || clean === \"~\") return null;", "  if (v === \"\" || v === \"null\" || v === \"~\") return null;\n  const commentIdx = v.indexOf(\" #\");\n  const clean = commentIdx >= 0 ? v.slice(0, commentIdx).trim() : v;\n", 1)'
expect_red M64 "F1.16 — an inline comment does not change a scalar's type"

# =============================================================================
# The BigQuery archive is gone (Doc 07B §5.4, owner ruling 2026-09-22) — and
# the 90d/180d tiers are scheduled for the first time.
# =============================================================================
# The archive was invisible for a month because "returns ok: false" and "is not
# scheduled" each explained the other. These mutations plant the two halves of
# that back and require the suite to say so.
SUITE="tests/ci/retention-sweep.negative-control.contract.test.ts"

echo "==> (M65) the 90d tier declines again instead of deleting"
plant M65 "$SWEEP" "s.replace('  const cutoff = retentionCutoff(opts.now, 90);', '  if (!process.env.BIGQUERY_ARCHIVE_DATASET) return { ok: false, tier: \"90d\", reason: \"archive_client_not_configured\" };\n  const cutoff = retentionCutoff(opts.now, 90);', 1)"
expect_red M65 "deletes with no archive configuration of any kind (Doc 07B §5.4 reversal)"

echo "==> (M66) an archive call comes back into the sweep module"
plant M66 "$SWEEP" "s.replace('  const cutoff = retentionCutoff(opts.now, 180);', '  const archiveTable = \"retention__crisis_review_cases\";\n  void archiveTable;\n  const cutoff = retentionCutoff(opts.now, 180);', 1)"
expect_red M66 "retention-sweep.ts references no archive, BigQuery, or warehouse path"

echo "==> (M67) the route builds an archive client again"
plant M67 "$RETROUTE" "s.replace('const router = Router();', 'const archiveDataset = process.env.BIGQUERY_ARCHIVE_DATASET;\nvoid archiveDataset;\nconst router = Router();', 1)"
expect_red M67 "the internal retention route constructs no archive client"

SUITE="tests/ci/retention-policy-publication.contract.test.ts"

echo "==> (M68) the 180d tier loses its schedule — a published period with nothing running it"
plant M68 "$SCHEDTF" "s.replace('resource \"google_cloud_scheduler_job\" \"retention_sweep_180d\" {', 'resource \"google_cloud_scheduler_job\" \"retention_sweep_180d_DISABLED\" {', 1).replace('      retention_tier = \"180d\"', '      retention_tier = \"7d\"', 1)"
expect_red M68 "the three runnable tiers are 7d, 90d and 180d"

echo "==> (M69) 365d gains a schedule although its tables do not exist"
plant M69 "$SCHEDTF" "s.replace('      retention_tier = \"90d\"', '      retention_tier = \"365d\"', 1)"
expect_red M69 "365d is NOT scheduled — its tables do not exist"

echo "==> (M70) two tiers share one request_id, so the second reads as a replay"
plant M70 "$SCHEDTF" "s.replace('7b2d9f30-5e41-4c88-b0a7-3d6f8c1e9042', '0f1c6c4e-6c8f-4a6d-9a3e-0b5a1d7c2e41', 1)"
expect_red M70 "each job carries its own request_id UUID (no cross-tier dedup)"

echo "==> (M71) a job's OIDC audience drifts off its target URI (a permanent, silent 401)"
plant M71 "$SCHEDTF" "s.replace('audience              = \"\${var.app_base_url}/api/internal/retention/sweep\"', 'audience              = \"\${var.app_base_url}/api/internal/retention/sweep/90d\"', 1)"
expect_red M71 "every job signs an OIDC token whose audience equals its target URI"

echo "==> (M72) a job runs in dry_run, so the schedule exists and deletes nothing"
plant M72 "$SCHEDTF" "s.replace('      dry_run        = false', '      dry_run        = true', 1)"
expect_red M72 "every job POSTs, runs dry_run = false, and pins Etc/UTC"

echo "==> (M73) the HCL gate is satisfied by a comment quoting the setting it lost"
# The M54 shape, one layer up: prove stripHclComments is what makes M72 bite.
plant M73 "$SCHEDTF" "s.replace('      dry_run        = false', '      # dry_run        = false', 1)"
expect_red M73 "every job POSTs, runs dry_run = false, and pins Etc/UTC"

echo "==> (M74) a new tier joins the route enum with no schedule and no no-op reason"
# The exact failure that hid for a month, in its general form: a tier the API
# accepts, that nothing ever calls. M68 catches it for a tier we know about;
# this catches the next one.
plant M74 "$RETROUTE" "s.replace('z.enum([\"7d\", \"90d\", \"180d\", \"365d\"])', 'z.enum([\"7d\", \"90d\", \"180d\", \"365d\", \"730d\"])', 1)"
expect_red M74 "every accepted tier is either scheduled or a documented no-op"

# =============================================================================
# The declared retention periods must equal the enforced ones (F2, Doc 01A A.5)
# =============================================================================
# observability_runtime_config is read by nothing. These rows are only as good as
# the assertions holding them to the functions that actually delete rows, so those
# assertions get the same treatment as everything else here.
SUITE="tests/ci/observability-retention-config.pg.ci.test.ts"

echo "==> (M75) the declared audit period drifts off the one the purge enforces"
plant M75 "$OBSCFG" "s.replace('to_jsonb(public.audit_logs_retention_days())', \"to_jsonb(999)\", 1)"
expect_red M75 "F2.2 — the declared audit period equals the one audit_logs_retention_days() enforces"

echo "==> (M76) the declared operational ceiling is typed as a literal instead of derived"
plant M76 "$OBSCFG" "s.replace('to_jsonb(public.operational_log_retention_days()),\n    \x27integer\x27', \"to_jsonb(120),\n    'integer'\", 1)"
expect_red M76 "F2.3 — the declared operational ceiling equals the one the sweep enforces"

echo "==> (M77) A.5's four audit tiers are seeded although three are neither published nor built"
plant M77 "$OBSCFG" "s.replace(\"      'security_and_administrative',\n      to_jsonb(public.audit_logs_retention_days())\", \"      'security_and_administrative',\n      to_jsonb(public.audit_logs_retention_days()),\n      'authentication', to_jsonb(90)\", 1)"
expect_red M77 "F2.2 — the declared audit period equals the one audit_logs_retention_days() enforces"

echo "==> (M78) cold_log_retention_days is pasted in from A.5 'for completeness'"
plant M78 "$OBSCFG" "s.replace(\"ON CONFLICT (key) DO NOTHING;\", \"  , ('cold_log_retention_days', to_jsonb(365), 'integer', NULL, NULL, 'Legal', 'A.5 launch value.', 'all')\nON CONFLICT (key) DO NOTHING;\", 1)"
expect_red M78 "F2.4 — cold_log_retention_days is NOT seeded: no cold archive exists"

echo "==> (M79) a row's value_type stops describing the jsonb it holds"
plant M79 "$OBSCFG" "s.replace(\"    'object', NULL, NULL, 'Legal',\", \"    'integer', NULL, NULL, 'Legal',\", 1)"
expect_red M79 "F2.6 — every seeded value_type matches the jsonb it holds"

echo "==> (M80) the seed overwrites an operator's tuned value on replay"
plant M80 "$OBSCFG" "s.replace('ON CONFLICT (key) DO NOTHING;', 'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;', 1)"
expect_red M80 "F2.7 — replaying the migration never overwrites an operator's value"

echo "==> (M81) the derivation is replaced by a literal that is correct TODAY"
# The one M75 cannot catch: 365 is what the function returns right now, so a
# hardcoded 365 passes every value comparison until the config behind the
# function changes. F2.8 asserts the derivation itself.
plant M81 "$OBSCFG" "s.replace('to_jsonb(public.audit_logs_retention_days())', \"to_jsonb(365)\", 1)"
expect_red M81 "F2.8 — each seeded value is DERIVED from its enforcing function, not typed"

echo "==> (29j) restored: the observability-config suite must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: observability-config suite not green after restore"; fails=1; else echo "  ok   observability-config suite green after restore"; fi

echo "==> (29i) restored: the sweep and publication suites must be green again"
SUITE="tests/ci/retention-sweep.negative-control.contract.test.ts"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: retention-sweep suite not green after restore"; fails=1; else echo "  ok   retention-sweep suite green after restore"; fi
SUITE="tests/ci/retention-policy-publication.contract.test.ts"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: retention-publication suite not green after restore"; fails=1; else echo "  ok   retention-publication suite green after restore"; fi

SUITE="tests/ci/retention-policy-registry.contract.test.ts"
echo "==> (29h) restored: the retention-registry suite must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: retention-registry suite not green after restore"; fails=1; else echo "  ok   retention-registry suite green after restore"; fi

SUITE="tests/ci/tutor-lapse-severance.pg.ci.test.ts"
echo "==> (29f) restored: the tutor-lapse suite must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: tutor-lapse suite not green after restore"; fails=1; else echo "  ok   tutor-lapse suite green after restore"; fi

SUITE="tests/ci/financial-record-retention.pg.ci.test.ts"
echo "==> (29e) restored: the financial-record suite must be green again"
again="$(run_suite)"
if printf '%s\n' "$again" | grep -q "^failed"; then echo "  FAIL: financial-record suite not green after restore"; fails=1; else echo "  ok   financial-record suite green after restore"; fi

SUITE="tests/ci/operational-log-retention.pg.ci.test.ts"
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
