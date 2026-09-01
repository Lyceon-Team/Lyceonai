#!/usr/bin/env bash
# =============================================================================
# guardian-schema-truth-gate self-test — every rule proven by a planted violation
# =============================================================================
# A gate is worth exactly what its red proof is worth. This plants one violation per rule,
# asserts the gate turns red, removes it, and asserts green again. If the gate ever stops
# discriminating, this fails instead of the gate quietly passing everything.
#
# WHY THE GATE'S OUTPUT IS CAPTURED TO A VARIABLE AND NOT PIPED INTO `grep -q`: `grep -q`
# exits at its first match and closes the pipe, and node then dies on SIGPIPE before it has
# flushed the rest. Every check here reported "did not fire" against a gate that fires
# correctly when run by hand. Two green-looking failures in a proof harness, from the harness.
#
# WHY THE PLANTS ARE `git add -N`'d: the gate enumerates `git ls-files`, so an untracked file
# is invisible to it. That is correct for CI, which runs on a checkout, but it means a plant
# that is only written to disk proves nothing — the first version of this self-test reported
# "RULE A did not fire" for exactly that reason, which is the harness catching itself.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
GATE="node scripts/ci/guardian-schema-truth-gate.mjs"
PLANT="tests/ci/guardian-planted-violation.contract.test.ts"
fails=0

cleanup() { git rm -q --cached "$PLANT" >/dev/null 2>&1 || true; rm -f "$PLANT"; }
trap cleanup EXIT

echo "==> (0) baseline must be green, or nothing below means anything"
if ! $GATE >/dev/null 2>&1; then echo "  FAIL: gate is not green before planting"; exit 1; fi
echo "  ok   baseline green"

echo "==> (A) a guardian test that mocks the supabase query layer with no real pg.Client"
cat > "$PLANT" <<'EOF'
import { vi, it, expect } from "vitest";
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: { from: () => ({ select: () => ({ data: [], error: null }) }) },
}));
it("planted", () => expect(1).toBe(1));
EOF
git add -N "$PLANT" >/dev/null 2>&1
out="$($GATE 2>&1)"
if printf '%s' "$out" | grep -q "RULE A VIOLATION: $PLANT"; then echo "  ok   RULE A -> RED"; else echo "  FAIL: RULE A did not fire"; echo "$out" | sed 's/^/       | /'; fails=1; fi
git rm -q --cached "$PLANT" >/dev/null 2>&1; rm -f "$PLANT"

echo "==> (B) a guardian test carrying a hand-written row fixture"
cat > "$PLANT" <<'EOF'
import { it, expect } from "vitest";
const row = { guardian_profile_id: "g", student_profile_id: "s", status: "active" };
it("planted", () => expect(row.status).toBe("active"));
EOF
git add -N "$PLANT" >/dev/null 2>&1
out="$($GATE 2>&1)"
if printf '%s' "$out" | grep -q "RULE B VIOLATION: $PLANT"; then echo "  ok   RULE B -> RED"; else echo "  FAIL: RULE B did not fire"; echo "$out" | sed 's/^/       | /'; fails=1; fi
git rm -q --cached "$PLANT" >/dev/null 2>&1; rm -f "$PLANT"

echo "==> (C) the SAME fixture in a PG-backed file is allowed — the discriminator, not vi.mock"
cat > "$PLANT" <<'EOF'
import { it, expect } from "vitest";
import { Client } from "pg";
const row = { guardian_profile_id: "g", student_profile_id: "s", status: "active" };
it("planted", () => expect(typeof Client).toBe("function") && expect(row.status).toBe("active"));
EOF
git add -N "$PLANT" >/dev/null 2>&1
if $GATE >/dev/null 2>&1; then echo "  ok   PG-backed file exempt (green)"; else echo "  FAIL: gate flagged a PG-backed file — it would flag the exemplar"; fails=1; fi
git rm -q --cached "$PLANT" >/dev/null 2>&1; rm -f "$PLANT"

echo "==> (D) a stale accept-list entry must fail, not pass"
tmp=$(mktemp); cp scripts/ci/guardian-schema-truth-gate.mjs "$tmp"
python3 - <<'PYEOF'
p="scripts/ci/guardian-schema-truth-gate.mjs"; t=open(p).read()
open(p,"w").write(t.replace('"tests/ci/guardian-reporting.contract.test.ts"','"tests/ci/this-file-does-not-exist.test.ts"',1))
PYEOF
out="$($GATE 2>&1)"
if printf '%s' "$out" | grep -q "STALE ACCEPT-LIST ENTRY"; then echo "  ok   stale entry -> RED"; else echo "  FAIL: stale accept-list entry passed"; echo "$out" | sed 's/^/       | /'; fails=1; fi
cp "$tmp" scripts/ci/guardian-schema-truth-gate.mjs; rm -f "$tmp"

echo "==> (E) green again after every plant is removed"
if $GATE >/dev/null 2>&1; then echo "  ok   green restored"; else echo "  FAIL: not green after cleanup"; fails=1; fi

echo
if [ $fails -eq 0 ]; then echo "GUARDIAN SCHEMA-TRUTH GATE SELF-TEST: PASS"; else echo "GUARDIAN SCHEMA-TRUTH GATE SELF-TEST: FAIL"; fi
exit $fails
