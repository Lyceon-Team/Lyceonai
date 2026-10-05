#!/usr/bin/env bash
# Proves each rule of page-csp-built-hash-gate.mjs turns it red (register §8 F-59).
# Runs after the build: mutates COPIES of dist/public/index.html and vercel.json, never the
# originals, and requires the gate to pass on the originals and fail on every mutation.
set -euo pipefail
cd "$(dirname "$0")/../.."
GATE=scripts/ci/page-csp-built-hash-gate.mjs
BUILT=dist/public/index.html
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

node "$GATE" "$BUILT" vercel.json >/dev/null || { echo "FAIL: gate is red on the real build"; exit 1; }
# Default mode checks every built page (SEO Wave 1A: 22 prerendered pages + 404.html + app.html).
node "$GATE" >/dev/null || { echo "FAIL: gate is red on the real build (all pages)"; exit 1; }

expect_red() {
  local name=$1 html=$2 vj=$3
  if node "$GATE" "$html" "$vj" >/dev/null 2>&1; then
    echo "FAIL: mutation '$name' did not turn the gate red"; exit 1
  fi
  echo "ok: $name turns it red"
}

# 1. The build rewrites the theme script (one byte): its hash leaves the allowed set.
sed 's/"lyceon-theme"/"lyceon-themX"/' "$BUILT" > "$tmp/m1.html"
grep -q lyceon-themX "$tmp/m1.html"
expect_red "theme script changed" "$tmp/m1.html" vercel.json

# 2. A second inline script appears in the built page.
sed 's#</head>#<script>void 0</script></head>#' "$BUILT" > "$tmp/m2.html"
expect_red "extra inline script" "$tmp/m2.html" vercel.json

# 3. vercel.json allows a hash the page does not have (stale).
sed "s#script-src 'self' #script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' #" vercel.json > "$tmp/m3.json"
grep -q AAAAAAAA "$tmp/m3.json"
expect_red "stale hash allowed" "$BUILT" "$tmp/m3.json"

# 4. vercel.json drops the theme hash.
sed "s#'sha256-[A-Za-z0-9+/=]*' ##" vercel.json > "$tmp/m4.json"
expect_red "theme hash removed" "$BUILT" "$tmp/m4.json"

# 5. A JSON-LD data block becomes an executable inline script: it now needs a hash.
grep -q 'type="application/ld+json"' "$BUILT"
sed '0,/<script type="application\/ld+json">/s//<script>/' "$BUILT" > "$tmp/m5.html"
expect_red "data block made executable" "$tmp/m5.html" vercel.json

# 6. A prerendered page (not index.html) ships a changed theme script.
PAGE=dist/public/blog/is-digital-sat-harder/index.html
node "$GATE" "$PAGE" vercel.json >/dev/null || { echo "FAIL: gate is red on $PAGE"; exit 1; }
sed 's/"lyceon-theme"/"lyceon-themX"/' "$PAGE" > "$tmp/m6.html"
grep -q lyceon-themX "$tmp/m6.html"
expect_red "theme script changed on a prerendered page" "$tmp/m6.html" vercel.json

# 7. Control: a data block of another non-JavaScript type stays exempt (the gate is not just
#    counting <script> tags).
sed 's#</head>#<script type="application/json">{"a":1}</script></head>#' "$BUILT" > "$tmp/c7.html"
node "$GATE" "$tmp/c7.html" vercel.json >/dev/null || { echo "FAIL: a non-executable data block turned the gate red"; exit 1; }
echo "ok: a non-executable data block stays green"

echo "page-csp-built-hash-gate selftest: all mutations red"
