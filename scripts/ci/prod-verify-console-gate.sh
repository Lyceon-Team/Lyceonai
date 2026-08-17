#!/usr/bin/env bash
# ============================================================================
# prod-verify console gate — every operator SQL file must run in a SQL CONSOLE
# ============================================================================
# WHY THIS EXISTS
#   Every file under scripts/prod-verify/ is pasted by hand into the Supabase SQL
#   editor and run against production. It is NOT run with `psql -f`. Those two
#   environments are not interchangeable: `psql -f` interprets backslash
#   meta-commands (\pset, \echo, \ir, \set, \if) and :'variable' interpolation
#   client-side, and a SQL console does neither — it ships the text straight to
#   the server, which sees a bare backslash and fails with
#
#       ERROR: 42601: syntax error at or near "\"
#
#   at the FIRST meta-command line. The file does not partially work; it does not
#   run at all.
#
#   Every prod-verify file shipped in PRs #589 through #595 had this defect and
#   passed CI, because CI only ever ran the CI fixtures — never the operator
#   files. The gates proved the SQL was correct and never proved it was runnable
#   by the person who has to run it. This gate closes that gap by executing each
#   file the way the operator does.
#
# WHAT IT CHECKS
#   (1) SHAPE     no meta-commands, no :'var', no explicit BEGIN/COMMIT/ROLLBACK,
#                 no unqualified table references
#   (2) VERDICT   every non-detail file's LAST statement yields a verdict column,
#                 because consoles commonly show only the final result grid
#   (3) PINNED    the exact-target hash literal appears exactly once in each of
#                 the two 1.1 verifiers and the two are IDENTICAL. This replaces
#                 the \ir include that used to single-source it — the include was
#                 itself a meta-command and had to go.
#   (4) EXECUTE   every file actually runs, in console mode, against a database
#                 carrying genesis + all migrations
#
#   Check (4) is the load-bearing one. (1) is a proxy for it and would not have
#   caught, say, a typo'd column name or a table that does not exist.
#
# HOW CONSOLE MODE IS SIMULATED
#   `psql -c "$(cat file)"` sends the file as a query string and does NOT process
#   meta-commands — reproducing the operator's error byte for byte. Verified
#   against the original report: `LINE 41: \pset footer off`.
#
# EXIT CRITERIA FOR (4)
#   A file passes if it succeeds, OR fails with SQLSTATE P0001 — a deliberate
#   RAISE from one of our own guards. On an empty database the step8 and purge
#   files SHOULD refuse; that is them working. Any other SQLSTATE (42601 syntax,
#   42703 undefined column, 42P01 undefined table, 42883 undefined function) is a
#   real defect and fails the gate.
# ============================================================================
set -uo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

PV_DIR="$ROOT/scripts/prod-verify"
DB=prod_verify_console

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() { drop_deletion_rehearsal_db "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

mapfile -t PV_FILES < <(find "$PV_DIR" -maxdepth 1 -name '*.sql' | sort)
if [ "${#PV_FILES[@]}" -eq 0 ]; then
  echo "FAIL: no .sql files found under $PV_DIR"
  exit 1
fi
echo "==> ${#PV_FILES[@]} operator SQL file(s) under scripts/prod-verify/"

# Real public-schema table names, taken from the committed schema snapshot rather
# than hand-listed, so a new table is covered the moment it lands.
APP_TABLES="$(grep -oE '^CREATE TABLE public\.[a-z_][a-z0-9_]*' \
                "$SCRIPT_DIR/genesis-schema.expected.sql" \
              | sed 's/^CREATE TABLE public\.//' | sort -u)"
if [ -z "$APP_TABLES" ]; then
  echo "FAIL: could not read table names from genesis-schema.expected.sql"
  exit 1
fi

# ---------------------------------------------------------------------------
# (1) SHAPE
# ---------------------------------------------------------------------------
echo "==> (1) shape — pure SQL only"
for f in "${PV_FILES[@]}"; do
  rel="${f#"$ROOT"/}"

  if grep -nE '^[[:space:]]*\\' "$f" >/dev/null 2>&1; then
    fail "1/$rel" "psql meta-command(s) present — a SQL console fails at the first one with 42601:
$(grep -nE '^[[:space:]]*\\' "$f" | head -5 | sed 's/^/       /')"
  fi

  # :'var' / :"var" / :var interpolation is a psql client feature.
  if grep -nE ":'[A-Za-z_][A-Za-z0-9_]*'|:\"[A-Za-z_][A-Za-z0-9_]*\"" "$f" >/dev/null 2>&1; then
    fail "1/$rel" "psql variable interpolation present — the console has no variables:
$(grep -nE ":'[A-Za-z_][A-Za-z0-9_]*'|:\"[A-Za-z_][A-Za-z0-9_]*\"" "$f" | head -3 | sed 's/^/       /')"
  fi

  # Explicit transaction control. The console supplies its own transaction; use a
  # DO block for atomicity instead (README rule 4).
  if grep -nE '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|START[[:space:]]+TRANSACTION)[[:space:]]*;' "$f" >/dev/null 2>&1; then
    fail "1/$rel" "explicit transaction control — use a DO block for atomicity instead (README rule 4):
$(grep -nE '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|START[[:space:]]+TRANSACTION)[[:space:]]*;' "$f" | head -3 | sed 's/^/       /')"
  fi

  # Every reference to a real application table must be schema-qualified, because
  # search_path on the operator's console is not ours to assume.
  #
  # This is deliberately NOT a general "parse the FROM clause" lint. An earlier
  # revision tried that and produced three false positives immediately: it read
  # `IS DISTINCT FROM answered_at` as a FROM clause and matched the word `touched`
  # inside the string 'the UPDATE touched unresolved rows'. A brittle lint that
  # flags correct code is worse than none — someone eventually weakens it.
  #
  # Instead: take the actual table names from the schema snapshot and require that
  # every bare occurrence of one carries a public. prefix. Comments and string
  # literals are stripped first. Word boundaries mean bad_questions and
  # total_questions do not match `questions`.
  stripped="$(sed -e "s/--.*$//" -e "s/'[^']*'//g" "$f")"
  unqualified=""
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    if grep -qE "(^|[^.a-zA-Z0-9_])${t}([^a-zA-Z0-9_]|$)" <<<"$stripped"; then
      unqualified="$unqualified $t"
    fi
  done <<<"$APP_TABLES"
  if [ -n "$unqualified" ]; then
    fail "1/$rel" "table reference(s) missing the public. prefix, which makes them depend on search_path:$unqualified"
  fi
done
[ "$FAILURES" -eq 0 ] && pass 1 "no meta-commands, no interpolation, no explicit transactions, all schema-qualified"

# ---------------------------------------------------------------------------
# (2) VERDICT LAST
#
# Consoles commonly render only the final statement's result. A verdict that is
# not last is a verdict the operator may never see — which is exactly how a STOP
# would get missed. Detail files are listings and are exempt by name.
# ---------------------------------------------------------------------------
echo "==> (2) the verdict is the last result"
before=$FAILURES
for f in "${PV_FILES[@]}"; do
  rel="${f#"$ROOT"/}"
  case "$(basename "$f")" in
    *-detail.sql|*-preview.sql) continue ;;
  esac
  # last non-empty ;-terminated statement, comments stripped
  last_stmt="$(sed -e 's/--.*$//' "$f" | tr '\n' ' ' | sed 's/;[[:space:]]*$//' | awk -F';' '{print $NF}')"
  if ! grep -qi 'as[[:space:]]*verdict' <<<"$last_stmt"; then
    fail "2/$rel" "the LAST statement does not produce a 'verdict' column; a console showing only the final result would hide the go/no-go decision"
  fi
done
[ "$FAILURES" -eq "$before" ] && pass 2 "every decision file ends with its verdict"

# ---------------------------------------------------------------------------
# (3) PINNED HASH — present once per verifier, and identical across them
#
# There is no \ir include any more (it was a meta-command), so the literal is
# written in both 1.1 files. This check is what stops them drifting.
# ---------------------------------------------------------------------------
echo "==> (3) pinned exact-target hash"
before=$FAILURES
PRE="$PV_DIR/1.1-pre-apply.sql"
POST="$PV_DIR/1.1-post-apply.sql"
hash_of() { grep -oE "'[0-9a-f]{64}'::text" "$1" | tr -d "'" | sed 's/::text//' | sort -u; }
count_of() { grep -cE "'[0-9a-f]{64}'::text" "$1"; }

PRE_N="$(count_of "$PRE")"; POST_N="$(count_of "$POST")"
PRE_H="$(hash_of "$PRE")";  POST_H="$(hash_of "$POST")"

if [ "$PRE_N" != "1" ]; then
  fail 3 "1.1-pre-apply.sql contains $PRE_N pinned-hash literal(s), expected exactly 1"
elif [ "$POST_N" != "1" ]; then
  fail 3 "1.1-post-apply.sql contains $POST_N pinned-hash literal(s), expected exactly 1"
elif [ "$PRE_H" != "$POST_H" ]; then
  fail 3 "the two 1.1 verifiers pin DIFFERENT hashes — they have drifted apart
       pre  = $PRE_H
       post = $POST_H"
else
  pass 3 "both verifiers pin the same well-formed sha256 (${PRE_H:0:16}…)"
fi

# ---------------------------------------------------------------------------
# (4) EXECUTE IN CONSOLE MODE — the load-bearing check
# ---------------------------------------------------------------------------
echo "==> (4) execute in console mode against genesis + all migrations"
if ! setup_genesis_db "$DB"; then
  fail 4 "could not provision the verification database"
else
  for f in "${PV_FILES[@]}"; do
    rel="${f#"$ROOT"/}"
    # psql -c does NOT process meta-commands — this is the operator's environment.
    out="$(psql -d "$DB" -v ON_ERROR_STOP=1 -c "$(cat "$f")" 2>&1)"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      pass "4/$rel" "runs clean in console mode"
    # One of OUR OWN guards refusing. Every RAISE in these files uses a
    # SCREAMING_SNAKE prefix followed by a colon (STEP8:, PURGE:, RESOLVE_DUP:,
    # BASELINE_REPAIR:, PSI_BACKFILL_*:), so the convention is matched rather than
    # a hardcoded prefix list — an earlier revision listed three prefixes and
    # flagged a correctly-refusing new file as a real failure. PostgreSQL's own
    # errors do not have this shape ("syntax error at or near", "column ... does
    # not exist"), and the SQLSTATE exclusion below is still the backstop.
    elif grep -qE 'ERROR:[[:space:]]+[A-Z][A-Z0-9_]{2,}:' <<<"$out" && ! grep -qE '(42601|42703|42P01|42883|42P10|42704)' <<<"$out"; then
      # One of our own RAISEs. On an empty database that is the correct behaviour.
      pass "4/$rel" "refused with its own guard (expected on an empty DB): $(head -1 <<<"$out" | cut -c1-90)"
    else
      fail "4/$rel" "failed in console mode — this is what the operator would see:
$(sed 's/^/       /' <<<"$out" | head -6)"
    fi
  done
fi

# ---------------------------------------------------------------------------
# (5) MIGRATIONS are console-safe too
#
# Migrations are applied through the same console. They are clean today; this
# keeps them that way.
# ---------------------------------------------------------------------------
echo "==> (5) migrations carry no meta-commands"
before=$FAILURES
while IFS= read -r m; do
  if grep -nE '^[[:space:]]*\\' "$m" >/dev/null 2>&1; then
    fail "5/${m#"$ROOT"/}" "migration contains psql meta-command(s); it cannot be applied from a SQL console"
  fi
done < <(find "$ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort)
[ "$FAILURES" -eq "$before" ] && pass 5 "all migrations are pure SQL"

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "PROD-VERIFY CONSOLE GATE: FAIL ($FAILURES finding(s))"
  exit 1
fi
echo "PROD-VERIFY CONSOLE GATE: PASS"
