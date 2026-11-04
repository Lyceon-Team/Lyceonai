# shellcheck shell=bash
# ============================================================================
# Planted-defect harnesses: run the slow ffmpeg round trips only for the plants aimed at them.
# ============================================================================
# @spec [CI wall-time ruling (Karl, 2026-11-04): "cut down that time drastically ... a simpler
#   but equally as effective test"; the harness rules in scripts/ci/worked-examples.mutations.sh
#   (RULE 1-3)] | @implemented [2026-11-04]
#
# plain English: a harness proves, plant by plant, that a NAMED assertion turns red. Only that
# assertion's test has to run for the proof. Each harness re-ran its whole test file per plant,
# and a few tests there are real ffmpeg round trips: ~30 s of the worked-example run, ~19 s of the
# breakdown run, against ~2 s for every other test together. So:
#   - the GREEN BASELINE still runs everything, the round trips included (rt_check_full);
#   - each plant runs the files with the round trips filtered out (rt_check_fast), UNLESS its
#     expected substring is part of a round-trip title, in which case it runs everything;
#   - the baseline also requires the filtered run to skip EXACTLY the round trips (rt_baseline):
#     a renamed round trip, or a filter that starts swallowing another test, fails the harness
#     instead of quietly running less.
# Nothing gets weaker: a plant whose named assertion is in a round trip but is not recognised as
# one goes "stayed GREEN" or "red, but not on ..." under the filter, which is a FAIL, never a pass.
#
# Usage (after sourcing): set RT_FILES (array of test files) and RT_TITLES (array of the round
# trips' exact test titles), then call rt_check_full, rt_check_fast, rt_check_for <expected>
# and rt_baseline <ok-fn> <bad-fn>.

# The titles as one regex alternation, each escaped so it matches literally.
rt_alternation() {
  local t out=""
  for t in "${RT_TITLES[@]}"; do
    t="$(printf '%s' "$t" | sed -e 's/[][\\.^$*+?(){}|/]/\\&/g')"
    out="${out:+$out|}$t"
  done
  printf '%s' "$out"
}

rt_check_full() { pnpm exec vitest run "${RT_FILES[@]}" 2>&1; }

# vitest -t matches the full name ("describe > title"); the lookahead keeps every test whose
# name contains none of the round-trip titles.
rt_check_fast() { pnpm exec vitest run "${RT_FILES[@]}" -t "^(?!.*($(rt_alternation))).*\$" 2>&1; }

# The check a plant needs: everything when its expected substring is part of a round-trip
# title, the filtered run otherwise.
rt_check_for() {
  local t
  for t in "${RT_TITLES[@]}"; do
    case "$t" in *"$1"*) rt_check_full; return ;; esac
  done
  rt_check_fast
}

# rt_baseline <ok-fn> <bad-fn>: the filtered run is green and skips exactly the round trips.
rt_baseline() {
  local out rc n="${#RT_TITLES[@]}"
  out="$(rt_check_fast)"; rc=$?
  if [ "$rc" != 0 ]; then "$2" "filtered run (round trips excluded) not green"; echo "$out" | tail -30; return; fi
  # vitest prints e.g. "Tests  91 passed | 1 skipped (92)".
  case "$out" in
    *"| $n skipped ("*) "$1" "filtered run skips exactly the $n round trip(s)" ;;
    *) "$2" "filtered run does not skip exactly the $n round trip(s) (a title renamed, or the filter catching another test)"
       echo "$out" | grep -E "Tests " ;;
  esac
}
