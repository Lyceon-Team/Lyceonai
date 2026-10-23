#!/usr/bin/env bash
# ============================================================================
# Mutation harness for question markup: <u>...</u> underlines, nothing else is markup
# ============================================================================
# @spec [shared/question-markup.ts; scripts/ci/question-markup-gate.ts; live bug 2026-10-11 (18
#   Text Structure and Purpose passages printed their <u> tags); the Codex
#   missing_underlined_target finding] | @implemented [2026-10-11]
#
# Each mutation plants a defect, runs the test that guards it, and requires that test to go RED on
# a NAMED assertion. Same rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants, and the files are
#            restored after each one (and on exit).
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/question-underline-mut.XXXX)"

MARKUP=shared/question-markup.ts
MATH=client/src/components/MathRenderer.tsx
STATIC=client/src/components/qotd/StaticMath.tsx
PASSAGE=client/src/features/exam/lib/passage.ts
GATE=scripts/ci/question-markup-gate.ts
ASSEMBLE=scripts/assemble-batch.ts
FILES=("$MARKUP" "$MATH" "$STATIC" "$PASSAGE" "$GATE" "$ASSEMBLE")
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
RENDER_T=client/src/components/question-underline.test.tsx
GATE_T=tests/ci/question-markup-gate.contract.test.ts
ASSEMBLE_T=tests/assemble-batch.test.ts

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
OUT="$(check "$RENDER_T" "$GATE_T" "$ASSEMBLE_T")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | tail -30; exit 1; fi

echo "=== (1) MathRenderer prints the tags again (the live bug) ==="
plant "$MATH" \
  "        if (piece.kind === 'tag') continue;" \
  "        if (piece.kind === 'tag') {
          fragment.appendChild(document.createTextNode(content.slice(piece.start, piece.end)));
          continue;
        }" || { bad "M1 STALE"; exit 1; }
run "M1 tags printed" "MathRenderer underlines the target and prints no tag" "$RENDER_T"

echo "=== (2) MathRenderer drops the tags but draws no underline ==="
plant "$MATH" \
  "        fragment.appendChild(piece.underlined ? wrapUnderline(run) : run);" \
  "        fragment.appendChild(run);" || { bad "M2 STALE"; exit 1; }
run "M2 underline stripped" "MathRenderer underlines the target and prints no tag" "$RENDER_T"

echo "=== (3) StaticMath prints the tags ==="
plant "$STATIC" \
  "                  if (piece.kind === \"tag\") return null;" \
  "                  if (piece.kind === \"tag\") return content.slice(piece.start, piece.end);" \
  || { bad "M3 STALE"; exit 1; }
run "M3 StaticMath tags printed" "StaticMath underlines the target and prints no tag" "$RENDER_T"

echo "=== (4) the exam passage view loses the underline ==="
plant "$PASSAGE" \
  "      const underlined = part.underlined;" \
  "      const underlined = false;" || { bad "M4 STALE"; exit 1; }
run "M4 exam underline lost" "the exam passage view underlines the target" "$RENDER_T"

echo "=== (5) the allowlist widens to upper-case tags ==="
plant "$MARKUP" \
  "    if (source.startsWith(UNDERLINE_OPEN, i) && !insideAny(i, skip)) {" \
  "    if (source.toLowerCase().startsWith(UNDERLINE_OPEN, i) && !insideAny(i, skip)) {" \
  || { bad "M5 STALE"; exit 1; }
plant "$MARKUP" \
  "    if (source.startsWith(UNDERLINE_CLOSE, i) && !insideAny(i, skip)) {" \
  "    if (source.toLowerCase().startsWith(UNDERLINE_CLOSE, i) && !insideAny(i, skip)) {" \
  || { bad "M5 STALE"; exit 1; }
run "M5 <U> accepted" "an upper-case tag stays literal text" "$RENDER_T"

echo "=== (6) the gate stops checking for an underlined target ==="
plant "$MARKUP" \
  "  if (UNDERLINED_REFERENCE.test(fields.stem)) {" \
  "  if (UNDERLINED_REFERENCE.test(fields.stem) && false) {" || { bad "M6 STALE"; exit 1; }
run "M6 missing target unchecked" "goes red, naming the item, when an underlined item loses its <u>" "$GATE_T"

echo "=== (7) the gate stops checking for raw HTML ==="
plant "$MARKUP" \
  "    if (stray.length > 0) {" \
  "    if (stray.length > 0 && false) {" || { bad "M7 STALE"; exit 1; }
run "M7 raw HTML unchecked" "goes red on raw HTML in an option, the stem or the explanation" "$GATE_T"

echo "=== (8) a repaired item's baseline line is allowed to linger ==="
plant "$GATE" \
  "    if (!stillMissing.has(id)) {" \
  "    if (!stillMissing.has(id) && false) {" || { bad "M8 STALE"; exit 1; }
run "M8 ratchet loosened" "goes red when a baselined item is repaired but its baseline line stays" "$GATE_T"

echo "=== (9) the assembly gate stops reporting markup violations ==="
plant "$ASSEMBLE" \
  "      v(mv.field, mv.message);" \
  "      void mv;" || { bad "M9 STALE"; exit 1; }
# Named on the two-span case, which only this path checks. The missing-target case it first named
# is ALSO caught by assemble-batch.ts Rule 11 (fc85c67a, merged from questions on 2026-10-13), so
# with this plant applied that test stayed green and M9 failed: red, but not on its name.
run "M9 authoring unguarded" "rejects an underlined-sentence stem with two <u>...</u> spans" "$ASSEMBLE_T"

echo "=== (10) restored: everything green again ==="
OUT="$(check "$RENDER_T" "$GATE_T" "$ASSEMBLE_T")"; RC=$?
if [ "$RC" = 0 ]; then ok "green after restore"; else bad "not green after restore"; echo "$OUT" | tail -30; fi

echo
echo "question-underline mutations: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
