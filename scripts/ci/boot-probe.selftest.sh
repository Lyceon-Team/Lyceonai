#!/usr/bin/env bash
# =============================================================================
# boot-probe self-test — every failure mode proven by a planted defect
# =============================================================================
# A gate is worth exactly what its red proof is worth. The boot probe exists
# because of a 4.8-day production outage that CI did not see, so "it passes" is
# not evidence of anything. This plants each shape of the outage in turn and
# asserts the probe turns red, then restores and asserts green again.
#
# The four plants are deliberately different SHAPES, not four instances of one:
#
#   A  a required variable is missing            (env drift)
#   B  PUBLIC_SITE_URL is missing                (process.exit(1), NOT a throw —
#                                                 the case a throw-detector is
#                                                 structurally unable to see)
#   C  a module-scope throw is reintroduced      (the literal 2026-08-27 defect)
#   D  the manifest is padded with a variable    (necessity — nobody can quiet
#      the boot does not need                     the gate by editing the list)
#
# Every plant is restored from a byte copy taken at startup, NOT from git.
# The first version used `git checkout -- <file>`, which restores from the
# INDEX — so on a working tree with uncommitted changes it does not undo the
# plant, it discards the developer's work. It deleted the very fix this gate
# was written to protect, and the run after it reported a green probe against
# a bundle still carrying the outage. A proof harness may not assume the tree
# is committed.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROBE="node scripts/ci/boot-probe.mjs"
MANIFEST="scripts/ci/boot-env.manifest.json"
ROUTE="server/routes/internal-memory-routes.ts"
fails=0

BACKUP_DIR="$(mktemp -d)"
cp "$MANIFEST" "$BACKUP_DIR/manifest.json"
cp "$ROUTE"    "$BACKUP_DIR/route.ts"

restore_all() {
  cp "$BACKUP_DIR/manifest.json" "$MANIFEST"
  cp "$BACKUP_DIR/route.ts"      "$ROUTE"
}

cleanup() {
  restore_all
  rm -rf "$BACKUP_DIR"
  return 0
}
trap cleanup EXIT

require_bundle() {
  if [ ! -f dist/vercel-api.cjs ]; then
    echo "  building the production bundle first..."
    pnpm -s run build:vercel >/dev/null 2>&1 || {
      echo "  FAIL: could not build dist/vercel-api.cjs"; exit 1; }
  fi
}

# Run the probe with one variable removed from the manifest, without touching
# the committed file. Prints nothing; returns the probe's exit status.
probe_without() {
  local drop="$1"
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    delete m.required[process.argv[2]];
    fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2));
  ' "$MANIFEST" "$drop"
  $PROBE --sufficiency >/dev/null 2>&1
  local status=$?
  cp "$BACKUP_DIR/manifest.json" "$MANIFEST"
  return $status
}

require_bundle

echo "==> (0) baseline must be green, or nothing below means anything"
if ! $PROBE >/dev/null 2>&1; then
  echo "  FAIL: the probe is not green before planting"
  $PROBE
  exit 1
fi
echo "  ok   baseline green"

echo "==> (A) a required variable is missing from the environment"
if probe_without SUPABASE_SERVICE_ROLE_KEY; then
  echo "  FAIL: probe stayed green without SUPABASE_SERVICE_ROLE_KEY"
  fails=$((fails + 1))
else
  echo "  ok   probe went red"
fi

echo "==> (B) PUBLIC_SITE_URL is missing — process.exit(1), no throw to detect"
if probe_without PUBLIC_SITE_URL; then
  echo "  FAIL: probe stayed green without PUBLIC_SITE_URL"
  echo "        This is the case a module-scope-throw scanner cannot see."
  fails=$((fails + 1))
else
  echo "  ok   probe went red"
fi

echo "==> (C) a module-scope throw is reintroduced into an internal route"
python3 - "$ROUTE" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
anchor = "const readOidcConfig: OidcConfigReader = () => ({"
plant = (
    'if (!process.env.CLOUD_TASKS_OIDC_AUDIENCE) {\n'
    '  throw new Error("planted: CLOUD_TASKS_OIDC_AUDIENCE is not set.");\n'
    '}\n\n'
)
assert anchor in s, "anchor not found; self-test needs updating"
open(p, "w").write(s.replace(anchor, plant + anchor, 1))
PY
pnpm -s run build:vercel >/dev/null 2>&1
if $PROBE --sufficiency >/dev/null 2>&1; then
  echo "  FAIL: probe stayed green with a module-scope throw in $ROUTE"
  fails=$((fails + 1))
else
  echo "  ok   probe went red"
fi
cp "$BACKUP_DIR/route.ts" "$ROUTE"
pnpm -s run build:vercel >/dev/null 2>&1

echo "==> (D) the manifest is padded with a variable the boot does not need"
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  m.required.LYCEON_PLANTED_UNUSED_VAR = "not-load-bearing";
  fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2));
' "$MANIFEST"
if $PROBE --necessity >/dev/null 2>&1; then
  echo "  FAIL: probe stayed green with a non-load-bearing variable in the manifest"
  fails=$((fails + 1))
else
  echo "  ok   probe went red"
fi
cp "$BACKUP_DIR/manifest.json" "$MANIFEST"

echo "==> (Z) restored tree must be green again"
if ! $PROBE >/dev/null 2>&1; then
  echo "  FAIL: probe is red after restore — the self-test left the tree dirty"
  fails=$((fails + 1))
else
  echo "  ok   green again"
fi

echo ""
if [ "$fails" -ne 0 ]; then
  echo "BOOT PROBE SELF-TEST: FAIL ($fails)"
  exit 1
fi
echo "BOOT PROBE SELF-TEST: PASS"
