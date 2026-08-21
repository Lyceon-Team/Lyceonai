#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Self-test for scripts/ci/retired-endpoints-gate.mjs
#
# @spec [owner ruling 2026-08-21 Q4 (a gate asserting no caller remains); owner standing
#        rule — "every gate names the mutation that must turn it red"]
# @implemented 2026-08-21
#
# plain English: stages each mutation the gate claims to catch, runs it, asserts it exits
# non-zero for the stated reason, and restores the tree on every exit path.
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

GATE="scripts/ci/retired-endpoints-gate.mjs"
CALLER_TARGET="client/src/lib/masteryApi.ts"
# A directory whose name carries non-ASCII bytes, mirroring the postman collection's emoji
# folders. `git ls-files` C-QUOTES such paths, which is what the gate used to choke on.
NONASCII_DIR="scripts/ci/__selftest_nonascii__/🧠 Mastery"
# A file type the old extension ALLOWLIST did not cover. `.sql` is the largest unscanned
# type in this repo (197 files); `.json` is where the real miss lived.
OFFSCOPE_DIR="scripts/ci/__selftest_offscope__"
FAILURES=0

restore() {
  git checkout -- "$CALLER_TARGET" "$GATE" 2>/dev/null || true
  rm -rf "$NONASCII_DIR" "$OFFSCOPE_DIR"
}

if ! git diff --quiet -- "$CALLER_TARGET" "$GATE"; then
  echo "FAIL: the self-test's targets have uncommitted changes; refusing to stage over them." >&2
  exit 1
fi

# The trap is armed HERE, not at declaration. `restore` runs `git checkout --`, so arming it
# before the clean-tree check meant the early "refusing to stage over your changes" exit
# reverted exactly the uncommitted work it claimed to be protecting. A guard that destroys
# what it guards is worse than no guard.
trap restore EXIT INT TERM

if ! node "$GATE" >/dev/null 2>&1; then
  echo "FAIL: the gate is already red on the committed tree — no mutation below proves anything." >&2
  node "$GATE" >&2
  exit 1
fi
echo "ok  baseline: gate is green on the committed tree"

# 1. a caller comes back. This is the whole point: the endpoint is gone, and a string
#    referencing it is invisible to tsc.
sed -i 's|"/api/me/mastery/domains"|"/api/me/mastery/summary"|' "$CALLER_TARGET"
if git diff --quiet -- "$CALLER_TARGET"; then
  echo "FAIL  caller reintroduced: could not stage the mutation — the case is stale, not passing." >&2
  FAILURES=$((FAILURES + 1))
else
  out="$(node "$GATE" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "FAIL  caller reintroduced: gate exited 0 with a live caller of a retired path." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$out" | grep -q "$CALLER_TARGET"; then
    echo "FAIL  caller reintroduced: gate went red but never named $CALLER_TARGET." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$out" | grep -q "use instead:"; then
    echo "FAIL  caller reintroduced: gate named the file but not the replacement." >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "ok  caller reintroduced -> rc=$rc, names the file and the replacement"
  fi
fi
restore

# 2. scanning nothing is a FAILURE, not a pass.
zero_out="$(RETIRED_ENDPOINTS_PATHSPEC='*.this-matches-nothing' node "$GATE" 2>&1)"
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

# 3. an empty retired table is a gate that cannot fail. That is not the same as a clean
#    tree, and it must not read as a pass.
sed -i 's|^const RETIRED = \[$|const RETIRED = [];\nconst RETIRED_DISABLED_BY_SELFTEST = [|' "$GATE"
if git diff --quiet -- "$GATE"; then
  echo "FAIL  empty table: could not stage the mutation — the case is stale, not passing." >&2
  FAILURES=$((FAILURES + 1))
else
  empty_out="$(node "$GATE" 2>&1)"
  empty_rc=$?
  if [ "$empty_rc" -eq 0 ]; then
    echo "FAIL  empty table: gate exited 0 with nothing to check." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$empty_out" | grep -q "checks nothing"; then
    echo "FAIL  empty table: gate went red but did not say why." >&2
    printf '%s\n' "$empty_out" >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "ok  empty retired table -> rc=$empty_rc, refuses to pass on an empty check set"
  fi
fi
restore

# 4. THE REGRESSION THIS GATE SHIPPED WITH. `git ls-files` writes C-quoted paths for any
#    entry containing non-ASCII bytes. The gate used to split on newline and then drop any
#    line that failed existsSync — and the quoted form never exists on disk, so every
#    non-ASCII path was discarded in silence. 81 of 830 files went unscanned while the gate
#    reported "clean", hiding a live Postman request that called a retired endpoint.
#    A violation at such a path MUST be found. The file is staged in the INDEX, because
#    `git ls-files` reads the index, not the working tree.
mkdir -p "$NONASCII_DIR"
printf 'url: "{{baseUrl}}/api/me/mastery/summary"\n' > "$NONASCII_DIR/probe.yaml"
git add --intent-to-add "$NONASCII_DIR/probe.yaml" >/dev/null 2>&1
if ! git ls-files --error-unmatch "$NONASCII_DIR/probe.yaml" >/dev/null 2>&1; then
  echo "FAIL  non-ASCII path: could not stage the fixture — the case is stale, not passing." >&2
  FAILURES=$((FAILURES + 1))
else
  na_out="$(node "$GATE" 2>&1)"
  na_rc=$?
  if [ "$na_rc" -eq 0 ]; then
    echo "FAIL  non-ASCII path: gate exited 0. A quoted path is being dropped in silence — the" >&2
    echo "      scan is under-counting and reporting clean, which is a false green." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$na_out" | grep -q "probe.yaml"; then
    echo "FAIL  non-ASCII path: gate went red but never named the file under the non-ASCII dir." >&2
    printf '%s\n' "$na_out" >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "ok  violation at a non-ASCII path -> rc=$na_rc, found and named (not silently dropped)"
  fi
fi
git rm --cached -q "$NONASCII_DIR/probe.yaml" >/dev/null 2>&1 || true
rm -rf "scripts/ci/__selftest_nonascii__"

# 5. THE SECOND BLIND SPOT. The scope used to be an extension ALLOWLIST — ts/tsx/js/mjs/
#    md/yml/yaml — which read 833 of 1291 tracked files and ignored 197 .sql, 36 .sh,
#    29 .json, 7 .py, 2 .html without saying so. A Postman export at
#    postman/Lyceonai.postman_collection.json:514 called a retired endpoint while the gate
#    reported a clean tree. An allowlist grows a new blind spot every time the repo gains a
#    file type, and nothing announces it. Scope is now a denylist; these two cases pin it.
mkdir -p "$OFFSCOPE_DIR"
printf '{ "url": "{{baseUrl}}/api/me/mastery/skills" }\n' > "$OFFSCOPE_DIR/probe.json"
printf -- '-- SELECT ... /api/me/mastery/add-to-plan\n' > "$OFFSCOPE_DIR/probe.sql"
git add --intent-to-add "$OFFSCOPE_DIR/probe.json" "$OFFSCOPE_DIR/probe.sql" >/dev/null 2>&1
if ! git ls-files --error-unmatch "$OFFSCOPE_DIR/probe.json" >/dev/null 2>&1; then
  echo "FAIL  off-allowlist extension: could not stage the fixture — the case is stale, not passing." >&2
  FAILURES=$((FAILURES + 1))
else
  os_out="$(node "$GATE" 2>&1)"
  os_rc=$?
  if [ "$os_rc" -eq 0 ]; then
    echo "FAIL  off-allowlist extension: gate exited 0. A whole file type is outside the scan and" >&2
    echo "      nothing says so — the scope is an allowlist again, which is a growing blind spot." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$os_out" | grep -q "probe.json"; then
    echo "FAIL  off-allowlist extension: .json violation not found." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$os_out" | grep -q "probe.sql"; then
    echo "FAIL  off-allowlist extension: .sql violation not found." >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "ok  violation in .json and .sql -> rc=$os_rc, both found (scope is not an allowlist)"
  fi
fi
git rm --cached -q "$OFFSCOPE_DIR/probe.json" "$OFFSCOPE_DIR/probe.sql" >/dev/null 2>&1 || true
rm -rf "$OFFSCOPE_DIR"

if [ "$FAILURES" -ne 0 ]; then
  echo "" >&2
  echo "FAIL: $FAILURES self-test case(s) failed — the retired-endpoints gate does not catch what it claims." >&2
  exit 1
fi

echo ""
echo "OK: retired-endpoints gate self-test — every named mutation turns it red."
