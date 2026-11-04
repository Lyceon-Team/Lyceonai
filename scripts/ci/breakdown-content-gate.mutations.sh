#!/usr/bin/env bash
# ============================================================================
# Breakdown content gate — MUTATION HARNESS
# ============================================================================
# @spec [Karl's ruling 2026-11-02 (third rulings, 2): a CI check in the public repo that fails if a
#   breakdown script file appears there; Karl's ruling 2026-11-03 (1): "the breakdown-content-gate
#   with its own plants"; SCL-266] | @implemented [2026-11-03]
#
# plain English: two kinds of plant, each required to go red on a NAMED target.
#   TREE plants put a leak into the checkout (a file, staged so `git ls-files` sees it) and run the
#   gate itself: it must exit non-zero AND print the expected rule at the planted path.
#     G1 a voice file under content/qotd-breakdowns/  -> BD-PATH   at that path
#     G2 the weekly export, committed                 -> BD-EXPORT at that path
#     G3 the synthetic script copied to docs/         -> BD-SCRIPT at that path (and no BD-PATH:
#                                                        the content rule fires on its own)
#     G4 the synthetic root with a real question id   -> BD-SCRIPT at that path
#     G5 the gate pointed at an empty repository      -> the ZERO-FILE tripwire
#   CODE plants break one rule in the gate and require its unit test (tests/ci/
#   breakdown-content-gate.test.ts) to go red by name.
#     C1 the path rule removed            C2 the export rule removed
#     C3 the loose script shape dropped   C4 the synthetic-id check dropped
#     C5 arrays not walked
# The rules of the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. A code anchor not found exactly once is STALE (a hard failure); the line a
#            plant lands on is printed. A tree plant's file must not exist before it is planted.
#   RULE 2 — NAMED RED. Exit non-zero AND the declared substring in the output.
#   RULE 3 — GREEN BASELINE + RESTORE. Gate and tests green before; files and index restored after
#            each plant and on exit. Output is captured to a variable and matched with `case`,
#            never piped to `grep -q` (SIGPIPE has produced a false "did not fire" here before).
# ============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
GATE="scripts/ci/breakdown-content-gate.ts"
TEST="tests/ci/breakdown-content-gate.test.ts"
SYN="tests/fixtures/qotd-breakdowns-synthetic"
SCRIPT="$SYN/content/qotd-breakdowns/2026-W03/2026-01-14/script.json"
BACKUP="$(mktemp -d /tmp/bd-gate-mut.XXXX)"
cp "$GATE" "$BACKUP/gate.ts"
PLANTED=()
MADE_DIRS=()

restore() {
  cp "$BACKUP/gate.ts" "$GATE"
  for p in "${PLANTED[@]+"${PLANTED[@]}"}"; do
    git rm -q --cached --ignore-unmatch -- "$p" >/dev/null 2>&1
    rm -f -- "$p"
  done
  # Only the directories a plant created, deepest first.
  for ((i=${#MADE_DIRS[@]}-1; i>=0; i--)); do rmdir -- "${MADE_DIRS[$i]}" 2>/dev/null; done
  PLANTED=(); MADE_DIRS=()
}

# mkdir_tracked <dir>: creates the missing parents of <dir>, remembering each one it made.
mkdir_tracked() {
  local d="$1" missing=()
  while [ ! -d "$d" ]; do missing+=("$d"); d="$(dirname "$d")"; done
  for ((i=${#missing[@]}-1; i>=0; i--)); do mkdir -- "${missing[$i]}" && MADE_DIRS+=("${missing[$i]}"); done
}
trap 'restore; rm -rf "$BACKUP"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

gate() { pnpm exec tsx "$GATE" "$@" 2>&1; }

# expect_red <name> <needle> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1 (stayed green)"; return; fi
  case "$3" in
    *"$2"*) ok "$1 -> $2" ;;
    *) bad "$1 (red, but not on: $2)"; echo "$3" | tail -15 ;;
  esac
}

# tree_plant <name> <path> <content> <expected rule> [<rule that must NOT fire at the path>]
tree_plant() {
  if [ -e "$2" ]; then bad "$1 STALE ($2 already exists)"; return; fi
  mkdir_tracked "$(dirname "$2")"
  printf '%s' "$3" > "$2"
  PLANTED+=("$2")
  git add -f -- "$2"
  echo "        planted $2"
  OUT="$(gate)"; RC=$?
  expect_red "$1" "$4 $2:" "$OUT" "$RC"
  if [ -n "${5:-}" ]; then
    case "$OUT" in
      *"$5 $2:"*) bad "$1 ($5 also fired: the rule under test is not proven on its own)" ;;
    esac
  fi
  restore
}

# code_plant <name> <old> <new> <test name substring>
code_plant() {
  python3 - "$GATE" "$2" "$3" <<'PY' || { bad "$1 STALE"; restore; return; }
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
  OUT="$(pnpm exec vitest run "$TEST" 2>&1)"; RC=$?
  expect_red "$1" "$4" "$OUT" "$RC"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(gate)"; RC=$?
[ "$RC" = 0 ] && ok "gate green on the tree ($OUT)" || { bad "gate not green"; echo "$OUT" | tail -20; }
OUT="$(pnpm exec vitest run "$TEST" 2>&1)"; RC=$?
[ "$RC" = 0 ] && ok "gate tests green" || { bad "gate tests not green"; echo "$OUT" | tail -20; }
if [ "$FAIL" -gt 0 ]; then echo "BREAKDOWN CONTENT GATE MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

REAL_ID_SCRIPT="$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); s["question_id"]="SATM1FXQ001"; print(json.dumps(s))' "$SCRIPT")"

echo "=== TREE: a leak in the checkout turns the gate red ==="
tree_plant "G1 a voice file under content/qotd-breakdowns/" \
  "content/qotd-breakdowns/2026-W45/2026-11-08/voice/hook.wav" "RIFF" "BD-PATH"
tree_plant "G2 the weekly export committed" \
  "docs/qotd-breakdown-schedule-2026-11-09.json" "[]" "BD-EXPORT"
tree_plant "G3 a script copied out of the synthetic root" \
  "docs/marketing/cmo/qotd-notes.json" "$(cat "$SCRIPT")" "BD-SCRIPT" "BD-PATH"
tree_plant "G4 the synthetic root holding a real question id" \
  "$SYN/content/qotd-breakdowns/2026-W03/2026-01-13/script.json" "$REAL_ID_SCRIPT" "BD-SCRIPT"
EMPTY="$(mktemp -d /tmp/bd-gate-empty.XXXX)"; git -C "$EMPTY" init -q
OUT="$(gate "$EMPTY")"; RC=$?
expect_red "G5 the gate pointed at an empty repository" "ZERO-FILE tripwire" "$OUT" "$RC"
rm -rf "$EMPTY"

echo "=== CODE: each rule removed turns its test red ==="
code_plant "C1 the path rule removed" \
  "    if (BREAKDOWN_SEGMENT.test(f.path) && !synthetic)" "    if (false)" \
  "a breakdown path outside the synthetic root is BD-PATH"
code_plant "C2 the export rule removed" \
  "    if (EXPORT_NAME.test(basename(f.path)))" "    if (false)" \
  "the schedule export is BD-EXPORT anywhere"
code_plant "C3 the loose script shape dropped" \
  '    "correct_display_letter" in v && SCRIPT_FIELDS.some((field) => field in v)' "    false" \
  "a trimmed or renamed script is still BD-SCRIPT"
code_plant "C4 the synthetic-id check dropped" \
  "      if (typeof id !== \"string\" || !SYNTHETIC_QUESTION_ID.test(id))" "      if (false)" \
  "a script under the synthetic root with a real question id is BD-SCRIPT"
code_plant "C5 arrays not walked" \
  "  return Array.isArray(doc) ? doc : [doc];" "  return [doc];" \
  "an array of scripts is BD-SCRIPT"

echo
echo "breakdown-content-gate mutations: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then echo "BREAKDOWN CONTENT GATE MUTATIONS: FAIL"; exit 1; fi
echo "BREAKDOWN CONTENT GATE MUTATIONS: PASS"
