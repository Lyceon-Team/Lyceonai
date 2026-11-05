#!/usr/bin/env bash
# ============================================================================
# Mutation harness for markdown tables in question content
# ============================================================================
# @spec [owner brief 2026-11-04, approach A, and the proof it requires: "A planted regression
#   (disable table detection) that turns the test red"] | @implemented [2026-11-04]
#
# Each mutation plants a defect, runs the test that guards it, and requires that test to go RED
# on a NAMED assertion. Same rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants, and the files are
#            restored after each one (and on exit).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/question-tables-mut.XXXX)"

TABLES=shared/question-tables.ts
MATHR=client/src/components/MathRenderer.tsx
STATIC=client/src/components/qotd/StaticMath.tsx
FILES=("$TABLES" "$MATHR" "$STATIC")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

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
PARSER_T=shared/question-tables.test.ts
RENDER_T=client/src/components/question-tables.render.test.tsx

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$PARSER_T" "$RENDER_T")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | tail -30; exit 1; fi

echo "=== (T1) table detection disabled — the regression the owner asked for ==="
# The whole point: with detection off, every stem goes back to one run of text and the pipes
# come back. If this does not redden, nothing below is worth anything.
plant "$TABLES" \
  "export function splitTableBlocks(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  if (content === \"\") return segments;" \
  "export function splitTableBlocks(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  if (content === \"\") return segments;
  return [{ kind: \"text\", start: 0, end: content.length }];" \
  || { bad "T1 STALE"; exit 1; }
run "T1 detection off" "a CRLF table renders as a <table>" "$RENDER_T"

echo "=== (T2) the delimiter row is not required (everything with a pipe becomes a table) ==="
plant "$TABLES" \
  "  if (!line.includes(\"-\")) return false;" \
  "  if (!line.includes(\"-\")) return true;" || { bad "T2 STALE"; exit 1; }
run "T2 delimiter not required" "what is NOT a table" "$PARSER_T"

echo "=== (T3) cells stop being trimmed, so a carriage return rides into the cell ==="
# Aimed at `trim()`, NOT at the line-level `\r` strip: that strip turned out to be redundant
# (trim() already removes a trailing CR), so a plant on it stays green and would be a dead plant
# reading as a live one. trim() is where CRLF handling actually lives, so that is what is planted.
plant "$TABLES" \
  "  return cells.map((c) => c.trim());" \
  "  return cells;" || { bad "T3 STALE"; exit 1; }
run "T3 cells untrimmed" "a trailing carriage return trims away" "$PARSER_T"

echo "=== (T4) line endings are not normalised before rendering ==="
plant "$MATHR" \
  "  const content = normalizeLineEndings(source);" \
  "  const content = source;" || { bad "T4 STALE"; exit 1; }
run "T4 no normalisation" "a CRLF table renders as a <table>" "$RENDER_T"

echo "=== (T5) an escaped pipe splits the cell ==="
# Anchored on the character the escape branch emits, which avoids spelling a backslash through
# two layers of shell quoting — the first cut of this plant was STALE for exactly that reason.
plant "$TABLES" \
  "      cell += \"|\";
      i += 1;
      continue;" \
  "      i += 1;
      continue;" || { bad "T5 STALE"; exit 1; }
run "T5 escaped pipe dropped" "an escaped pipe is content" "$PARSER_T"

echo "=== (T6) the prerendered path loses its table ==="
plant "$STATIC" \
  "  const segments = splitTableBlocks(content);" \
  "  const segments = [{ kind: \"text\" as const, start: 0, end: content.length }];" \
  || { bad "T6 STALE"; exit 1; }
run "T6 StaticMath detection off" "the same content, the same table" "$RENDER_T"

echo
echo "================================"
echo " PASS: $PASS   FAIL: $FAIL"
echo "================================"
[ "$FAIL" = 0 ] || exit 1
