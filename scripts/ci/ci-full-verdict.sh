#!/usr/bin/env bash
# CI full-tier verdict — the required `ci-full` check's decision.
#
# @spec [owner decisions 2026-10-07 on the CI audit, items 2-3; owner brief 2026-10-08] |
# @implemented [2026-10-08]
#
# plain English: green only when the full tier passed on this exact tree, either in this run
# (RUN=true and every full-tier job succeeded) or in an earlier run recorded by its tree marker
# (SATISFIED=true). The one other green is a pull request into a branch other than `main` that
# did not ask for the full tier (REQUIRED=false: no `ci:full` label) — the tier is opt-in there,
# so the check says it was not requested. Everything else is red, including a scope job that did
# not succeed (its outputs cannot be trusted, so REQUIRED is not read).
#
# Inputs (env): SCOPE_RESULT, RUN, SATISFIED, REQUIRED, RESULTS (space-separated job results).
set -euo pipefail
echo "scope=${SCOPE_RESULT:-} run=${RUN:-} satisfied=${SATISFIED:-} required=${REQUIRED:-} jobs: ${RESULTS:-}"
if [ "${SCOPE_RESULT:-}" != success ]; then
  echo "::error::the scope job did not succeed"; exit 1
fi
if [ "${RUN:-}" = true ]; then
  for r in ${RESULTS:-}; do
    [ "$r" = success ] || { echo "::error::a full-tier job ended $r"; exit 1; }
  done
  [ -n "${RESULTS:-}" ] || { echo "::error::no full-tier job results"; exit 1; }
  echo "full tier passed on this tree"
elif [ "${SATISFIED:-}" = true ]; then
  echo "this exact tree already passed the full tier"
elif [ "${REQUIRED:-}" = false ]; then
  echo "full tier not requested: this pull request is not into main and has no ci:full label (opt-in)"
else
  echo "::error::The full tier has not run on this head. A pull request into main runs it automatically; into another branch, add the ci:full label."
  exit 1
fi
