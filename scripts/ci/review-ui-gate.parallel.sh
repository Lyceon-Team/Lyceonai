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
# Usage:  bash scripts/ci/review-ui-gate.parallel.sh   (REVIEW_UI_GATE_SHARDS=<n>, default nproc)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
SCRIPT="scripts/ci/review-ui-gate.mutations.sh"
SHARDS="${REVIEW_UI_GATE_SHARDS:-$(nproc)}"

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

echo "Sharding $SCRIPT across $SHARDS worktrees of $(git rev-parse --short HEAD)"
for ((i = 0; i < SHARDS; i++)); do
  git worktree add --quiet --detach "$WORK/s$i" HEAD
  for d in "${MODULE_DIRS[@]}"; do ln -s "$ROOT/$d" "$WORK/s$i/$d"; done
done

start=$(date +%s)
for ((i = 0; i < SHARDS; i++)); do
  (
    cd "$WORK/s$i"
    rc=0
    REVIEW_UI_GATE_SHARD="$i/$SHARDS" REVIEW_UI_GATE_SKIP_FINAL_SUITE=1 \
      bash "$SCRIPT" >"$WORK/s$i.log" 2>&1 || rc=$?
    echo "$rc" >"$WORK/s$i.rc"
  ) &
done
wait

FAIL=0
TOTAL=""
RAN_SUM=0
RED_SUM=0
for ((i = 0; i < SHARDS; i++)); do
  printf '\n════ shard %s/%s ════\n' "$i" "$SHARDS"
  cat "$WORK/s$i.log"
  rc="$(cat "$WORK/s$i.rc")"
  # The script's last count line: "plant count: total=<T> ran=<R> red=<P>".
  line="$(grep -E '^plant count: total=[0-9]+ ran=[0-9]+ red=[0-9]+$' "$WORK/s$i.log" | tail -1 || true)"
  if [ "$rc" != 0 ] || [ -z "$line" ]; then
    echo "!! shard $i failed (exit $rc)"
    FAIL=1
    continue
  fi
  t="$(sed -E 's/.*total=([0-9]+).*/\1/' <<<"$line")"
  r="$(sed -E 's/.*ran=([0-9]+).*/\1/' <<<"$line")"
  p="$(sed -E 's/.*red=([0-9]+).*/\1/' <<<"$line")"
  if [ -z "$TOTAL" ]; then TOTAL="$t"; elif [ "$t" != "$TOTAL" ]; then
    echo "!! shard $i counted $t plants, an earlier shard counted $TOTAL"
    FAIL=1
  fi
  RAN_SUM=$((RAN_SUM + r))
  RED_SUM=$((RED_SUM + p))
  # Byte-identity with HEAD: every tracked file, not only the snapshot list.
  if ! git -C "$WORK/s$i" diff --quiet HEAD --; then
    echo "!! shard $i left its worktree different from HEAD:"
    git -C "$WORK/s$i" diff --stat HEAD -- | tail -5
    FAIL=1
  fi
done

printf '\n────────────────────────────────\n'
echo "plants: total=${TOTAL:-?} ran=$RAN_SUM red=$RED_SUM across $SHARDS shards in $(($(date +%s) - start))s"
if [ -z "$TOTAL" ] || [ "$TOTAL" -eq 0 ]; then
  echo "!! no plant ran"
  FAIL=1
elif [ "$RAN_SUM" -ne "$TOTAL" ] || [ "$RED_SUM" -ne "$TOTAL" ]; then
  echo "!! every plant must run exactly once and go red"
  FAIL=1
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
