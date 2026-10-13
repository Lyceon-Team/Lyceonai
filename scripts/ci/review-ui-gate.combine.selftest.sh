#!/usr/bin/env bash
# Self-test for review-ui-gate.combine.sh: a clean set of summaries passes, and each way a split
# gate could lose or fake a plant turns it red.
#
# @spec [CI wall-time brief (Karl, 2026-10-11)] | @implemented [2026-10-11]
set -uo pipefail
cd "$(dirname "$0")/../.."
COMBINE="scripts/ci/review-ui-gate.combine.sh"
H=0123456789abcdef0123456789abcdef01234567
OTHER=fedcba9876543210fedcba9876543210fedcba98
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; BAD=0

# 2 jobs x 2 shards, 10 plants split 3/3/2/2.
clean() {
  rm -rf "$T/s"; mkdir -p "$T/s"
  printf 'shard=0 of=4 total=10 selected=10 ran=3 red=3 head=%s\nshard=1 of=4 total=10 selected=10 ran=3 red=3 head=%s\n' "$H" "$H" >"$T/s/job0.txt"
  printf 'shard=2 of=4 total=10 selected=10 ran=2 red=2 head=%s\nshard=3 of=4 total=10 selected=10 ran=2 red=2 head=%s\n' "$H" "$H" >"$T/s/job1.txt"
}
run() { EXPECTED_HEAD="$H" bash "$COMBINE" "$T/s" 2 2 >"$T/out" 2>&1; }
expect_green() { clean; if run; then echo "  PASS  $1"; PASS=$((PASS + 1)); else echo "  FAIL  $1 (should pass)"; cat "$T/out"; BAD=$((BAD + 1)); fi; }
expect_red() {
  local name="$1" want="$2"; clean; eval "$3"
  if run; then echo "  FAIL  $name: passed"; BAD=$((BAD + 1))
  elif grep -qF -- "$want" "$T/out"; then echo "  PASS  $name: red on \"$want\""; PASS=$((PASS + 1))
  else echo "  FAIL  $name: red, but not on \"$want\""; cat "$T/out"; BAD=$((BAD + 1)); fi
}

expect_green "every shard reported and the plants add up"
expect_red "a job's summary missing" "shard 2/4 did not report" 'rm "$T/s/job1.txt"'
expect_red "a shard reported twice" "shard 1 reported twice" 'sed -i "s/^shard=0 /shard=1 /" "$T/s/job0.txt"'
expect_red "a plant not red" "every selected plant must run exactly once and go red" 'sed -i "s/^shard=3 \(.*\)red=2/shard=3 \1red=1/" "$T/s/job1.txt"'
expect_red "a plant lost (ran sum short)" "every selected plant must run exactly once and go red" 'sed -i "s/ran=2 red=2 head=\(.*\)$/ran=1 red=1 head=\1/" "$T/s/job1.txt"'
expect_red "shards disagree on the total" "counted 11 plants" 'sed -i "s/^shard=2 of=4 total=10/shard=2 of=4 total=11/" "$T/s/job1.txt"'
expect_red "a subset selected in the full tier" "the full tier selects every plant" 'sed -i "s/selected=10/selected=9/" "$T/s/job0.txt" "$T/s/job1.txt"'
expect_red "a shard tested another commit" "this job checked out" "sed -i \"s/head=$H\$/head=$OTHER/\" \"\$T/s/job1.txt\""
expect_red "a shard from a different split" "expected one of 4" 'sed -i "s/of=4/of=6/" "$T/s/job1.txt"'
expect_red "no summaries at all" "no plant was counted" 'rm -f "$T"/s/*.txt'

echo "COMBINE SELF-TEST: $PASS passed, $BAD failed"
[ "$BAD" -eq 0 ]
