#!/usr/bin/env bash
# Review UI mutation gate, sharded — the same plants, the same per-plant proof, in parallel.
#
# @spec [brief R4 §3 ("Every assertion is planted"), U1-U9; CI-minutes brief 2026-10-07]
#       | @implemented [2026-10-07]
#
# plain English: review-ui-gate.mutations.sh applies each plant, asserts its named test file
# fails, and reverts byte-identically, one plant after another. Each plant's cost is almost all
# vitest start-up, so the gate's ~280 plants had grown to ~24 minutes of the `ci` job. This driver
# runs that SAME script as N shards (plant k runs in shard k mod N), each in its own git worktree
# of HEAD, so no two plants ever touch the same file at once. Nothing about a plant changes: the
# anchor must apply, its test must go red, its revert must be byte-identical.
#
# What it adds on top of the serial script, so the parallel run proves at least as much:
#   - every shard must report the same plant total, and the shards' plants must add up to it
#     (a lost or doubled plant fails the gate), with every plant red;
#   - every worktree must end byte-identical to HEAD (`git diff --quiet HEAD`), which covers any
#     file a plant could touch, not only the snapshot list;
#   - the main tree is never mutated at all, and must still match HEAD at the end.
# The serial script's closing "full client suite on the restored tree" is replaced by that
# byte-identity proof: a tree identical to HEAD is the tree the job's whole-suite step already ran
# green, earlier in the same job.
#
# Selection (owner decision 2026-10-07): REVIEW_UI_GATE_ONLY_CHANGED=<file of changed paths> is
# passed through to every shard, which then runs only the plants that file selects (see the
# mutations script). Every shard must agree on how many were selected; with no selection set,
# every plant must be selected.
#
# Across jobs (CI wall-time brief, Karl 2026-10-11): REVIEW_UI_GATE_JOB=<m>/<M> makes this run
# one of M matrix jobs. The plants are then split into M*SHARDS global shards; this job runs
# global shards m*SHARDS .. m*SHARDS+SHARDS-1, with every per-plant and per-worktree check above
# unchanged. The sums (every selected plant ran exactly once and went red) can only be checked
# across all M jobs, so this job writes one line per shard to REVIEW_UI_GATE_SUMMARY and
# scripts/ci/review-ui-gate.combine.sh checks the totals over every job's lines.
#
# Usage:  bash scripts/ci/review-ui-gate.parallel.sh   (REVIEW_UI_GATE_SHARDS=<n>, default nproc;
#         REVIEW_UI_GATE_JOB=<m>/<M> and REVIEW_UI_GATE_SUMMARY=<file> for one job of M)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
SCRIPT="scripts/ci/review-ui-gate.mutations.sh"
SHARDS="${REVIEW_UI_GATE_SHARDS:-$(nproc)}"
JOB_SPEC="${REVIEW_UI_GATE_JOB:-0/1}"
JOB_M="${JOB_SPEC%/*}"
JOB_N="${JOB_SPEC#*/}"
if ! [[ "$SHARDS" =~ ^[1-9][0-9]*$ && "$JOB_M" =~ ^[0-9]+$ && "$JOB_N" =~ ^[1-9][0-9]*$ ]] || [ "$JOB_M" -ge "$JOB_N" ]; then
  echo "!! bad REVIEW_UI_GATE_SHARDS=$SHARDS / REVIEW_UI_GATE_JOB=$JOB_SPEC (want <index>/<count>, index < count)"
  exit 2
fi
if [ "$JOB_N" -gt 1 ] && [ -z "${REVIEW_UI_GATE_SUMMARY:-}" ]; then
  echo "!! REVIEW_UI_GATE_JOB=$JOB_SPEC needs REVIEW_UI_GATE_SUMMARY: the totals are checked across jobs"
  exit 2
fi
GLOBAL_N=$((JOB_N * SHARDS))
GLOBAL_BASE=$((JOB_M * SHARDS))

# The worktrees check out HEAD, so the gate must be testing HEAD: refuse a tree whose tracked
# files differ from it (fail closed, never test something else than what was checked out).
if ! git diff --quiet HEAD --; then
  echo "!! tracked files differ from HEAD; the sharded gate tests HEAD and refuses to run"
  git diff --stat HEAD -- | tail -5
  exit 2
fi

WORK="$(mktemp -d)"
cleanup() {
  for ((i = 0; i < SHARDS; i++)); do
    git worktree remove --force "$WORK/s$i" >/dev/null 2>&1 || true
  done
  git worktree prune >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Installed dependencies are shared read-only: the root node_modules and each workspace
# package's own (pnpm links them per package).
mapfile -t MODULE_DIRS < <(find . -maxdepth 4 -name node_modules -type d -not -path '*/node_modules/*' | sed 's#^\./##' | sort)

echo "Sharding $SCRIPT: global shards $GLOBAL_BASE..$((GLOBAL_BASE + SHARDS - 1)) of $GLOBAL_N (job $JOB_SPEC), $SHARDS worktrees of $(git rev-parse --short HEAD)"
for ((i = 0; i < SHARDS; i++)); do
  git worktree add --quiet --detach "$WORK/s$i" HEAD
  for d in "${MODULE_DIRS[@]}"; do ln -s "$ROOT/$d" "$WORK/s$i/$d"; done
done

start=$(date +%s)
for ((i = 0; i < SHARDS; i++)); do
  (
    cd "$WORK/s$i"
    rc=0
    REVIEW_UI_GATE_SHARD="$((GLOBAL_BASE + i))/$GLOBAL_N" REVIEW_UI_GATE_SKIP_FINAL_SUITE=1 \
      bash "$SCRIPT" >"$WORK/s$i.log" 2>&1 || rc=$?
    echo "$rc" >"$WORK/s$i.rc"
  ) &
done
wait

FAIL=0
TOTAL=""
SELECTED=""
RAN_SUM=0
RED_SUM=0
for ((i = 0; i < SHARDS; i++)); do
  printf '\n════ shard %s/%s ════\n' "$i" "$SHARDS"
  cat "$WORK/s$i.log"
  rc="$(cat "$WORK/s$i.rc")"
  # The script's last count line: "plant count: total=<T> selected=<S> ran=<R> red=<P>".
  line="$(grep -E '^plant count: total=[0-9]+ selected=[0-9]+ ran=[0-9]+ red=[0-9]+$' "$WORK/s$i.log" | tail -1 || true)"
  if [ "$rc" != 0 ] || [ -z "$line" ]; then
    echo "!! shard $i failed (exit $rc)"
    FAIL=1
    continue
  fi
  t="$(sed -E 's/.*total=([0-9]+).*/\1/' <<<"$line")"
  sel="$(sed -E 's/.*selected=([0-9]+).*/\1/' <<<"$line")"
  r="$(sed -E 's/.*ran=([0-9]+).*/\1/' <<<"$line")"
  p="$(sed -E 's/.*red=([0-9]+).*/\1/' <<<"$line")"
  if [ -z "$TOTAL" ]; then TOTAL="$t"; elif [ "$t" != "$TOTAL" ]; then
    echo "!! shard $i counted $t plants, an earlier shard counted $TOTAL"
    FAIL=1
  fi
  if [ -z "$SELECTED" ]; then SELECTED="$sel"; elif [ "$sel" != "$SELECTED" ]; then
    echo "!! shard $i selected $sel plants, an earlier shard selected $SELECTED"
    FAIL=1
  fi
  RAN_SUM=$((RAN_SUM + r))
  RED_SUM=$((RED_SUM + p))
  # Byte-identity with HEAD: every tracked file, not only the snapshot list.
  if ! git -C "$WORK/s$i" diff --quiet HEAD --; then
    echo "!! shard $i left its worktree different from HEAD:"
    git -C "$WORK/s$i" diff --stat HEAD -- | tail -5
    FAIL=1
    continue
  fi
  # Written only for a shard that passed every check above; the combine step needs all of them.
  if [ -n "${REVIEW_UI_GATE_SUMMARY:-}" ]; then
    echo "shard=$((GLOBAL_BASE + i)) of=$GLOBAL_N total=$t selected=$sel ran=$r red=$p head=$(git rev-parse HEAD)" >>"$REVIEW_UI_GATE_SUMMARY"
  fi
done

printf '\n────────────────────────────────\n'
echo "plants: total=${TOTAL:-?} selected=${SELECTED:-?} ran=$RAN_SUM red=$RED_SUM across $SHARDS shards in $(($(date +%s) - start))s"
if [ "$JOB_N" -gt 1 ]; then
  # One job of several: the sums are the combine step's (review-ui-gate.combine.sh), over every
  # job's summary lines. Everything this job can check on its own was checked above.
  if [ -z "$TOTAL" ] || [ "$TOTAL" -eq 0 ]; then
    echo "!! no plant was counted"
    FAIL=1
  fi
  if ! git diff --quiet HEAD --; then
    echo "!! the main tree changed during the gate"
    FAIL=1
  fi
  if [ "$FAIL" -ne 0 ]; then
    echo "GATE FAILED (job $JOB_SPEC)"
    exit 1
  fi
  echo "job $JOB_SPEC passed its shards; the totals are checked by review-ui-gate.combine.sh"
  exit 0
fi
if [ -z "$TOTAL" ] || [ "$TOTAL" -eq 0 ]; then
  echo "!! no plant was counted"
  FAIL=1
elif [ -z "${REVIEW_UI_GATE_ONLY_CHANGED:-}" ] && [ "$SELECTED" -ne "$TOTAL" ]; then
  echo "!! no selection is set, so every plant must be selected"
  FAIL=1
elif [ "$RAN_SUM" -ne "$SELECTED" ] || [ "$RED_SUM" -ne "$SELECTED" ]; then
  echo "!! every selected plant must run exactly once and go red"
  FAIL=1
elif [ "$SELECTED" -eq 0 ]; then
  echo "no plant targets a file this change touches; nothing for the gate to prove here (the full tier runs all $TOTAL)"
fi
if ! git diff --quiet HEAD --; then
  echo "!! the main tree changed during the gate"
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "GATE FAILED"
  exit 1
fi
echo "GATE PASSED — every plant red once, every worktree byte-identical to HEAD"
