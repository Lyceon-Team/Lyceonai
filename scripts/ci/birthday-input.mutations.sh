#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the three-field birthday input
# ============================================================================
# @spec [owner brief "birthday input" (Karl, 2026-11-04): "a planted regression (drop the year
#   field from the payload) turns a test red"; live bug 2026-11-04 (four profiles saved the
#   CURRENT year); owner ruling 2026-11-04 (5-year plausibility floor on the server)]
#   | @implemented [2026-11-04]
#
# Each mutation plants a defect, runs the test that guards it, and requires that test to go RED on
# a NAMED assertion. Same rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants, and the files are
#            restored after each one (and on exit).
#
# B1 IS THE REGRESSION THE BRIEF ASKS FOR: the year is dropped from the payload and the current
# year is substituted — which is the original defect, reconstructed deliberately. If B1 does not
# redden, nothing in the suite is actually guarding the reported bug.
#
# WHY THE CLIENT IS PLANTED AT ALL (B1, B3, B4, B6). `tsconfig.json` excludes `**/*.test.tsx`, so
# the compiler never sees these tests; only a plant distinguishes "the page submits the year the
# person typed" from "the page submits a year".
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/birthday-mut.XXXX)"

SHARED=packages/shared/src/birthday.ts
BOUNDS=packages/shared/src/profile-role-choice-schema.ts
FIELDS=client/src/components/profile/BirthdayFields.tsx
PAGE=client/src/pages/profile-complete.tsx
REFUSAL=server/lib/role-choice.ts
FILES=("$SHARED" "$BOUNDS" "$FIELDS" "$PAGE" "$REFUSAL")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> — exactly one occurrence, or STALE (exit 9).
plant() {
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write("STALE: target found %d times in %s (expected exactly 1)\n" % (n, p))
    sys.exit(9)
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

check() { pnpm exec vitest run "$@" 2>&1; }
SHARED_T=packages/shared/src/birthday.test.ts
PAGE_T=client/src/pages/profile-complete.birthday.test.tsx
ROUTE_T=tests/ci/date-of-birth-lock.pg.ci.test.ts

# expect_red <name> <expected substring> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

# run <name> <substring> <check files...> — after a plant
run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$SHARED_T" "$PAGE_T")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | tail -30; exit 1; fi

echo "=== (B1) THE BRIEF'S REGRESSION: the year is dropped from the payload ==="
# The original defect, rebuilt: the Year box is ignored and the CURRENT year is substituted, which
# is exactly what the iOS date wheel did. A page that does this stores 2026-04-04 for a student who
# typed 2006 — the four live rows.
plant "$PAGE" \
  "    () => resolveBirthday(birthday, new Date())," \
  "    () => resolveBirthday({ ...birthday, year: String(new Date().getUTCFullYear()) }, new Date())," \
  || { bad "B1 STALE"; exit 1; }
run "B1 year dropped from the payload" "saves 2006 when the student enters 2006" "$PAGE_T"

echo "=== (B2) the 5-year floor is removed from the server ==="
# Without the floor, age 0 is accepted again: a real date, in the past, under 120 years. This is
# the single line that made the four live rows storable.
plant "$REFUSAL" \
  "  if (age < MIN_PLAUSIBLE_AGE_YEARS) {" \
  "  if (false) {" \
  || { bad "B2 STALE"; exit 1; }
run "B2 no server age floor" "refuses a birthday in the current year" "$ROUTE_T"

echo "=== (B3) the 4-digit year rule is dropped ==="
# A 2-digit year widened to a century is the other way a wrong year gets stored silently.
plant "$SHARED" \
  "  } else if (yearRaw.length !== 4) {" \
  "  } else if (false) {" \
  || { bad "B3 STALE"; exit 1; }
run "B3 no 4-digit year rule" "refuses 06 (2-digit) rather than widening it to a century" "$SHARED_T"

echo "=== (B4) the Year is PRE-FILLED instead of starting empty ==="
# The brief is explicit that all three fields start empty and a placeholder is never a value. A
# default year is how this field behaved before #1233, and it is what put every student on an
# assumed date instead of their own.
#
# NOTE ON THE FIRST VERSION OF THIS PLANT, which is the lesson worth keeping: it added
# `defaultValue={...}` next to the placeholder on the Year Input and the test stayed GREEN. That
# read as missing coverage, but it was a dead plant — the Input is CONTROLLED (`value={value.year}`),
# so React ignores `defaultValue` entirely and the plant changed no behaviour at all. The defect
# has to be planted where the value actually comes from: the page's initial state.
plant "$PAGE" \
  "  const [birthday, setBirthday] = useState<BirthdayParts>(EMPTY_BIRTHDAY);" \
  "  const [birthday, setBirthday] = useState<BirthdayParts>({ ...EMPTY_BIRTHDAY, year: String(new Date().getUTCFullYear() - 13) });" \
  || { bad "B4 STALE"; exit 1; }
run "B4 the Year is pre-filled" "the Year placeholder is a hint and is never submitted" "$PAGE_T"

echo "=== (B5) the future check is removed ==="
plant "$SHARED" \
  "  if (age < 0) {" \
  "  if (false) {" \
  || { bad "B5 STALE"; exit 1; }
run "B5 no future check" "refuses tomorrow, naming the future" "$SHARED_T"

echo "=== (B6) the real-calendar-date check is removed ==="
# February 30 reaching the server is how 2010-02-31 got in before F-41.
plant "$SHARED" \
  "  if (!isValidLocalDate(iso)) {" \
  "  if (false) {" \
  || { bad "B6 STALE"; exit 1; }
run "B6 no calendar-date check" "refuses February 30" "$SHARED_T"

echo "=== (B7) the native date input comes back ==="
# The widget itself is the defect. If it returns, the iOS wheel returns with it.
plant "$FIELDS" \
  "            type=\"text\"
            inputMode=\"numeric\"
            autoComplete=\"bday-day\"" \
  "            type=\"date\"
            inputMode=\"numeric\"
            autoComplete=\"bday-day\"" \
  || { bad "B7 STALE"; exit 1; }
run "B7 a native date input returns" "there is no native date input left on the page" "$PAGE_T"

echo
echo "birthday-input mutations: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
