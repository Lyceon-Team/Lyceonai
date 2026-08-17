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
#   NOTE the pinned-constant SHAPE check that used to live here as (A0) now lives
#   in scripts/ci/prod-verify-console-gate.sh, alongside every other invariant
#   about the operator files — including that they run at all in a SQL console.
#   (A) repair + seal        — 42 repairable rows fixed, 70 legitimate NULLs
#                              untouched (negative control), constraint rejects
#                              the write it accepted pre-migration, and the
#                              backfill log names exactly the repaired rows.
#                              The fixture reproduces production's census
#                              (42 repairable / 0 unrepairable / 70 legit-NULL /
#                              154 total) so the prod-verify verdicts run their
#                              full CASE here instead of short-circuiting on a
#                              count branch — see the header of
#                              mastery-unblock-gates.sql.
#   (A2) EXACT-TARGET HASH    — the target_set_hash construction in
#                              1.1-pre-apply.sql and the backfill_set_hash
#                              construction in 1.1-post-apply.sql produce the
#                              SAME value for the same set. This is the property
#                              the whole production exact-target proof rests on;
#                              if the two constructions ever diverge the operator
#                              would see a mismatch and wrongly conclude the wrong
#                              rows were repaired.
#   (A3) PINNED LITERAL      — both prod-verify files actually assert against the
#                              pinned literal written into them. A wrong literal
#                              must red both; the right one must pass both.
#                              Without this the constant could be inert and every
#                              run would report OK no matter what was pinned.
#                              Asserted on the operator-facing VERDICT STRING, not
#                              just the *_hash_matches column, so a verdict that
#                              computed the comparison and then failed to act on it
#                              is caught too.
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
SCRATCH="$(mktemp -d)"
M_BACKFILL="20260816000000_psi_occurred_at_backfill_and_seal.sql"
M_DOMAIN="20260816010000_canonical_domain_checks.sql"

[ -f "$FIXTURE" ] || { echo "FAIL: fixture not found ($FIXTURE)"; exit 1; }

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

# ---------------------------------------------------------------------------
# Substitute the pinned exact-target hash in a prod-verify file.
#
# The verifiers used to take the hash from an \ir include and accept a
# -v expected_target_set_hash override. Both were psql client features, and the
# operator runs these files in a SQL console that has neither — so the include is
# gone and the literal is written inline. This function is how (A3) still points
# the real files at the fixture's hash.
#
# It asserts the literal was found EXACTLY ONCE. Without that, a renamed or
# deleted constant would silently produce a file with nothing substituted, and
# (A3) would go green while testing nothing.
# ---------------------------------------------------------------------------
subst_pinned_hash() { # $1=source file  $2=hash to pin  $3=output file
  local n
  n="$(grep -cE "'[0-9a-f]{64}'::text" "$1")"
  if [ "$n" != "1" ]; then
    echo "subst_pinned_hash: found $n pinned literal(s) in $1, expected exactly 1" >&2
    return 1
  fi
  sed -E "s/'[0-9a-f]{64}'::text/'$2'::text/" "$1" > "$3"
}

cleanup() {
  rm -rf "$SCRATCH"
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
  # The assertion is on the VERDICT STRING, which is what the operator reads. The
  # *_hash_matches column proving the comparison was computed is not the same
  # claim: a verdict could emit a correct `f` in that column and still say
  # 'OK — safe to apply'. That mutation is proven to red this case.
  #
  # The verdict is only assertable because the fixture carries production's
  # census. The CASE tests unrepairable, then count, then the hash; on the old
  # 3-row fixture the count branch short-circuited and the hash STOP was dead code
  # in this gate.
  #
  # Run with `psql -c`, NOT `-f`. -c does not process meta-commands, so this
  # executes the file exactly as the operator's SQL console does — which is the
  # environment these files actually ship into.
  a3_run() { # $1 = prod-verify file, $2 = hash to pin
    local tmp="$SCRATCH/$(basename "$1")"
    subst_pinned_hash "$ROOT/scripts/prod-verify/$1" "$2" "$tmp" || return 1
    psql -tAq -F'|' -d mastery_unblock_a -c "$(cat "$tmp")" 2>&1
  }
  A3_PRE_OK_OUT="$(a3_run 1.1-pre-apply.sql "$PRE_HASH")"
  A3_PRE_BAD_OUT="$(a3_run 1.1-pre-apply.sql "deadbeef${PRE_HASH:8}")"

  if ! apply_migration mastery_unblock_a "$M_BACKFILL" >/dev/null 2>&1; then
    fail A "migration failed to apply to the seeded pre-state"
  elif ! psql -v ON_ERROR_STOP=1 -d mastery_unblock_a -q -v assert_post=1 -f "$FIXTURE" >/dev/null; then
    fail A "post-migration assertions failed"
  else
    pass A "42 repaired, 42 logged, negative control held at 70, total still 154, constraint rejects with 23514"
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
  # The fixture's ids come from gen_random_uuid() and are fresh on every run, so
  # its hash can never equal the pinned production value. subst_pinned_hash
  # rewrites the literal in a throwaway copy — and asserts it found exactly one,
  # so a renamed or deleted constant reds this case instead of silently producing
  # a file with nothing substituted.
  #
  # Everything ELSE both files assert — 42 repairable, 0 unrepairable, 42 logged,
  # legit_null 70, total_rows 154, drifted 0, constraint validated — holds on the
  # fixture, so the verdicts reach their hash branch and A3 asserts the
  # operator-facing string.
  # -------------------------------------------------------------------------
  # Both files are now single statements whose last column is the verdict, so the
  # whole assertion is "does the output contain this sentence". No field indices:
  # the previous revision parsed field 11 and field 5 by position, which silently
  # decoupled from the files the moment a column was added.
  A3_POST_OK_OUT="$(a3_run 1.1-post-apply.sql "$POST_HASH")"
  A3_POST_BAD_OUT="$(a3_run 1.1-post-apply.sql "deadbeef${POST_HASH:8}")"

  # Verbatim from the two prod-verify files. Matching exactly is the point: these
  # are the sentences Karl reads before deciding to apply, and a reworded or
  # reordered CASE that no longer says them is a change to the operator contract,
  # not a cosmetic edit.
  A3_PRE_OK_EXPECT='OK — safe to apply 20260816000000'
  A3_POST_OK_EXPECT='OK — 42 rows repaired, identity matches the pinned target, negative controls held, constraint enforcing'

  if ! grep -qF "$A3_PRE_OK_EXPECT" <<<"$A3_PRE_OK_OUT"; then
    fail A3 "pre-apply did not reach its OK verdict with the CORRECT pinned literal
       expected to contain: $A3_PRE_OK_EXPECT
       got: $(head -2 <<<"$A3_PRE_OK_OUT")"
  elif ! grep -qF 'STOP — DO NOT APPLY. Exact-target hash mismatch' <<<"$A3_PRE_BAD_OUT"; then
    fail A3 "pre-apply did not STOP on the hash branch with a WRONG pinned literal — the verdict computes the comparison but does not act on it
       got: $(head -2 <<<"$A3_PRE_BAD_OUT")"
  elif ! grep -qF "$A3_POST_OK_EXPECT" <<<"$A3_POST_OK_OUT"; then
    fail A3 "post-apply did not reach its OK verdict with the CORRECT pinned literal
       expected to contain: $A3_POST_OK_EXPECT
       got: $(head -2 <<<"$A3_POST_OK_OUT")"
  elif ! grep -qF 'STOP — EXACT-TARGET PROOF FAILED' <<<"$A3_POST_BAD_OUT"; then
    fail A3 "post-apply did not STOP on the exact-target branch with a WRONG pinned literal — the verdict computes the comparison but does not act on it
       got: $(head -2 <<<"$A3_POST_BAD_OUT")"
  else
    pass A3 "a wrong pinned literal reds BOTH verifiers in console mode; the correct one passes both"
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
