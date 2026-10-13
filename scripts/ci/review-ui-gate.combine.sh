#!/usr/bin/env bash
# Review UI mutation gate across matrix jobs — the totals no single job can check.
#
# @spec [brief R4 §3 ("Every assertion is planted"), U1-U9; CI wall-time brief (Karl, 2026-10-11):
#       "same plants, same proof, no check weakened, with a final job verifying the shard totals"]
#       | @implemented [2026-10-11]
#
# plain English: ci-full.yml splits the gate into M jobs of SHARDS worktrees each
# (review-ui-gate.parallel.sh with REVIEW_UI_GATE_JOB=<m>/<M>). Each job proves its own plants
# (each applied, its test red, each worktree byte-identical to HEAD) and writes one summary line
# per shard that passed. This script reads every job's lines and checks what the single-job
# driver checked over its own shards:
#   - every global shard 0..N-1 reported exactly once (N = M * SHARDS), none missing or doubled;
#   - every shard counted the same plant total and the same selection, and with no selection
#     (the full tier) every plant is selected;
#   - the shards' plants add up: ran = red = selected, so every plant ran exactly once and went red;
#   - every shard tested the same commit, and it is the commit this job checked out.
# A missing artifact, a failed job (its lines are missing) or any mismatch is red.
#
# Usage:  bash scripts/ci/review-ui-gate.combine.sh <dir of summary files> <M jobs> <SHARDS per job>
#         (EXPECTED_HEAD=<sha>, default: git rev-parse HEAD)
set -euo pipefail
DIR="${1:?summary directory}"
JOBS="${2:?job count}"
PER="${3:?shards per job}"
EXPECTED_HEAD="${EXPECTED_HEAD:-$(git rev-parse HEAD)}"
N=$((JOBS * PER))

mapfile -t LINES < <(cat "$DIR"/*.txt 2>/dev/null | grep -E '^shard=' || true)
FAIL=0
fail() { echo "!! $1"; FAIL=1; }

declare -A SEEN=()
TOTAL=""; SELECTED=""; RAN_SUM=0; RED_SUM=0
re='^shard=([0-9]+) of=([0-9]+) total=([0-9]+) selected=([0-9]+) ran=([0-9]+) red=([0-9]+) head=([0-9a-f]{40})$'
for l in "${LINES[@]}"; do
  if ! [[ "$l" =~ $re ]]; then fail "malformed summary line: $l"; continue; fi
  g="${BASH_REMATCH[1]}" of="${BASH_REMATCH[2]}" t="${BASH_REMATCH[3]}" sel="${BASH_REMATCH[4]}"
  r="${BASH_REMATCH[5]}" p="${BASH_REMATCH[6]}" h="${BASH_REMATCH[7]}"
  [ "$of" = "$N" ] || fail "shard $g was one of $of, expected one of $N"
  [ "$g" -lt "$N" ] || fail "shard $g is out of range 0..$((N - 1))"
  [ -z "${SEEN[$g]:-}" ] || fail "shard $g reported twice"
  SEEN[$g]=1
  [ "$h" = "$EXPECTED_HEAD" ] || fail "shard $g tested $h, this job checked out $EXPECTED_HEAD"
  if [ -z "$TOTAL" ]; then TOTAL="$t"; elif [ "$t" != "$TOTAL" ]; then fail "shard $g counted $t plants, another counted $TOTAL"; fi
  if [ -z "$SELECTED" ]; then SELECTED="$sel"; elif [ "$sel" != "$SELECTED" ]; then fail "shard $g selected $sel, another selected $SELECTED"; fi
  RAN_SUM=$((RAN_SUM + r)); RED_SUM=$((RED_SUM + p))
done
for ((g = 0; g < N; g++)); do
  [ -n "${SEEN[$g]:-}" ] || fail "shard $g/$N did not report (its job failed or its summary is missing)"
done

echo "plants: total=${TOTAL:-?} selected=${SELECTED:-?} ran=$RAN_SUM red=$RED_SUM across ${#SEEN[@]}/$N shards in $JOBS jobs"
if [ -z "$TOTAL" ] || [ "$TOTAL" -eq 0 ]; then
  fail "no plant was counted"
elif [ "$SELECTED" -ne "$TOTAL" ]; then
  fail "the full tier selects every plant: selected=$SELECTED total=$TOTAL"
elif [ "$RAN_SUM" -ne "$SELECTED" ] || [ "$RED_SUM" -ne "$SELECTED" ]; then
  fail "every selected plant must run exactly once and go red (ran=$RAN_SUM red=$RED_SUM selected=$SELECTED)"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "GATE FAILED"
  exit 1
fi
echo "GATE PASSED — $TOTAL plants, every one red once, across $N shards in $JOBS jobs"
