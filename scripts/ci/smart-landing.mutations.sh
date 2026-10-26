#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the smart landing (the within-student rotating landing test)
# ============================================================================
# @spec [owner brief "Smart landing: within-student rotating landing test" (Karl, 2026-10-26)
#   Acceptance: "Planted defects: one per rule"; Karl's rulings A–E on Step 0 the same day]
#   | @implemented [2026-10-26]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants and the files are
#            restored after each one (and on exit).
#
# SQL plants edit the migration that DEFINES the function today, and the harness re-checks that
# it is still the LAST definer (CLAUDE.md, "a migration that replaces a function body orphans its
# mutations"). Where a rule has two guards (the service's stored-arm read and the claim's own
# "the window's stored arm wins"), the plant removes both, or the second would hold the line
# alone and the plant would read as "not caught".
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261113000000_smart_landing.sql"
SCHEMA="packages/shared/src/smart-landing-schema.ts"
ASSIGN="server/services/landing/assignment.ts"
SVC="server/services/landing/landing-service.ts"
DEPS="server/services/landing/landing-deps.ts"
PRACTICE="server/routes/practice-canonical.ts"
SHELL_TSX="client/src/components/layout/FocusShell.tsx"
ENTRY="client/src/lib/landing-entry.ts"
UNIT=tests/ci/smart-landing.unit.test.ts
PG=tests/ci/smart-landing.pg.ci.test.ts
ROUTES=tests/ci/smart-landing.contract.test.ts
FOCUS=client/src/components/layout/FocusShell.test.tsx
CRONS=tests/ci/vercel-cron-schedules.contract.test.ts
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/sl-mut.XXXX)"

FILES=("$MIG" "$SCHEMA" "$ASSIGN" "$SVC" "$DEPS" "$PRACTICE" "$SHELL_TSX" "$ENTRY" "vercel.json")
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

pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null || { echo "SMART LANDING MUTATIONS: Postgres is required (PGHOST=$PGHOST)"; exit 1; }

# expect_red <name> <expected substring> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | grep -v '^{"severity"' | tail -25 ;;
  esac
}

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }
need_last() {
  [ "$(last_definer "$1")" = "$MIG" ] || { bad "$1 is last defined in $(last_definer "$1"), not $MIG"; exit 1; }
}

# run <name> <substring> <check files...> — after a plant
run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}
stale() { bad "$1 STALE"; exit 1; }

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$UNIT" "$PG" "$ROUTES" "$FOCUS" "$CRONS")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | grep -v '^{"severity"' | tail -30; fi
if [ "$FAIL" -gt 0 ]; then echo "SMART LANDING MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

need_last landing_claim_open
need_last landing_record_escape
need_last landing_claim_summaries

# ── Assignment ──────────────────────────────────────────────────────────────────────────────────

echo "=== (1) the hash ignores the window: the arm never changes across windows ==="
plant "$ASSIGN" '.update(`${salt}:${profileId.toLowerCase()}:${windowIndex}`)' '.update(`${salt}:${profileId.toLowerCase()}:0`)' || stale SL1
run "SL1 deterministic, changes across windows" "U1 the same (student, window)" "$UNIT"

echo "=== (2) a free student is offered the Pro arms ==="
plant "$SCHEMA" "  if (facts.isPro) {" "  if (true) {" || stale SL2
run "SL2 free never a Pro arm" "U2 only eligible arms" "$UNIT"

echo "=== (3) Pro without a plan is offered session_today ==="
plant "$SCHEMA" "        : LANDING_ARMS_PRO_WITHOUT_PLAN)," "        : LANDING_ARMS_PRO_WITH_PLAN)," || stale SL3
run "SL3 Pro without a plan: plan_builder only" "U2 only eligible arms" "$UNIT"

echo "=== (4) dashboard takes 1/6, not 1/3 ==="
plant "$SCHEMA" "unit < config.dashboardShare" "unit < config.dashboardShare / 2" || stale SL4
run "SL4 dashboard 1/3" "U3 dashboard takes 1/3" "$UNIT"

echo "=== (5) eligibility re-read on every open (both guards: the service and the claim) ==="
plant "$SVC" "    stored === null" "    true" || stale SL5a
plant "$MIG" "  SELECT w.arm, w.eligible_arms INTO v_arm, v_elig" "  SELECT p_arm, p_eligible_arms INTO v_arm, v_elig" || stale SL5b
run "SL5 eligibility frozen at window start" "P3 eligibility is frozen" "$PG"

echo "=== (6) every open of the day lands, not only the first ==="
plant "$MIG" "  CONSTRAINT landing_shows_one_per_day UNIQUE (profile_id, window_index, chicago_day)," "  CONSTRAINT landing_shows_one_per_day UNIQUE (profile_id, window_index, chicago_day, shown_at)," || stale SL6a
plant "$MIG" "  ON CONFLICT (profile_id, window_index, chicago_day) DO NOTHING" "  ON CONFLICT (profile_id, window_index, chicago_day, shown_at) DO NOTHING" || stale SL6b
run "SL6 first open of the Chicago day only" "P1/P2 one stored arm per window" "$PG"

# ── Precedence, who, the switch ─────────────────────────────────────────────────────────────────

echo "=== (7) an in-progress session no longer resumes ==="
plant "$SVC" "  const resume = await deps.resumePath(caller.id, windowStart(windowIndex));" "  const resume: string | null = windowStart(windowIndex) === null ? null : null;" || stale SL7
run "SL7 resume precedence" "P4 an in-progress session resumes" "$PG"

echo "=== (8) a deep link (a hash) counts as a default entry ==="
plant "$ENTRY" '  return pathname === "/dashboard" && search === "" && hash === "";' '  return pathname === "/dashboard" && search === "";' || stale SL8
run "SL8 deep link wins (hash)" "U7 only Home with nothing else" "$UNIT"

echo "=== (9) a sign-in with a return path counts as a default entry ==="
plant "$ENTRY" '  if (next === null && destination === "/dashboard") defaultEntry = true;' '  if (destination === "/dashboard") defaultEntry = true;' || stale SL9
run "SL9 deep link wins (next)" "U7 only Home with nothing else" "$UNIT"

echo "=== (10) a guardian or an admin is assigned ==="
plant "$SVC" '  if (caller.role !== "student") return NO_LANDING;' '' || stale SL10
run "SL10 students only" "P5 students only" "$PG"

echo "=== (11) unknown age is assigned ==="
plant "$SVC" "  if (caller.isUnder13 !== false) return NO_LANDING;" "  if (caller.isUnder13 === true) return NO_LANDING;" || stale SL11
run "SL11 under 13 and unknown age" "P6 under 13 and unknown age" "$PG"

echo "=== (12) the kill switch is ignored ==="
plant "$SVC" "  if (!config.enabled) return NO_LANDING;" "" || stale SL12
run "SL12 kill switch" "P7 kill switch off" "$PG"

echo "=== (13) the kill switch ships ON ==="
plant "$MIG" "('landing_rotation_enabled', 'false'::jsonb," "('landing_rotation_enabled', 'true'::jsonb," || stale SL13
run "SL13 seeded OFF" "P7 kill switch off" "$PG"

# ── Sets ────────────────────────────────────────────────────────────────────────────────────────

echo "=== (14) the lead draw is not held to easy/medium (the practice start) ==="
plant "$PRACTICE" "            difficulties: draw.easyMediumOnly
              ? easyMediumLead" "            difficulties: draw.easyMediumOnly && false
              ? easyMediumLead" || stale SL14
run "SL14 first two easy or medium (practice start)" "P9 every landing set opens with two easy/medium" "$PG"

echo "=== (15) the plan has no easy/medium lead ==="
plant "$ASSIGN" "      { sections, easyMediumOnly: true, limit: lead }," "      { sections, easyMediumOnly: false, limit: lead }," || stale SL15
run "SL15 first two easy or medium (plan)" "U4 the first 2 draws are easy/medium" "$UNIT"

echo "=== (15b) a hard-only session's lead widens to every difficulty ==="
plant "$ASSIGN" "  return narrowed.length > 0 ? narrowed : sessionDifficulties;" "  return narrowed;" || stale SL15b
run "SL15b the lead never widens the session's difficulties" "U4b the lead narrows the session's own difficulties" "$UNIT"

echo "=== (16) math first is 4 Math, not 5 ==="
plant "$ASSIGN" "  const math = Math.min(LANDING_MATH_FIRST_COUNT, size);" "  const math = Math.min(LANDING_MATH_FIRST_COUNT - 1, size);" || stale SL16
run "SL16 math first 5 + 5" "P9 every landing set opens with two easy/medium" "$PG"

echo "=== (17) a fallback is not recorded ==="
plant "$SVC" "  if (fallbackReason !== null)" "  if (fallbackReason === null && fallbackReason !== null)" || stale SL17
run "SL17 fallback_reason recorded" "P10 a free student with no quota left" "$PG"

echo "=== (18) '5 more' starts after any landing ==="
plant "$SVC" '  if (show === null || show.arm !== "qotd_then_more") return { path: null };' '  if (show === null) return { path: null };' || stale SL18
run "SL18 5 more only after qotd_then_more" "P14 '5 more' only after a qotd_then_more" "$PG"

echo "=== (19) session_today launches without re-checking the entitlement ==="
plant "$DEPS" "    if (
      !(await EntitlementService.canAccessFeature(
        args.caller.id,
        \"calendar_access\",
      ))
    ) {" "    if (args.caller.id === \"\") {" || stale SL19
run "SL19 entitlement at launch" "P17 session_today re-checks the entitlement" "$PG"

# ── Events ──────────────────────────────────────────────────────────────────────────────────────

echo "=== (20) landing_assigned drops device_class ==="
plant "$SVC" "      arm: show.arm,
      device_class: request.deviceClass,
    });
  }" "      arm: show.arm,
    });
  }" || stale SL20
run "SL20 exactly the listed properties" "P11 the events fire with exactly the listed properties" "$PG"

echo "=== (21) device_class accepts anything ==="
plant "$SCHEMA" "export const deviceClassSchema = z.enum(DEVICE_CLASSES);" "export const deviceClassSchema = z.string();" || stale SL21
run "SL21 device_class coarse only" "U5 device_class is coarse only" "$UNIT"

echo "=== (22) the open body accepts unknown keys (a client role, arm or clock) ==="
plant "$SCHEMA" "    client_instance_id: z.string().min(1).max(200),
  })
  .strict();
export type LandingOpenRequest" "    client_instance_id: z.string().min(1).max(200),
  });
export type LandingOpenRequest" || stale SL22
run "SL22 server-authoritative body" "C2 anything beyond the coarse device class" "$ROUTES"

echo "=== (23) escape counts up to 60 s ==="
plant "$MIG" "     AND p_now <= s.shown_at + make_interval(secs => p_max_seconds)" "     AND p_now <= s.shown_at + make_interval(secs => p_max_seconds * 2)" || stale SL23
run "SL23 escape within 30 s" "P12 escape counts once, within 30 s" "$PG"

echo "=== (24) escape counts for dashboard ==="
plant "$MIG" "     AND s.arm <> 'dashboard'" "     AND true" || stale SL24
run "SL24 escape never for dashboard" "P12 escape counts once, within 30 s" "$PG"

echo "=== (25) the summary counts past the day's end ==="
plant "$MIG" "AND i.answered_at >= b.shown_at AND i.answered_at < b.ends_at)" "AND i.answered_at >= b.shown_at AND i.answered_at < b.ends_at + interval '2 days')" || stale SL25
run "SL25 summary bounded by the next landing / day end" "P13 the nightly summary counts answers" "$PG"

echo "=== (26) the summary is sent again every night ==="
plant "$MIG" "     WHERE s.summarized_at IS NULL" "     WHERE true" || stale SL26
run "SL26 summary once" "P13 the nightly summary counts answers" "$PG"

echo "=== (27) the nightly job runs on another schedule ==="
plant vercel.json '"path": "/api/internal/landing-summaries",
      "schedule": "30 6 * * *"' '"path": "/api/internal/landing-summaries",
      "schedule": "30 4 * * *"' || stale SL27
run "SL27 nightly after Chicago midnight" "vercel" "$CRONS"

# ── Data ────────────────────────────────────────────────────────────────────────────────────────

echo "=== (28) windows survive the profile ==="
plant "$MIG" "  profile_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE," "  profile_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT," || stale SL28
run "SL28 deletion cascade" "P15 deleting the profile" "$PG"

echo "=== (29) authenticated can read the windows ==="
plant "$MIG" "GRANT SELECT, INSERT ON public.landing_windows TO service_role;" "GRANT SELECT, INSERT ON public.landing_windows TO service_role, authenticated;" || stale SL29
run "SL29 grants" "P16 grants" "$PG"

# ── Home is reachable ───────────────────────────────────────────────────────────────────────────

echo "=== (30) a landing runner's back link goes to the section, not Home ==="
plant "$SHELL_TSX" '  const backHref = fromLanding ? "/dashboard" : sectionHome;' '  const backHref = sectionHome;' || stale SL30
run "SL30 Home from every landing" "reads 'Home' and goes Home" "$FOCUS"

echo
echo "SMART LANDING MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
