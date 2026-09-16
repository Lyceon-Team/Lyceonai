#!/usr/bin/env bash
# @spec [LYCEON legal versioning Phase 1 §6, §9; Coding Standards §14]
# @implemented 2026-09-15
#
# plain English: proves each of the three legal gates actually turns red for
# the defect it claims to catch, and stays green for the thing that must
# remain allowed. A gate nobody has watched fail is a decoration.
#
# Every case runs in a throwaway git repository built from a copy of legal/
# and the gate scripts, so the real working tree is never touched and case A
# can have a base ref that already carries published versions — which
# origin/stripe does not until this lands.
#
# The case that matters most is B. A published en.md is edited AND its
# content_hash updated in the same commit. A gate that compares the file to
# the hash beside it is green there; ours is red, because it asks git.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
WS="$(mktemp -d)"
trap 'rm -rf "$WS"' EXIT

PASS=0
FAIL=0

setup() {
  rm -rf "$WS"/*
  mkdir -p "$WS/scripts/ci"
  cp "$REPO_ROOT/scripts/ci/legal-immutability-gate.mjs" \
     "$REPO_ROOT/scripts/ci/legal-manifest-gate.mjs" \
     "$REPO_ROOT/scripts/ci/legal-xref-gate.mjs" \
     "$REPO_ROOT/scripts/ci/legal-body-purity-gate.mjs" "$WS/scripts/ci/"
  cp -R "$REPO_ROOT/legal" "$WS/legal"
  (
    cd "$WS"
    git init -q .
    git config user.email selftest@lyceon.invalid
    git config user.name selftest
    git add -A >/dev/null
    git commit -qm "baseline: legal/ as published"
    git branch -f selftest-base
  ) >/dev/null 2>&1
}

# expect <expected-exit: red|green> <gate script> <case label>
expect() {
  local want="$1" gate="$2" label="$3"
  local out rc
  out="$(cd "$WS" && LEGAL_BASE_REF=selftest-base node "scripts/ci/$gate" 2>&1)"
  rc=$?
  if { [ "$want" = red ] && [ "$rc" -ne 0 ]; } || { [ "$want" = green ] && [ "$rc" -eq 0 ]; }; then
    echo "  ok   $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $label — wanted $want, gate exited $rc"
    echo "$out" | sed 's/^/       | /'
    FAIL=$((FAIL + 1))
  fi
}

# The build copy includes a generated index.json; the plugin writes it and the
# gate checks it. Simulate the same artifact here.
write_index() {
  local out="$1"
  python3 - "$WS/legal" "$out" <<'PY2'
import json, os, sys
src, out = sys.argv[1], sys.argv[2]
slugs = sorted(d for d in os.listdir(src)
               if os.path.isdir(os.path.join(src, d))
               and os.path.exists(os.path.join(src, d, "manifest.json")))
open(out, "w").write(json.dumps({"slugs": slugs}, indent=2) + "\n")
PY2
}

rehash() {
  local slug="$1" ver="$2"
  local h
  h="$(sha256sum "$WS/legal/$slug/$ver/en.md" | cut -d' ' -f1)"
  sed -i "s|^content_hash: .*$|content_hash: sha256:$h|" "$WS/legal/$slug/$ver/meta.yml"
}

echo "legal gates self-test — each rule observed turning the gate red"
echo ""

# ── Gate 1: immutability ────────────────────────────────────────────
echo "GATE 1 — immutability (published versions are read-only)"

setup
expect green legal-immutability-gate.mjs "(control) untouched tree stays green"

setup
printf '\nAn edit to a published document.\n' >> "$WS/legal/honor-code/v2/en.md"
expect red legal-immutability-gate.mjs "(A) published en.md edited"

setup
printf '\nAn edit to a published document.\n' >> "$WS/legal/honor-code/v2/en.md"
rehash honor-code v2
expect red legal-immutability-gate.mjs \
  "(B) en.md edited AND content_hash updated together — the co-edit"

setup
rm "$WS/legal/honor-code/v2/en.md"
expect red legal-immutability-gate.mjs "(C) file deleted from a published version"

setup
echo "notes" > "$WS/legal/honor-code/v2/scratch.md"
expect red legal-immutability-gate.mjs "(D) file added to a published version"

setup
cp -R "$WS/legal/honor-code/v2" "$WS/legal/honor-code/v3"
sed -i 's|"current": "v2"|"current": "v3"|' "$WS/legal/honor-code/manifest.json"
expect green legal-immutability-gate.mjs \
  "(E) NEW version directory added — publishing must stay possible"

setup
sed -i 's|^content_hash: sha256:.|content_hash: sha256:0|' "$WS/legal/honor-code/v2/meta.yml"
expect red legal-immutability-gate.mjs "(F) content_hash does not describe its own en.md"

# ── Gate 2: manifest resolution ─────────────────────────────────────
echo ""
echo "GATE 2 — manifest resolution"

setup
expect green legal-manifest-gate.mjs "(control) all nine slugs resolve"

setup
sed -i 's|"current": "v2"|"current": "v7"|' "$WS/legal/honor-code/manifest.json"
expect red legal-manifest-gate.mjs "(G) current points at a version that does not exist"

setup
sed -i '/^effective_date:/d' "$WS/legal/honor-code/v2/meta.yml"
expect red legal-manifest-gate.mjs "(H) meta.yml missing a required field"

setup
sed -i 's|^version: .*$|version 2.0|' "$WS/legal/honor-code/v2/meta.yml"
expect red legal-manifest-gate.mjs "(I) meta.yml line is not \`key: value\`"

setup
expect green legal-manifest-gate.mjs \
  "(J) billing-terms current:null is accepted, not a failure"

setup
# The defect this case exists for: legal/billing-terms/v2 landed with its body
# named `Lyceon billing terms` and no meta.yml. The gate reported only the
# meta.yml, because the locale-body check sat after a `continue`; body purity
# resolves <dir>/en.md and skips silently when absent. Two gates, one blind
# spot. The body check now runs before any early exit, so BOTH are reported.
mv "$WS/legal/honor-code/v2/en.md" "$WS/legal/honor-code/v2/Lyceon honor code"
expect red legal-manifest-gate.mjs \
  "(R) a body under the wrong filename — the defect both gates missed"

setup
mv "$WS/legal/honor-code/v2/en.md" "$WS/legal/honor-code/v2/Lyceon honor code"
rm "$WS/legal/honor-code/v2/meta.yml"
expect red legal-manifest-gate.mjs \
  "(S) missing meta.yml must not hide the missing body behind an early exit"

# ── Gate 3: cross-reference ─────────────────────────────────────────
echo ""
echo "GATE 3 — cross-reference"

setup
expect green legal-xref-gate.mjs "(control) every citation resolves"

setup
printf '\nSee the **LYCEON Data Processing Terms** for details.\n' \
  >> "$WS/legal/honor-code/v2/en.md"
rehash honor-code v2
expect red legal-xref-gate.mjs "(K) a document is cited that has no slug"

setup
rm -rf "$WS/legal/billing-terms"
expect red legal-xref-gate.mjs \
  "(L) billing-terms slug removed — the real defect this gate exists for"

# ── Gate 4: body purity and copy fidelity ───────────────────────────
echo ""
echo "GATE 4 — body purity (no version or date in a body) + copy fidelity"

setup
expect green legal-body-purity-gate.mjs "(control) every body clean, no build output to compare"

setup
printf '\n**Last Updated:** 22 December 2024\n' >> "$WS/legal/honor-code/v2/en.md"
rehash honor-code v2
expect red legal-body-purity-gate.mjs "(M) a body reintroduces a \"Last Updated\" line"

setup
printf '\n**Version 2.0 \xc2\xb7 Effective 11 September 2026**\n' >> "$WS/legal/honor-code/v2/en.md"
rehash honor-code v2
expect red legal-body-purity-gate.mjs "(N) a body reintroduces a version line"

setup
# A body that legitimately cites a date must NOT trip the gate — these are
# contracts and they name statute dates. A gate that flagged those would be
# untrue to the documents and would get worked around.
printf '\nArticle 11a applies from 19 June 2026 and requires a withdrawal function.\n' \
  >> "$WS/legal/honor-code/v2/en.md"
rehash honor-code v2
expect green legal-body-purity-gate.mjs "(O) a date CITED in prose is not a header and stays green"

setup
mkdir -p "$WS/dist/public/legal"
cp -R "$WS/legal/." "$WS/dist/public/legal/"
write_index "$WS/dist/public/legal/index.json"
expect green legal-body-purity-gate.mjs "(P) a faithful build copy passes copy fidelity"

setup
mkdir -p "$WS/dist/public/legal"
cp -R "$WS/legal/." "$WS/dist/public/legal/"
write_index "$WS/dist/public/legal/index.json"
printf '\nEdited only in the deploy copy.\n' >> "$WS/dist/public/legal/honor-code/v2/en.md"
expect red legal-body-purity-gate.mjs "(Q) the deploy copy forks from the source"

setup
# The hub enumerates index.json. Without it the page lists nothing, and no
# document can report its own absence — so the gate has to.
mkdir -p "$WS/dist/public/legal"
cp -R "$WS/legal/." "$WS/dist/public/legal/"
expect red legal-body-purity-gate.mjs "(T) the build output has no index.json"

setup
mkdir -p "$WS/dist/public/legal"
cp -R "$WS/legal/." "$WS/dist/public/legal/"
write_index "$WS/dist/public/legal/index.json"
python3 -c "
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d['slugs']=[s for s in d['slugs'] if s!='refund-policy']
open(p,'w').write(json.dumps(d,indent=2)+chr(10))" "$WS/dist/public/legal/index.json"
expect red legal-body-purity-gate.mjs \
  "(U) a published document dropped from the index — invisible on the hub"

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "LEGAL GATES SELF-TEST: FAIL ($FAIL of $((PASS + FAIL)) cases)"
  exit 1
fi
echo "LEGAL GATES SELF-TEST: PASS ($PASS cases)"
