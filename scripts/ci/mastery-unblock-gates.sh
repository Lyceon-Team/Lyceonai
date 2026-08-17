#!/usr/bin/env bash
# ============================================================================
# Mastery-unblock migration gate — 20260816000000 + 20260816010000
# ============================================================================
# Proves, against a throwaway Postgres carrying genesis + every migration, that
# the two unblock migrations do what they claim and refuse what they should.
#
# The sequencing IS the test. Each case provisions a DB at the state that
# existed just BEFORE the migration under test (setup_genesis_db's stop_before
# cutoff), seeds the pre-state, asserts the failure is real, applies the single
# migration, then asserts the fix. A gate that only ever sees the post-migration
# schema cannot tell a working constraint from a constraint that was always
# there — that is the hollow-test failure mode this suite exists to avoid.
#
# Cases:
#   (A) repair + seal        — 3 repairable rows fixed, 2 legitimate NULLs
#                              untouched (negative control), constraint rejects
#                              the write it accepted pre-migration, and the
#                              backfill log names exactly the repaired rows
#   (A2) EXACT-TARGET HASH    — the target_set_hash construction in
#                              1.1-pre-apply.sql and the backfill_set_hash
#                              construction in 1.1-post-apply.sql produce the
#                              SAME value for the same set. This is the property
#                              the whole production exact-target proof rests on;
#                              if the two constructions ever diverge the operator
#                              would see a mismatch and wrongly conclude the wrong
#                              rows were repaired.
#   (A3) PINNED LITERAL      — both prod-verify files actually assert against the
#                              pinned constant in _target-set-hash.psql. A wrong
#                              literal must red both; the right one must pass both.
#                              Without this the constant could be inert and every
#                              run would report OK no matter what was pinned.
#   (B) unrepairable guard   — resolved row with NULL occurred_at AND NULL
#                              answered_at aborts with PSI_BACKFILL_UNREPAIRABLE
#   (C) scope-expansion guard— 43 repairable rows abort with
#                              PSI_BACKFILL_SCOPE_EXPANDED
#   (D) portability          — the migration applies cleanly to a FRESH database
#                              where the repairable count is 0. This is the
#                              regression test for the hardcoded-count blocker:
#                              an environment-specific fact inside a migration
#                              reds every fresh apply.
#   (E) domain pre-check     — a non-canonical (section, domain) row aborts
#                              1.2 with CANONICAL_DOMAIN_VIOLATION
#   (F) domain post-state    — both constraints present; hyphenated and
#                              cross-section pairs rejected; canonical accepted
#
# Connection via standard PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD). Defaults to
# a local cluster on :5432. The shared lib refuses non-ephemeral hosts.
# ============================================================================
set -uo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
# Migrations emit a large volume of NOTICE-level CI-guard chatter. Assertions in
# this gate raise EXCEPTION, so warnings and above are all we need to see.
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

FIXTURE="$SCRIPT_DIR/mastery-unblock-gates.sql"
M_BACKFILL="20260816000000_psi_occurred_at_backfill_and_seal.sql"
M_DOMAIN="20260816010000_canonical_domain_checks.sql"

[ -f "$FIXTURE" ] || { echo "FAIL: fixture not found ($FIXTURE)"; exit 1; }

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() {
  for db in mastery_unblock_a mastery_unblock_b mastery_unblock_c mastery_unblock_d mastery_unblock_e mastery_unblock_f; do
    drop_deletion_rehearsal_db "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# (A) repair + seal, with the negative control
# ---------------------------------------------------------------------------
echo "==> (A) repair + seal"
if ! setup_genesis_db mastery_unblock_a "$M_BACKFILL"; then
  fail A "could not provision DB at pre-migration state"
else
  psql -v ON_ERROR_STOP=1 -d mastery_unblock_a -q -v seed_repairable=1 -f "$FIXTURE" >/dev/null 2>&1 \
    || fail A "seed failed"
  if ! psql -v ON_ERROR_STOP=1 -d mastery_unblock_a -q -v assert_pre=1 -f "$FIXTURE" >/dev/null 2>&1; then
    fail A "pre-state assertions failed (constraint already present, or unconstrained write refused)"
  fi
  # Capture the pre-apply target hash using the EXACT expression from
  # scripts/prod-verify/1.1-pre-apply.sql, before the repair makes the target
  # set unrecoverable.
  PRE_HASH="$(psql -tAq -d mastery_unblock_a -c "
    WITH target_set AS (
      SELECT id FROM public.practice_session_items
       WHERE status IN ('answered','skipped')
         AND occurred_at IS NULL
         AND answered_at IS NOT NULL
       ORDER BY id
    )
    SELECT encode(extensions.digest(
             COALESCE(string_agg(id::text, ',' ORDER BY id), ''), 'sha256'), 'hex')
      FROM target_set;" 2>/dev/null)"

  # (A3) pre-apply half — MUST run while the repairable set still exists. After the
  # migration the set is empty and 1.1-pre-apply would hash nothing, so these probes
  # would compare against the empty-set hash and prove nothing.
  #
  # Asserts the target_set_hash_matches COLUMN, not the verdict string. The verdict
  # checks the count before the hash, and this fixture has 3 repairable rows rather
  # than production's 42, so the count branch short-circuits first and the hash STOP
  # is unreachable here. That ordering is correct for prod — where the count passes
  # and the hash branch is live — so the column, which carries the same comparison,
  # is what this gate can honestly assert against.
  #
  # Field 11 of the pre-apply result row is target_set_hash_matches.
  A3_PRE_OK="$(psql -tAq -F'|' -d mastery_unblock_a -v expected_target_set_hash="$PRE_HASH" \
                 -f "$ROOT/scripts/prod-verify/1.1-pre-apply.sql" 2>/dev/null \
               | awk -F'|' 'NF>=11 && $9 ~ /^[0-9a-f]{64}$/ {print $11; exit}')"
  A3_PRE_BAD="$(psql -tAq -F'|' -d mastery_unblock_a -v expected_target_set_hash="deadbeef${PRE_HASH:8}" \
                 -f "$ROOT/scripts/prod-verify/1.1-pre-apply.sql" 2>/dev/null \
               | awk -F'|' 'NF>=11 && $9 ~ /^[0-9a-f]{64}$/ {print $11; exit}')"

  if ! apply_migration mastery_unblock_a "$M_BACKFILL" >/dev/null 2>&1; then
    fail A "migration failed to apply to the seeded pre-state"
  elif ! psql -v ON_ERROR_STOP=1 -d mastery_unblock_a -q -v assert_post=1 -f "$FIXTURE" >/dev/null; then
    fail A "post-migration assertions failed"
  else
    pass A "3 repaired, 3 logged, negative control held, constraint rejects with 23514"
  fi

  # Capture the post-apply hash using the EXACT expression from
  # scripts/prod-verify/1.1-post-apply.sql.
  POST_HASH="$(psql -tAq -d mastery_unblock_a -c "
    SELECT encode(extensions.digest(
             COALESCE(string_agg(item_id::text, ',' ORDER BY item_id), ''), 'sha256'), 'hex')
      FROM public.psi_occurred_at_backfill_log;" 2>/dev/null)"

  if [ -z "$PRE_HASH" ] || [ -z "$POST_HASH" ]; then
    fail A2 "could not compute one of the hashes (pre='$PRE_HASH' post='$POST_HASH')"
  elif [ "$PRE_HASH" != "$POST_HASH" ]; then
    fail A2 "exact-target hash MISMATCH — 1.1-pre-apply and 1.1-post-apply do not agree
       pre  (target_set_hash)   = $PRE_HASH
       post (backfill_set_hash) = $POST_HASH"
  else
    pass A2 "target_set_hash == backfill_set_hash (${PRE_HASH:0:16}…) — exact-target proof holds"
  fi

  # -------------------------------------------------------------------------
  # (A3) The PINNED-LITERAL machinery itself.
  #
  # A2 proves the two hash EXPRESSIONS agree. A3 proves the two prod-verify FILES
  # actually assert against the pinned constant — that a wrong literal reds both,
  # and the right one passes both. Without this, the constant could be ignored
  # entirely and every run would report OK regardless of what was pinned.
  #
  # The pinned default in _target-set-hash.psql is production's hash, which is
  # correctly NOT the fixture's. The files accept -v expected_target_set_hash to
  # override for exactly this purpose.
  #
  # NOTE: the post-apply file's other expectations (42 logged rows, legit_null=70,
  # total_rows=154) are production figures and do not hold on the 5-row fixture, so
  # A3 asserts on the HASH LINE specifically, not on the overall verdict.
  # -------------------------------------------------------------------------
  # (A3) post-apply half — run the REAL 1.1-post-apply.sql and read its own
  # backfill_set_hash_matches column (field 5). Using the actual file rather than a
  # re-typed predicate means this cannot pass while the shipped file is unwired.
  #
  # psql -c does NOT interpolate :'var' — only -f and stdin do — so both halves of
  # A3 drive the files with -f. A -c probe here silently produced empty output and
  # was caught by this case rather than by review.
  A3_POST_OK="$(psql -tAq -F'|' -d mastery_unblock_a -v expected_target_set_hash="$POST_HASH" \
                  -f "$ROOT/scripts/prod-verify/1.1-post-apply.sql" 2>/dev/null \
                | awk -F'|' 'NF>=5 && $3 ~ /^[0-9a-f]{64}$/ {print $5; exit}')"
  A3_POST_BAD="$(psql -tAq -F'|' -d mastery_unblock_a -v expected_target_set_hash="deadbeef${POST_HASH:8}" \
                  -f "$ROOT/scripts/prod-verify/1.1-post-apply.sql" 2>/dev/null \
                | awk -F'|' 'NF>=5 && $3 ~ /^[0-9a-f]{64}$/ {print $5; exit}')"

  if [ "${A3_PRE_OK:-x}" != "t" ]; then
    fail A3 "pre-apply target_set_hash_matches was not true with the CORRECT pinned literal (got '${A3_PRE_OK}')"
  elif [ "${A3_PRE_BAD:-x}" != "f" ]; then
    fail A3 "pre-apply target_set_hash_matches was not false with a WRONG pinned literal (got '${A3_PRE_BAD}') — the assertion is not wired"
  elif [ "${A3_POST_OK:-x}" != "t" ]; then
    fail A3 "post-apply backfill_set_hash_matches was not true with the CORRECT pinned literal (got '${A3_POST_OK}')"
  elif [ "${A3_POST_BAD:-x}" != "f" ]; then
    fail A3 "post-apply backfill_set_hash_matches was not false with a WRONG pinned literal (got '${A3_POST_BAD}') — the assertion is not wired"
  else
    pass A3 "a wrong pinned literal reds BOTH verifiers; the correct one passes both"
  fi
fi

# ---------------------------------------------------------------------------
# (B) unrepairable guard
# ---------------------------------------------------------------------------
echo "==> (B) unrepairable guard"
if ! setup_genesis_db mastery_unblock_b "$M_BACKFILL"; then
  fail B "could not provision DB"
else
  psql -v ON_ERROR_STOP=1 -d mastery_unblock_b -q -v seed_unrepairable=1 -f "$FIXTURE" >/dev/null 2>&1 \
    || fail B "seed failed"
  out="$(apply_migration mastery_unblock_b "$M_BACKFILL" 2>&1)"
  if [ $? -eq 0 ]; then
    fail B "migration APPLIED despite an unrepairable row — the guard is not firing"
  elif ! grep -q "PSI_BACKFILL_UNREPAIRABLE" <<<"$out"; then
    fail B "migration aborted but not with PSI_BACKFILL_UNREPAIRABLE: $out"
  else
    pass B "aborted with PSI_BACKFILL_UNREPAIRABLE"
  fi
fi

# ---------------------------------------------------------------------------
# (C) scope-expansion guard
# ---------------------------------------------------------------------------
echo "==> (C) scope-expansion guard"
if ! setup_genesis_db mastery_unblock_c "$M_BACKFILL"; then
  fail C "could not provision DB"
else
  psql -v ON_ERROR_STOP=1 -d mastery_unblock_c -q -v seed_overscope=1 -f "$FIXTURE" >/dev/null 2>&1 \
    || fail C "seed failed"
  out="$(apply_migration mastery_unblock_c "$M_BACKFILL" 2>&1)"
  if [ $? -eq 0 ]; then
    fail C "migration APPLIED with 43 repairable rows — the scope guard is not firing"
  elif ! grep -q "PSI_BACKFILL_SCOPE_EXPANDED" <<<"$out"; then
    fail C "migration aborted but not with PSI_BACKFILL_SCOPE_EXPANDED: $out"
  else
    pass C "aborted with PSI_BACKFILL_SCOPE_EXPANDED"
  fi
fi

# ---------------------------------------------------------------------------
# (D) portability — fresh DB, zero repairable rows
#
# The regression test for the blocker. A migration carrying an
# environment-specific count (`<> 42`) passes (A)-(C) and still reds every
# fresh apply, every throwaway rehearsal DB, and the transport-test substrate.
# ---------------------------------------------------------------------------
echo "==> (D) portability on a fresh database"
if ! setup_genesis_db mastery_unblock_d; then
  fail D "full migration set (including both unblock migrations) failed to apply to a fresh DB"
else
  n="$(psql -tAq -d mastery_unblock_d -c "SELECT count(*) FROM public.practice_session_items WHERE status IN ('answered','skipped') AND occurred_at IS NULL AND answered_at IS NOT NULL;" 2>/dev/null)"
  c="$(psql -tAq -d mastery_unblock_d -c "SELECT count(*) FROM pg_constraint WHERE conname IN ('psi_resolved_requires_occurred_at','questions_domain_section_canonical','psi_question_domain_section_canonical');" 2>/dev/null)"
  # On a fresh DB the backfill repairs nothing, so the log must exist and be EMPTY.
  # A log row here would mean the CTE logged something the UPDATE did not repair.
  l="$(psql -tAq -d mastery_unblock_d -c "SELECT count(*) FROM public.psi_occurred_at_backfill_log;" 2>/dev/null)"
  if [ "${n:-x}" != "0" ]; then
    fail D "expected 0 repairable rows on a fresh DB, got '${n}'"
  elif [ "${c:-x}" != "3" ]; then
    fail D "expected all 3 new constraints present on a fresh DB, got '${c}'"
  elif [ "${l:-x}" != "0" ]; then
    fail D "expected 0 backfill-log rows on a fresh DB (nothing to repair), got '${l}'"
  else
    pass D "clean apply at count 0, all 3 constraints present, backfill log empty"
  fi
fi

# ---------------------------------------------------------------------------
# (E) domain pre-check aborts on a violating row
# ---------------------------------------------------------------------------
echo "==> (E) canonical-domain pre-check"
if ! setup_genesis_db mastery_unblock_e "$M_DOMAIN"; then
  fail E "could not provision DB at pre-migration state"
else
  psql -v ON_ERROR_STOP=1 -d mastery_unblock_e -q -v seed_bad_domain=1 -f "$FIXTURE" >/dev/null 2>&1 \
    || fail E "seed failed — is the CHECK already present at this cutoff?"
  out="$(apply_migration mastery_unblock_e "$M_DOMAIN" 2>&1)"
  if [ $? -eq 0 ]; then
    fail E "migration APPLIED with a non-canonical domain present — the pre-check is not firing"
  elif ! grep -q "CANONICAL_DOMAIN_VIOLATION" <<<"$out"; then
    fail E "migration aborted but not with CANONICAL_DOMAIN_VIOLATION: $out"
  else
    pass E "aborted with CANONICAL_DOMAIN_VIOLATION"
  fi
fi

# ---------------------------------------------------------------------------
# (F) domain constraints enforce after apply
# ---------------------------------------------------------------------------
echo "==> (F) canonical-domain constraints enforce"
if ! setup_genesis_db mastery_unblock_f; then
  fail F "could not provision DB"
elif ! psql -v ON_ERROR_STOP=1 -d mastery_unblock_f -q -v assert_domain_post=1 -f "$FIXTURE" >/dev/null; then
  fail F "domain constraint assertions failed"
else
  pass F "hyphen rejected, cross-section rejected, canonical accepted"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "MASTERY UNBLOCK GATES: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "MASTERY UNBLOCK GATES: PASS"
