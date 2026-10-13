#!/usr/bin/env bash
# =============================================================================
# CI full-tier scope + verdict self-test
# =============================================================================
# @spec [owner brief 2026-10-08: every PR into main runs the full tier without the label; the
#        label stays the opt-in for PRs into cleanup; the ci-full verdict still fails when the
#        full tier did not run or failed on the current head] | @implemented [2026-10-08]
#
# plain English: drives scripts/ci/ci-full-scope.sh and scripts/ci/ci-full-verdict.sh through
# every event shape and asserts each decision, so a change that (say) stops PRs into main from
# running the tier, or lets an unlabelled PR into main go green, turns this red. The "tree
# already passed" case uses a fake `gh` on PATH (the real lookup needs the Actions API); no test
# hook exists in either script. Runs in the fast lane (ci.yml), so it guards the scripts on the
# PR that changes them, before the full tier ever runs.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
SCOPE="scripts/ci/ci-full-scope.sh"
VERDICT="scripts/ci/ci-full-verdict.sh"
fails=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A fake gh: with FAKE_SATISFIED=true it reports one passing ci-full run for any tree marker.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/gh" <<'GH'
#!/usr/bin/env bash
[ "${FAKE_SATISFIED:-false}" = true ] || exit 1
case "$2" in
  *actions/artifacts*) echo 4242 ;;
  *actions/runs/4242) echo ".github/workflows/ci-full.yml success" ;;
  *) exit 1 ;;
esac
GH
chmod +x "$TMP/bin/gh"

# scope <label> <event> <base> <has_label> <satisfied> <want_run> <want_required>
scope() {
  local label="$1" out="$TMP/out"
  : >"$out"
  PATH="$TMP/bin:$PATH" GITHUB_OUTPUT="$out" EVENT_NAME="$2" BASE_REF="$3" HAS_LABEL="$4" \
    FAKE_SATISFIED="$5" REPO="Lyceon-Team/Lyceonai" GH_TOKEN="" bash "$SCOPE" >/dev/null 2>&1
  local run required
  run="$(sed -n 's/^run=//p' "$out")"
  required="$(sed -n 's/^required=//p' "$out")"
  if [ "$run" = "$6" ] && [ "$required" = "$7" ]; then
    echo "ok   scope: $label (run=$run required=$required)"
  else
    echo "FAIL scope: $label — got run=$run required=$required, want run=$6 required=$7"
    fails=$((fails + 1))
  fi
}

# verdict <label> <scope_result> <run> <satisfied> <required> <results> <want: green|red>
verdict() {
  local label="$1" got=green
  SCOPE_RESULT="$2" RUN="$3" SATISFIED="$4" REQUIRED="$5" RESULTS="$6" \
    bash "$VERDICT" >/dev/null 2>&1 || got=red
  if [ "$got" = "$7" ]; then
    echo "ok   verdict: $label ($got)"
  else
    echo "FAIL verdict: $label — got $got, want $7"
    fails=$((fails + 1))
  fi
}

ALL_OK="success success success success"

# --- scope -------------------------------------------------------------------------------------
scope "PR into main, no label: runs"                     pull_request main    false false true  true
scope "PR into main, with label: runs"                   pull_request main    true  false true  true
scope "PR into main, tree already passed: no re-run"     pull_request main    false true  false true
scope "PR into cleanup, no label: skipped, not required" pull_request cleanup false false false false
scope "PR into cleanup, with label: runs"                pull_request cleanup true  false true  true
scope "PR into cleanup, label, tree passed: no re-run"   pull_request cleanup true  true  false true
scope "PR with no base (malformed): not into main"       pull_request ""      false false false false
scope "push to main: runs"                               push         ""      false false true  true
scope "push to main, tree already passed: no re-run"     push         ""      false true  false true
scope "workflow_dispatch: always runs"                   workflow_dispatch "" false true  true  true

# --- verdict -----------------------------------------------------------------------------------
verdict "ran, every job passed"                          success true  false true  "$ALL_OK" green
verdict "ran, one job failed"                            success true  false true  "success failure success success" red
verdict "ran, one job cancelled"                         success true  false true  "success success cancelled success" red
verdict "ran, one job skipped"                           success true  false true  "success success success skipped" red
verdict "ran, no job results at all"                     success true  false true  "" red
verdict "PR into main not run, not satisfied"            success false false true  "skipped skipped skipped skipped" red
verdict "not run, tree already passed"                   success false true  true  "skipped skipped skipped skipped" green
verdict "PR into cleanup, not requested"                 success false false false "skipped skipped skipped skipped" green
verdict "required output missing (fail closed)"          success false false ""    "skipped skipped skipped skipped" red
verdict "scope job failed, even if 'not required'"       failure false false false "skipped skipped skipped skipped" red

if [ "$fails" -ne 0 ]; then
  echo "CI-FULL SCOPE SELF-TEST: $fails case(s) failed"
  exit 1
fi
echo "CI-FULL SCOPE SELF-TEST: PASS — every scope and verdict case decided as the owner brief requires"
