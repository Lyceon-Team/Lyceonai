#!/usr/bin/env bash
# ============================================================================
# Mutation harness: sender name per email type + the QOTD subject and preview line
# ============================================================================
# @spec [owner brief "Notification emails — sender name per email type + subject/preview that
#   earns the open" (Karl, 2026-10-14), acceptance "Planted defects: one per rule"] | @implemented [2026-10-14]
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
BACKUPS="$(mktemp -d /tmp/email-sender-mut.XXXX)"

SENDER=packages/shared/src/email-sender.ts
TRANSPORT=server/lib/notifications/transport.ts
SUBJECT=packages/shared/src/home-qotd-schema.ts
SHARED=server/lib/notifications/templates/shared.ts
ACCOUNT=server/lib/notifications/templates/accountability.ts
SEND_CTX=server/lib/notifications/qotd-daily-send-context.ts
FILES=("$SENDER" "$TRANSPORT" "$SUBJECT" "$SHARED" "$ACCOUNT" "$SEND_CTX")
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

T=tests/ci/email-sender-names.contract.test.ts
check() { pnpm exec vitest run "$@" 2>&1; }

# expect_red <name> <expected substring> <output> <rc>
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
OUT="$(check "$T")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | tail -30; exit 1; fi

echo "=== (1) the transport sends the bare address again ==="
plant "$TRANSPORT" "        from: formatFromHeader(input.fromCategory, from)," "        from," || { bad "E1 STALE"; exit 1; }
run "E1 bare From" "the template picks its category and the transport writes the From header" "$T"

echo "=== (2) a template picks the wrong category (the guardian digest as plain Lyceon) ==="
plant "$ACCOUNT" $'    preview: sections.flatMap((sec) => sec.lines)[0] ?? digestSubject(payload),\n    fromCategory: "guardian",' $'    preview: sections.flatMap((sec) => sec.lines)[0] ?? digestSubject(payload),\n    fromCategory: "general",' || { bad "E2 STALE"; exit 1; }
run "E2 digest category" "guardian daily digest: the template picks its category" "$T"

echo "=== (3) an unknown category gets no fallback name ==="
plant "$SENDER" "    parsed.success ? names[parsed.data] : DEFAULT_EMAIL_SENDER_NAME," "    parsed.success ? names[parsed.data] : \"notifications\"," || { bad "E3 STALE"; exit 1; }
run "E3 fallback" "S2: an unknown or missing category falls back to Lyceon" "$T"

echo "=== (4) the sender name is no longer sanitized ==="
plant "$SENDER" '    .replace(/[<>"\u0000-\u001f\u007f]/g, " ")' '    .replace(/$^/g, " ")' || { bad "E4 STALE"; exit 1; }
run "E4 sanitize" "S3: an unsafe name is sanitized" "$T"

echo "=== (5) the subject loses its 'SAT Question of the Day' start ==="
plant "$SUBJECT" 'export const QOTD_EMAIL_SUBJECT_PREFIX = "SAT Question of the Day";' 'export const QOTD_EMAIL_SUBJECT_PREFIX = "Your Question of the Day";' || { bad "E5 STALE"; exit 1; }
run "E5 prefix" "S4: the QOTD subject always starts with 'SAT Question of the Day'" "$T"

echo "=== (6) the streak version starts a day late ==="
plant "$SUBJECT" "  if (streak >= QOTD_EMAIL_STREAK_THRESHOLD) {" "  if (streak > QOTD_EMAIL_STREAK_THRESHOLD) {" || { bad "E6 STALE"; exit 1; }
run "E6 threshold" "streak 2" "$T"

echo "=== (7) the preview line never reaches the HTML ==="
plant "$SHARED" "    html: withPreheader(parts.html, parts.preview)," "    html: parts.html," || { bad "E7 STALE"; exit 1; }
run "E7 preheader" "S6: every email's preview line is present, correct, and first in its HTML" "$T"

echo "=== (8) the row-to-email projection widens to the answer ==="
plant "$SEND_CTX" "      domain: row.domain," "      domain: \`\${row.domain} \${row.correct_answer ?? \"\"}\`," || { bad "E8 STALE"; exit 1; }
run "E8 answer leak" "S7: no QOTD subject or preview contains the answer" "$T"

echo "=== (9) a missing sender address no longer stops the send ==="
plant "$TRANSPORT" "    if (!from) {" "    if (!from && false) {" || { bad "E9 STALE"; exit 1; }
run "E9 missing address" "S8: a missing NOTIFICATION_FROM_EMAIL still refuses to send" "$T"

echo "=== (10) restored: everything green again ==="
OUT="$(check "$T")"; RC=$?
if [ "$RC" = 0 ]; then ok "green after restore"; else bad "not green after restore"; echo "$OUT" | tail -30; fi

echo
echo "email-sender-names mutations: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
