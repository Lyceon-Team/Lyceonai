#!/usr/bin/env bash
# Server-side funnel events — mutation harness.
#
# @spec [owner brief "Server-side funnel events" (Karl, 2026-10-21) "Acceptance": "Planted defects:
#       one per rule (including one that adds a forbidden property, which must turn a test red)"]
#       | @implemented [2026-10-21]
#
# Each plant breaks ONE rule the brief locks and must turn a NAMED test red. Same rules as the
# other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED TEST. Only vitest's failure lines (FAIL / ×) are matched, so a
#            passing test that merely shares the name cannot satisfy a plant.
#   RULE 3 — LAST DEFINER. A plant on a SQL function must edit the migration that LAST defines it
#            (need_last), or it edits a body the pipeline overwrites and proves nothing.
# After every plant the file is restored and `cmp`'d byte-identical to its snapshot.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261109000000_analytics_funnel_milestones.sql"
FUNNEL="server/lib/analytics/funnel-events.ts"
EMIT="server/lib/analytics/emit-event.ts"
REGISTRY="server/lib/analytics/event-registry.generated.ts"
PRACTICE="server/routes/practice-canonical.ts"
QOTD="server/routes/home-qotd-routes.ts"
PROFILE="server/routes/profile-routes.ts"
PLAN="server/services/calendar/plan-service.ts"
WEBHOOK="server/lib/stripe/webhook-handler.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/funnel-mut.XXXX)"

FILES=("$MIG" "$FUNNEL" "$EMIT" "$REGISTRY" "$PRACTICE" "$QOTD" "$PROFILE" "$PLAN" "$WEBHOOK")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() {
  for f in "${FILES[@]}"; do
    cp "$BACKUPS/$f" "$f"
    cmp -s "$BACKUPS/$f" "$f" || { echo "  !! REVERT NOT BYTE-IDENTICAL: $f"; FAIL=$((FAIL+1)); }
  done
}
trap 'for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> [<old2> <new2> ...] — each old exactly once, or STALE.
plant() {
  python3 - "$@" <<'PY'
import io, sys
p = sys.argv[1]
pairs = sys.argv[2:]
s = io.open(p, encoding="utf-8").read()
for i in range(0, len(pairs), 2):
    old, new = pairs[i], pairs[i + 1]
    n = s.count(old)
    if n != 1:
        sys.stderr.write("STALE: target found %d times in %s (expected exactly 1)\n" % (n, p))
        sys.exit(9)
    s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
PY
}

check() { pnpm exec vitest run "$@" 2>&1; }
PG_SUITE=tests/ci/funnel-events.pg.ci.test.ts
DIAG=tests/ci/diagnostic.handler-pg.ci.test.ts
QOTD_PG=tests/ci/home-qotd.pg.ci.test.ts
LIFECYCLE_PG=tests/ci/lifecycle-email.pg.ci.test.ts
PLAN_TEST=tests/ci/calendar.plan-service.test.ts
WEBHOOK_TEST=tests/ci/lifecycle-entitled-webhook.contract.test.ts

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "FUNNEL EVENTS MUTATIONS: no Postgres at $PGHOST:$PGPORT — the suites need it (a skip is not a pass)"
  exit 1
fi

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  local failures
  failures="$(printf '%s\n' "$3" | grep -E '(FAIL |×)' || true)"
  case "$failures" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }
need_last() {
  [ "$(last_definer "$1")" = "$3" ] || { bad "$2 targets $3 but $1 is last defined in $(last_definer "$1")"; exit 1; }
}

run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$PG_SUITE" "$DIAG" "$QOTD_PG" "$LIFECYCLE_PG" "$PLAN_TEST" "$WEBHOOK_TEST")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "FUNNEL EVENTS MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

# --- Once per student, ever (enforced on the server) ------------------------------------------
echo "=== (1) an already-claimed milestone is sent again ==="
plant "$FUNNEL" '  if (!claimed) return "already_sent";' '' || { bad "M1 STALE"; exit 1; }
run "M1 once-only (server)" "F1: each of the six fires once" "$PG_SUITE"

echo "=== (2) the claim reports true for a row that already exists ==="
need_last analytics_funnel_claim M2 "$MIG"
plant "$MIG" '  SELECT EXISTS (SELECT 1 FROM inserted);' '  SELECT true FROM (SELECT count(*) FROM inserted) x;' || { bad "M2 STALE"; exit 1; }
run "M2 once-only (insert-once claim)" "F2: concurrent first answers send first_answer once" "$PG_SUITE"

# --- Only the listed properties --------------------------------------------------------------
echo "=== (3) a forbidden property (the question id) is added to first_answer ==="
plant "$FUNNEL" '        source,
        hours_since_signup: hoursSince(facts.created_at, deps.now()),
      });
    },
  );
  if (source === "qotd")' '        source,
        hours_since_signup: hoursSince(facts.created_at, deps.now()),
        question_id: "SATM1Q90001",
      });
    },
  );
  if (source === "qotd")' || { bad "M3 STALE"; exit 1; }
run "M3 forbidden property refused" "F3: the properties are exactly the listed ones" "$PG_SUITE"

echo "=== (4) the forbidden property is added AND the registry loosened to let it through ==="
plant "$FUNNEL" '        source,
        hours_since_signup: hoursSince(facts.created_at, deps.now()),
      });
    },
  );
  if (source === "qotd")' '        source,
        hours_since_signup: hoursSince(facts.created_at, deps.now()),
        question_id: "SATM1Q90001",
      });
    },
  );
  if (source === "qotd")' || { bad "M4 STALE"; exit 1; }
plant "$REGISTRY" '            "const": "first_answer"
          },' '            "const": "first_answer"
          },
          "question_id": {
            "type": "string"
          },' || { bad "M4 STALE (registry)"; exit 1; }
run "M4 exact property keys" "F3: the properties are exactly the listed ones" "$PG_SUITE"

# --- Same distinct id as user_signed_up ------------------------------------------------------
echo "=== (5) the raw profile id is sent as the distinct id ==="
plant "$EMIT" '      distinctId: analyticsUserId,' '      distinctId: profileId,' || { bad "M5 STALE"; exit 1; }
run "M5 distinct id is the salted id" "F4: the distinct id is user_signed_up's" "$PG_SUITE"

# --- Fire-and-forget; a failure never blocks or throws ---------------------------------------
echo "=== (6) a failed send keeps its claim (the event is lost for good) ==="
plant "$FUNNEL" '    await deps.release(profileId, milestone);' '    void 0;' || { bad "M6 STALE"; exit 1; }
run "M6 release on failure" "F5: a failed send never throws" "$PG_SUITE"

echo "=== (7) a claim failure throws into the caller ==="
plant "$FUNNEL" '    return "failed";
  }
  if (!claimed)' '    throw error;
  }
  if (!claimed)' || { bad "M7 STALE"; exit 1; }
run "M7 never throws" "F5: a failed send never throws" "$PG_SUITE"

echo "=== (8) the work is not handed to waitUntil ==="
plant "$FUNNEL" '  waitUntil(settled);' '  void settled;' || { bad "M8 STALE"; exit 1; }
run "M8 waitUntil" "F5b: the fire-and-forget entry points" "$PG_SUITE"

# --- Under-13s and unknown age: emitEvent's rule, matched -----------------------------------
echo "=== (9) emitEvent's under-13 / age-unknown exclusion is dropped ==="
plant "$EMIT" '  if (profile.isUnder13 !== false) {' '  if (false) {' || { bad "M9 STALE"; exit 1; }
run "M9 under-13 excluded" "F6: under-13 and age-unknown are never sent" "$PG_SUITE"

echo "=== (10) an excluded account's claim is released (re-tried on every answer) ==="
plant "$FUNNEL" 'const KEEP_CLAIM_ON = new Set(["excluded_under_13_or_age_unknown"]);' \
  'const KEEP_CLAIM_ON = new Set<string>([]);' || { bad "M10 STALE"; exit 1; }
run "M10 exclusion keeps the claim" "F6: under-13 and age-unknown are never sent" "$PG_SUITE"

echo "=== (11) analytics switched off still claims ==="
plant "$FUNNEL" '  if (analyticsConfigProblems(deps.emit.env).length > 0) return "skipped";' '' || { bad "M11 STALE"; exit 1; }
run "M11 analytics off claims nothing" "F7: analytics switched off claims nothing" "$PG_SUITE"

# --- Event moments and properties ------------------------------------------------------------
echo "=== (12) onboarding_completed is sent at once, before the SAT date and score are saved ==="
plant "$FUNNEL" '  await deps.sleep(ONBOARDING_EVENT_DELAY_MS);' '' || { bad "M12 STALE"; exit 1; }
run "M12 onboarding delay" "F8: onboarding_completed waits ~10s" "$PG_SUITE"

echo "=== (13) a QOTD answer counts as the first practice ==="
plant "$FUNNEL" '  if (source === "qotd") return { firstAnswer, firstPractice: null };' '' || { bad "M13 STALE"; exit 1; }
run "M13 QOTD is not practice" "F9: QOTD counts for first_answer only" "$PG_SUITE"

echo "=== (13b) a QOTD answer is reported as a practice answer ==="
plant "$FUNNEL" '  if (mode === "qotd") return "qotd";' '' || { bad "M13b STALE"; exit 1; }
run "M13b QOTD source" "F9: QOTD counts for first_answer only" "$PG_SUITE"

echo "=== (14) any discount counts as the founding code ==="
plant "$FUNNEL" '  if (discounts.data.some((d) => d.source.coupon.percent_off === 100))' \
  '  if (discounts.data.some((d) => d.source.coupon.percent_off !== null))' || { bad "M14 STALE"; exit 1; }
run "M14 alpha is 100% off only" "F10: upgraded via" "$PG_SUITE"

# --- Storage: grants and backfill -------------------------------------------------------------
echo "=== (15) service_role loses INSERT on the milestones table ==="
plant "$MIG" 'GRANT SELECT, INSERT, DELETE ON TABLE public.analytics_funnel_milestones TO service_role;' \
  'GRANT SELECT, DELETE ON TABLE public.analytics_funnel_milestones TO service_role;' || { bad "M15 STALE"; exit 1; }
run "M15 service_role can claim" "F11: grants" "$PG_SUITE"

echo "=== (16) service_role loses EXECUTE on the claim ==="
need_last analytics_funnel_claim M16 "$MIG"
plant "$MIG" 'GRANT EXECUTE ON FUNCTION public.analytics_funnel_claim(uuid, text)   TO service_role;' '' || { bad "M16 STALE"; exit 1; }
run "M16 service_role can execute" "F11: grants" "$PG_SUITE"

echo "=== (17) the backfill counts a QOTD answer as practice ==="
plant "$MIG" " WHERE i.status = 'answered' AND ps.mode <> 'qotd'" " WHERE i.status = 'answered'" || { bad "M17 STALE"; exit 1; }
run "M17 backfill first_practice" "F12: milestones passed before the migration" "$PG_SUITE"

echo "=== (18) the backfill skips premium entitlements ==="
plant "$MIG" " WHERE e.tier = 'premium'" " WHERE false" || { bad "M18 STALE"; exit 1; }
run "M18 backfill upgraded" "F12: milestones passed before the migration" "$PG_SUITE"

# --- Each event at its moment: the route wiring ----------------------------------------------
echo "=== (19) a fresh practice/diagnostic answer no longer reports ==="
plant "$PRACTICE" '  fireAnswerMilestones(userId, session.mode);' '' || { bad "M19 STALE"; exit 1; }
run "M19 practice answer hook" "submits 40 diagnostic answers through the handler" "$DIAG"

echo "=== (20) diagnostic_completed fires on every completion call, not only the completing one ==="
plant "$PRACTICE" '    if (result.data.completed_now) fireDiagnosticCompleted(args.studentId);' \
  '    fireDiagnosticCompleted(args.studentId);' || { bad "M20 STALE"; exit 1; }
run "M20 diagnostic completion once" "two concurrent final answers: one completion" "$DIAG"

echo "=== (21) a replayed QOTD answer reports again ==="
plant "$QOTD" '        if (signals.answeredNow) fireAnswerMilestones(user.id, "qotd");' \
  '        fireAnswerMilestones(user.id, "qotd");' || { bad "M21 STALE"; exit 1; }
run "M21 QOTD hook only on a fresh answer" "A1: a replay returns the original" "$QOTD_PG"

echo "=== (22) onboarding completion no longer reports ==="
plant "$PROFILE" '      fireOnboardingCompleted(userId);' '' || { bad "M22 STALE"; exit 1; }
run "M22 onboarding hook" "O1 + O2: a first completion sends exactly one" "$LIFECYCLE_PG"

echo "=== (23) an accepted plan no longer reports ==="
plant "$PLAN" '  firePlanCreated(context.studentId);' '' || { bad "M23 STALE"; exit 1; }
run "M23 plan hook" "an accepted version fires it once" "$PLAN_TEST"

echo "=== (24) a first activation no longer reports ==="
plant "$WEBHOOK" '  fireUpgraded(studentProfileId, () =>
    readUpgradeVia(subscriptionId, payerProfileId, studentProfileId),
  );
' '' || { bad "M24 STALE"; exit 1; }
run "M24 upgraded hook" "E1 self-paid, not active → active" "$WEBHOOK_TEST"

echo "=== (25) the coupon is not expanded (via can never be alpha) ==="
plant "$WEBHOOK" '      { expand: ["discounts.source.coupon"] },' '      { expand: [] },' || { bad "M25 STALE"; exit 1; }
run "M25 coupon expanded" "E1 self-paid, not active → active" "$WEBHOOK_TEST"

echo
echo "FUNNEL EVENTS MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
