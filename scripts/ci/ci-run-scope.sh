#!/usr/bin/env bash
# CI run scope — which of ci.yml's jobs this run actually needs.
#
# @spec [CI-minutes brief 2026-10-07: "no gate weakened"] | @implemented [2026-10-07]
#
# plain English: decides two things, and fails OPEN (everything runs) whenever it cannot decide.
#
#   docs_only=true   A pull request into an integration branch (never into `main`) whose every
#                    changed file is documentation no gated job reads: under docs/ (except
#                    docs/Spec/, which the scoring and calendar gates read, and docs/compliance/,
#                    whose claim inventory the build's publish gate reads) or a root-level *.md.
#                    The jobs gated on it (the database, e2e and GCP jobs) cannot see those files,
#                    so their result is the base's. The `ci` job (whole test suite, which DOES
#                    read docs) still runs. scripts/ci/ci-scope-guard.mjs keeps "no gated job reads
#                    these files" true, and every change reaching `main` gets the full run.
#
#   duplicate=true   A push to `main` or `cleanup` whose exact tree (git tree hash) a pull-request
#                    run of this workflow already ran in full and passed. Same files, same result:
#                    the PR run uploads a `ci-tested-tree-<tree>` marker artifact, and the push run
#                    looks it up and checks that run's conclusion. A merge whose base moved after
#                    the PR's last run has a different tree and runs in full.
#
# Writes `docs_only`, `duplicate` and `tree` to $GITHUB_OUTPUT (or stdout when unset).
# Inputs (env): EVENT_NAME, BASE_REF (pull requests), REPO (owner/name), GH_TOKEN.
set -uo pipefail
cd "$(dirname "$0")/../.."

OUT="${GITHUB_OUTPUT:-/dev/stdout}"
emit() { echo "$1=$2" >>"$OUT"; }

# A file is documentation-only when no gated job reads it (see the guard).
is_docs_inert() {
  case "$1" in
    docs/Spec/*) return 1 ;;
    docs/compliance/*) return 1 ;;
    docs/*) return 0 ;;
    */*) return 1 ;;
    *.md) return 0 ;;
    *) return 1 ;;
  esac
}

TREE="$(git rev-parse 'HEAD^{tree}' 2>/dev/null || echo "")"
emit tree "$TREE"
DOCS_ONLY=false
DUPLICATE=false

case "${EVENT_NAME:-}" in
  pull_request)
    # The checkout is the PR's merge commit; its first parent is the base it was merged onto,
    # so this diff is exactly the change the PR makes to that base.
    if [ "${BASE_REF:-}" != "main" ] && FILES="$(git diff --name-only 'HEAD^1' HEAD 2>/dev/null)" && [ -n "$FILES" ]; then
      DOCS_ONLY=true
      while IFS= read -r f; do
        is_docs_inert "$f" || { DOCS_ONLY=false; break; }
      done <<<"$FILES"
      echo "changed files: $(wc -l <<<"$FILES"); docs-only: $DOCS_ONLY"
    else
      echo "PR into ${BASE_REF:-?} (or no diff): full run"
    fi
    ;;
  push)
    if [ -n "$TREE" ] && [ -n "${REPO:-}" ]; then
      RUN_IDS="$(gh api "repos/$REPO/actions/artifacts?name=ci-tested-tree-$TREE&per_page=100" \
        --jq '.artifacts[].workflow_run.id' 2>/dev/null || true)"
      for id in $RUN_IDS; do
        info="$(gh api "repos/$REPO/actions/runs/$id" --jq '[.event, .path, .conclusion] | join(" ")' 2>/dev/null || true)"
        if [ "$info" = "pull_request .github/workflows/ci.yml success" ]; then
          echo "tree $TREE already passed a full PR run: https://github.com/$REPO/actions/runs/$id"
          DUPLICATE=true
          break
        fi
      done
      [ "$DUPLICATE" = true ] || echo "tree $TREE has no passing full PR run: full run"
    else
      echo "push without a tree or repo: full run"
    fi
    ;;
  *)
    echo "event ${EVENT_NAME:-?}: full run"
    ;;
esac

emit docs_only "$DOCS_ONLY"
emit duplicate "$DUPLICATE"
