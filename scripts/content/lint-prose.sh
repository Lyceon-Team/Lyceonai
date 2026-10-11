#!/usr/bin/env bash
# Prose and link gates for pipeline posts (Doc 10B §5 gates 6 and 8).
#
# @spec [docs/Spec/Lyceon_Doc_10B.md §5, §9; owner decision 2026-10-11 ("Vale: Microsoft (error
#       level) plus ai-tells, pinned")] | @implemented [2026-10-11]
#
# Exports every pipeline post (scripts/content/export-prose.ts), then:
#   - Vale (.vale.ini: Microsoft + ai-tells, pinned; error level fails);
#   - lychee (lychee.toml) over every external URL the posts cite or link.
# Needs `vale` and `lychee` on PATH (.github/actions/content-tools installs the pinned builds).
# With no pipeline posts there is nothing to lint, and that is said, not hidden.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
pnpm exec tsx scripts/content/export-prose.ts "$@"
shopt -s nullglob
files=(build/content-prose/*.md)
if [ "${#files[@]}" -eq 0 ]; then
  echo "lint-prose: no pipeline posts to lint"
  exit 0
fi
vale sync >/dev/null
vale --minAlertLevel=error "${files[@]}"
if [ -s build/content-prose/links.txt ]; then
  lychee --no-progress --config lychee.toml build/content-prose/links.txt
fi
echo "lint-prose: ${#files[@]} post(s) pass Vale and lychee"
