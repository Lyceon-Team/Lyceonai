#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the QOTD breakdown pilot (owner brief "QOTD breakdown pilot, 2 weeks",
# Karl, 2026-11-02, Part C: "Plant a mutation that uses the original order or the canonical
# letter, and show it red"; SCL-266)
# ============================================================================
# @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02), Part C; SCL-266]
#   | @implemented [2026-11-02]
#
# plain English: each plant puts one defect into the breakdown, runs its test file and requires
# it to go RED on a NAMED assertion. The rules of the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#            The line the plant lands on is printed (CLAUDE.md "a plant must mutate the call site
#            under test": by line number, not by pattern).
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. The tests are green before the plants and the files are
#            restored after each one (and on exit).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/qotd-breakdown-mut.XXXX)"

FILES=(
  "shared/qotd/breakdown.ts"
  "scripts/qotd-social/breakdown.ts"
  "scripts/qotd-social/breakdown-requirements.txt"
  ".github/workflows/qotd-social.yml"
  "shared/qotd/plain-math.ts"
)
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new>  — exactly one occurrence, or STALE (exit 9). Prints file:line.
plant() {
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write("STALE: target found %d times in %s (expected exactly 1)\n" % (n, p))
    sys.exit(9)
print("        planted at %s:%d" % (p, s[: s.index(old)].count("\n") + 1))
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

TEST=tests/ci/qotd-breakdown.test.ts
ts_check() { pnpm exec vitest run "$TEST" 2>&1; }

# expect_red <name> <expected substring> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

# ts_plant <name> <file> <old> <new> <expected>
ts_plant() {
  plant "$2" "$3" "$4" || { bad "$1 STALE"; restore; return; }
  OUT="$(ts_check)"; RC=$?
  expect_red "$1" "$5" "$OUT" "$RC"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(ts_check)"; RC=$?
[ "$RC" = 0 ] && ok "breakdown tests green" || { bad "breakdown tests not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "QOTD BREAKDOWN MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== the hard rule: the stored order and the stored letter ==="
ts_plant "B1 the question's original (canonical) order instead of the stored one" shared/qotd/breakdown.ts \
  "    const option = q.options[k];" \
  "    const option = [...q.options].sort((x, y) => x.id.localeCompare(y.id))[k];" \
  "letters the choices by the stored order and keys the answer on the stored letter"
ts_plant "B2 the canonical letter instead of the stored display letter" shared/qotd/breakdown.ts \
  "      correct_answer: stored," \
  "      correct_answer: q.correct_option_id ?? stored," \
  "letters the choices by the stored order and keys the answer on the stored letter"
ts_plant "B3 the stored-letter check dropped (a mismatched day rendered)" shared/qotd/breakdown.ts \
  "    shown !== stored" "    false" \
  "refuses a day whose stored letter is not where the correct choice is shown"

echo "=== anti-leak: today refused ==="
ts_plant "B4 today's QOTD accepted (the past-day check skipped)" scripts/qotd-social/breakdown.ts \
  "  const problem = pastDateProblem(date, now);" "  const problem: string | null = null;" \
  "today's QOTD is refused"

echo "=== the fallback rule ==="
ts_plant "B5 a letter-naming explanation let through (rule b)" shared/qotd/breakdown.ts \
  "  return LETTER_NAMED.some((re) => re.test(text));" "  return false;" \
  "names a letter"
ts_plant "B6 a grid-in let through (rule c)" shared/qotd/breakdown.ts \
  '  if (unreadable === "not_multiple_choice") return "grid_in";' "" \
  "a grid-in, a long passage, a paired passage"

echo "=== captions, voice, window, workflow ==="
ts_plant "B7 the music credit dropped from the TikTok caption (CC BY 4.0)" shared/qotd/breakdown.ts \
  "  const caption = socialTiktokCaption(headline, test, section, [musicCredit]);" \
  "  const caption = socialTiktokCaption(headline, test, section, []);" \
  "each caption is the canonical builder's output with the credit last"
ts_plant "B8 the clone voice instead of Kokoro af_heart" scripts/qotd-social/breakdown.ts \
  'export const QOTD_BREAKDOWN_VOICE_PROFILE = "af_heart";' 'export const QOTD_BREAKDOWN_VOICE_PROFILE = "clone";' \
  "the voice is Kokoro af_heart, never the clone"
ts_plant "B9 the pilot on by default" shared/qotd/breakdown.ts \
  "  qotdBreakdownPilotSchema.parse({ start: null, end: null });" \
  '  qotdBreakdownPilotSchema.parse({ start: "2026-11-01", end: "2026-11-14" });' \
  "is off until Karl sets the dates"
ts_plant "B10 the pilot never ends" shared/qotd/breakdown.ts \
  '  if (postedOn > pilot.end) return "ended";' "" \
  "runs from start to end inclusive"
ts_plant "B11 the breakdown blocks the QOTD (inside its job)" .github/workflows/qotd-social.yml \
  "    needs: assets"$'\n'"    if: always()" "    needs: assets" \
  "runs after the QOTD job, whatever its result"
ts_plant "B12 an unpinned Python package" scripts/qotd-social/breakdown-requirements.txt \
  "kokoro-onnx==0.6.1" "kokoro-onnx" \
  "every package pinned"
ts_plant "B13 maths spoken as symbols (the voice check would mismatch)" shared/qotd/plain-math.ts \
  '  [/=/g, " equals "],' "" \
  "spoken maths: operators in words"

echo
echo "qotd-breakdown mutations: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then echo "QOTD BREAKDOWN MUTATIONS: FAIL"; exit 1; fi
echo "QOTD BREAKDOWN MUTATIONS: PASS"
