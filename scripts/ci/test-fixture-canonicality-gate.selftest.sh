#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Self-test for scripts/ci/test-fixture-canonicality-gate.mjs
#
# @spec [Doc 05B §4.2 domain canonicality; owner standing rule — "every gate names the
#        mutation that must turn it red"] | @implemented [2026-08-20]
#
# plain English: a gate nobody has ever seen fail is a gate nobody knows works. This
# stages each mutation the gate claims to catch INTO A TRACKED FILE, runs the gate, and
# asserts it exits non-zero and names the file. Then it restores the file from git.
#
# The staged file is restored with `git checkout --` on every exit path, including
# failure and interrupt, so a red run does not leave the tree dirty.
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

GATE="scripts/ci/test-fixture-canonicality-gate.mjs"
# Repointed in PR 2: the previous target was deleted with the routes it tested, and the
# "sed matched nothing" guard below caught the staleness rather than letting three cases
# pass while mutating an absent file. This target carries the same three canonical shapes
# (a bare `section: "M",` line, an `(M, Algebra)` pairing, and a Title Case skill string).
TARGET="tests/ci/student-resources.contract.test.ts"
SCRATCH="tests/__selftest_formats__"
FAILURES=0

restore() {
  git checkout -- "$TARGET" 2>/dev/null || true
  git rm --cached -q -r "$SCRATCH" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH"
}

if ! git diff --quiet -- "$TARGET"; then
  echo "FAIL: $TARGET has uncommitted changes; refusing to stage mutations over them." >&2
  exit 1
fi

# The trap is armed HERE, not beside the function. `restore` runs `git checkout --`, so
# arming it before the clean-tree check meant the early "refusing to stage over your
# changes" exit reverted exactly the uncommitted work it claimed to be protecting. A guard
# that destroys what it guards is worse than no guard.
trap restore EXIT INT TERM

# --- baseline: the committed tree must be GREEN, or every case below is meaningless --
if ! node "$GATE" >/dev/null 2>&1; then
  echo "FAIL: the gate is already red on the committed tree — no mutation below proves anything." >&2
  node "$GATE" >&2
  exit 1
fi
echo "ok  baseline: gate is green on the committed tree"

# --- case runner --------------------------------------------------------------------
# $1 = human label, $2 = sed expression staged into $TARGET, $3 = expected rule tag
expect_red() {
  local label="$1" sed_expr="$2" rule="$3"
  restore
  sed -i "$sed_expr" "$TARGET"
  if git diff --quiet -- "$TARGET"; then
    echo "FAIL  $label: could not stage the mutation (sed matched nothing) — the case is stale, not passing." >&2
    FAILURES=$((FAILURES + 1))
    restore
    return
  fi

  local output rc
  output="$(node "$GATE" 2>&1)"
  rc=$?
  restore

  if [ "$rc" -eq 0 ]; then
    echo "FAIL  $label: gate exited 0 with the mutation staged." >&2
    FAILURES=$((FAILURES + 1))
    return
  fi
  if ! printf '%s' "$output" | grep -q "$TARGET"; then
    echo "FAIL  $label: gate went red but never named $TARGET." >&2
    printf '%s\n' "$output" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi
  if ! printf '%s' "$output" | grep -q "\[$rule\]"; then
    echo "FAIL  $label: gate went red but not under rule [$rule]." >&2
    printf '%s\n' "$output" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi
  echo "ok  $label -> rc=$rc, rule [$rule], names the file"
}

# 1. the original outage: a slug section on a mastery row fixture
expect_red "section slug reintroduced (\"M\" -> \"math\")" \
  's/section: "M",$/section: "math",/' \
  "section"

# 2. a real domain paired with the wrong section
expect_red "domain paired with the wrong section (Algebra under RW)" \
  's/section: "M", domain: "Algebra", mastery_level: 2/section: "RW", domain: "Algebra", mastery_level: 2/' \
  "domain"

# 3. a snake_case skill on a mastery row fixture
expect_red "snake_case skill reintroduced" \
  's/skill: "Linear Equations in One Variable",$/skill: "linear_equations",/' \
  "skill"

# 4. the gate scanning nothing is a FAILURE, not a pass (CR-STD-01)
zero_out="$(FIXTURE_CANONICALITY_PATHSPEC='tests/**/*.this-matches-nothing' node "$GATE" 2>&1)"
zero_rc=$?
if [ "$zero_rc" -eq 0 ]; then
  echo "FAIL  zero scanned files: gate exited 0. An empty scan is a broken gate, not a clean tree." >&2
  FAILURES=$((FAILURES + 1))
elif ! printf '%s' "$zero_out" | grep -q "ZERO files"; then
  echo "FAIL  zero scanned files: gate went red but did not say why." >&2
  FAILURES=$((FAILURES + 1))
else
  echo "ok  zero scanned files -> rc=$zero_rc, refuses to report a clean tree"
fi

# 5. cwd independence: CI steps do not all run from the repo root. The gate resolves
#    both its canonical list and its file list from REPO_ROOT, so the verdict must not
#    depend on where it was invoked from — a gate that silently scans nothing because it
#    was started elsewhere is the zero-files failure wearing a different hat.
cwd_out="$(cd /tmp && node "$REPO_ROOT/$GATE" 2>&1)"
cwd_rc=$?
if [ "$cwd_rc" -ne 0 ]; then
  echo "FAIL  cwd independence: gate failed when run from /tmp." >&2
  printf '%s\n' "$cwd_out" >&2
  FAILURES=$((FAILURES + 1))
elif ! printf '%s' "$cwd_out" | grep -qE "OK: fixture canonicality — [0-9]+ test file"; then
  echo "FAIL  cwd independence: gate passed from /tmp without reporting a scanned-file count." >&2
  printf '%s\n' "$cwd_out" >&2
  FAILURES=$((FAILURES + 1))
else
  echo "ok  cwd independence -> same verdict and file count when run from /tmp"
fi

# --- NDJSON is parsed, not skipped -----------------------------------------------------
# tests/fixtures/**/*.ndjson held 8 fixture records while the gate scanned only .ts/.tsx —
# files literally under a directory named `fixtures`, invisible to a gate whose success
# line reads "no non-canonical fixture found". The claim was broader than the check.
mkdir -p "$SCRATCH"
printf '{"section":"math","domain":"Algebra","mastery_level":2}\n' > "$SCRATCH/probe.ndjson"
git add --intent-to-add "$SCRATCH/probe.ndjson" >/dev/null 2>&1
nd_out="$(node "$GATE" 2>&1)"; nd_rc=$?
if [ "$nd_rc" -eq 0 ]; then
  echo "FAIL  ndjson fixture: gate exited 0 on a non-canonical section in .ndjson." >&2
  FAILURES=$((FAILURES + 1))
elif ! printf '%s' "$nd_out" | grep -q "probe.ndjson:1"; then
  echo "FAIL  ndjson fixture: went red but did not name probe.ndjson at its record line." >&2
  FAILURES=$((FAILURES + 1))
else
  echo "ok  non-canonical section in .ndjson -> rc=$nd_rc, named at the record's line"
fi
restore

# --- a format the gate CANNOT parse must announce itself, not be skipped ---------------
# #640's lesson applied here: this gate needs a parser per format, so it cannot use a
# denylist. Instead an unparsed file that looks like a fixture FAILS with an instruction.
mkdir -p "$SCRATCH"
printf 'section: "math"\n' > "$SCRATCH/probe.yaml"
git add --intent-to-add "$SCRATCH/probe.yaml" >/dev/null 2>&1
tw_out="$(node "$GATE" 2>&1)"; tw_rc=$?
if [ "$tw_rc" -eq 0 ]; then
  echo "FAIL  unparsed format: gate exited 0. A file type it cannot read was silently skipped," >&2
  echo "      which is the blind spot an extension list always grows." >&2
  FAILURES=$((FAILURES + 1))
elif ! printf '%s' "$tw_out" | grep -q "unparsed-format"; then
  echo "FAIL  unparsed format: went red but not via the tripwire rule." >&2
  FAILURES=$((FAILURES + 1))
else
  echo "ok  fixture in an unparsed format -> rc=$tw_rc, tripwire names it and says what to do"
fi
restore

if [ "$FAILURES" -ne 0 ]; then
  echo "" >&2
  echo "FAIL: $FAILURES self-test case(s) failed — the fixture-canonicality gate does not catch what it claims." >&2
  exit 1
fi

echo ""
echo "OK: fixture-canonicality gate self-test — every named mutation turns it red."
