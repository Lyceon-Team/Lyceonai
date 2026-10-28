#!/usr/bin/env bash
# The sign-up channel and campaign — mutation harness.
#
# @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
#       2026-10-28) item 2 (coarse channel + allowlisted campaign, first touch only, no raw URL,
#       works without the analytics cookie) and item 3 ("Tests and planted defects for both");
#       Public Disclosure Doctrine rule 7 (under-13 excluded)] | @implemented [2026-10-28]
#
# Each plant breaks ONE rule and must turn a NAMED test red:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other test is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function edits the migration that LAST defines it.
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261121000000_landing_new_students_signup_channel.sql"
SHARED="packages/shared/src/signup-attribution.ts"
CLIENT="client/src/lib/signup-attribution.ts"
WRITER="server/lib/signup-attribution.ts"
OAUTH="server/routes/oauth-callback-routes.ts"
AUTHCTX="client/src/contexts/SupabaseAuthContext.tsx"
UNIT=tests/ci/signup-attribution.unit.test.ts
CLIENT_TEST=client/src/lib/signup-attribution.test.ts
PG=tests/ci/signup-attribution.pg.ci.test.ts
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/sa-mut.XXXX)"

FILES=("$MIG" "$SHARED" "$CLIENT" "$WRITER" "$OAUTH" "$AUTHCTX")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> — exactly one occurrence, or STALE.
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

pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null || { echo "SIGNUP ATTRIBUTION MUTATIONS: Postgres is required (PGHOST=$PGHOST)"; exit 1; }

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | grep -v '^{"severity"' | tail -25 ;;
  esac
}

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }

run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}
stale() { bad "$1 STALE"; exit 1; }

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$UNIT" "$CLIENT_TEST" "$PG")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | grep -v '^{"severity"' | tail -30; fi
if [ "$FAIL" -gt 0 ]; then echo "SIGNUP ATTRIBUTION MUTATIONS: BASELINE NOT GREEN"; exit 1; fi
[ "$(last_definer profiles_signup_attribution_guard)" = "$MIG" ] || { bad "profiles_signup_attribution_guard is last defined in $(last_definer profiles_signup_attribution_guard), not $MIG"; exit 1; }

# ── The allowlists and the first touch ──────────────────────────────────────────────────────────

echo "=== (1) reddit is not a known source ==="
plant "$SHARED" '  reddit: "reddit",
' '' || stale SA1
run "SA1 known sources" "A1 each known utm_source is its channel" "$UNIT"

echo "=== (2) any campaign is kept, not only allowlisted ones ==="
plant "$SHARED" '  return parsed.success ? parsed.data : null;' '  return typeof raw === "string" && raw.length > 0 ? (raw as SignupCampaign) : null;' || stale SA2
run "SA2 allowlisted campaigns only" "A3 only allowlisted campaigns are kept" "$UNIT"

echo "=== (3) the carried first touch loses to the sign-up page's UTM ==="
plant "$SHARED" '  if (carried.success) {' '  if (carried.success && params.get("utm_source") === null) {' || stale SA3
run "SA3 first touch wins" "A4 a carried touch wins over the page's UTM" "$UNIT"

# ── The browser: no storage, carried on the link ───────────────────────────────────────────────

echo "=== (4) the link into sign-up does not carry it ==="
plant "$CLIENT" '  if (url.origin !== origin || !SIGNUP_ENTRY_PATHS.has(url.pathname)) {' '  if (true) {' || stale SA4
run "SA4 carried into sign-up" "C2 a click into sign-up carries it" "$CLIENT_TEST"

echo "=== (5) the browser keeps it in storage ==="
plant "$CLIENT" '  attribution ??= deriveSignupAttribution(window.location.search);' '  attribution ??= deriveSignupAttribution(window.location.search);
  window.sessionStorage.setItem("lyceon_signup_channel", attribution.channel);' || stale SA5
run "SA5 no storage, no consent needed" "C1 the landing address's UTM is the attribution, with no storage written" "$CLIENT_TEST"

echo "=== (6) the Google sign-up does not send it ==="
plant "$AUTHCTX" '      callbackParams.set(SIGNUP_CHANNEL_PARAM, attribution.channel);' '' || stale SA6
run "SA6 Google sign-up sends it" "W2 both sign-up paths send it" "$UNIT"

echo "=== (7) the Google callback does not record it ==="
plant "$OAUTH" '            req.query.signup_channel,' '            undefined,' || stale SA7
run "SA7 Google callback records it" "W2 both sign-up paths send it" "$UNIT"

# ── The server's writer and the database's guard ───────────────────────────────────────────────

echo "=== (8) an onboarded account is written ==="
plant "$WRITER" '    .is("signup_channel", null)
    .is("profile_completed_at", null);' '    .is("signup_channel", null);' || stale SA8
run "SA8 before onboarding only" "R3 an onboarded account is never written" "$PG"

echo "=== (9) a stored channel can be changed ==="
plant "$MIG" '       AND NEW.signup_channel IS DISTINCT FROM OLD.signup_channel THEN' '       AND false THEN' || stale SA9
run "SA9 set once (the database)" "R5 the database: a stored channel or campaign cannot be changed" "$PG"

echo "=== (10) an under-13 profile keeps its channel ==="
plant "$MIG" '  IF NEW.is_under_13 IS TRUE THEN' '  IF false THEN' || stale SA10
run "SA10 never held for an under-13" "R6 under 13" "$PG"

echo "=== (11) the campaign accepts free text ==="
plant "$MIG" "    signup_campaign IS NULL OR signup_campaign ~ '^[a-z0-9_]{1,40}\$');" "    signup_campaign IS NULL OR length(signup_campaign) > 0);" || stale SA11
run "SA11 no URL or free text" "R5 the database: a stored channel or campaign cannot be changed" "$PG"

echo
echo "SIGNUP ATTRIBUTION MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
