#!/usr/bin/env bash
# CI full-tier scope — whether ci-full.yml runs the full tier on this event.
#
# @spec [owner decisions 2026-10-07 on the CI audit, items 2-3] | @implemented [2026-10-07]
#
# plain English: the full tier is expensive, so it runs once per tree. Writes to $GITHUB_OUTPUT:
#   tree       the checkout's git tree hash;
#   satisfied  true when a ci-full run already passed on this exact tree (its marker artifact
#              `ci-full-tested-tree-<tree>` exists and that run concluded success);
#   run        true when the full tier must run now:
#                - workflow_dispatch: always;
#                - push (main): unless satisfied (the merged PR's run already covered this tree);
#                - pull_request: when the PR carries the `ci:full` label (HAS_LABEL=true) and the
#                  tree is not already satisfied.
# It fails CLOSED for the verdict: if the marker lookup errors, satisfied stays false, so the
# required check can only go green by running the full tier.
#
# Inputs (env): EVENT_NAME, REPO, GH_TOKEN, HAS_LABEL.
set -uo pipefail
cd "$(dirname "$0")/../.."

OUT="${GITHUB_OUTPUT:-/dev/stdout}"
emit() { echo "$1=$2" >>"$OUT"; }

TREE="$(git rev-parse 'HEAD^{tree}' 2>/dev/null || echo "")"
emit tree "$TREE"

SATISFIED=false
if [ -n "$TREE" ] && [ -n "${REPO:-}" ]; then
  RUN_IDS="$(gh api "repos/$REPO/actions/artifacts?name=ci-full-tested-tree-$TREE&per_page=100" \
    --jq '.artifacts[].workflow_run.id' 2>/dev/null || true)"
  for id in $RUN_IDS; do
    info="$(gh api "repos/$REPO/actions/runs/$id" --jq '[.path, .conclusion] | join(" ")' 2>/dev/null || true)"
    if [ "$info" = ".github/workflows/ci-full.yml success" ]; then
      echo "tree $TREE already passed the full tier: https://github.com/$REPO/actions/runs/$id"
      SATISFIED=true
      break
    fi
  done
fi

RUN=false
case "${EVENT_NAME:-}" in
  workflow_dispatch) RUN=true ;;
  push) [ "$SATISFIED" = true ] || RUN=true ;;
  pull_request)
    if [ "${HAS_LABEL:-false}" = true ] && [ "$SATISFIED" != true ]; then RUN=true; fi
    ;;
esac
echo "event=${EVENT_NAME:-?} label=${HAS_LABEL:-false} satisfied=$SATISFIED run=$RUN"
emit satisfied "$SATISFIED"
emit run "$RUN"
