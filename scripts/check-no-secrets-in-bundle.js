/**
 * HALT-3 guard (AUTH-001 / OAUTH-001): fail the build if any *_SECRET token leaks into built,
 * client-reachable output. Mirrors the postbuild pattern of scripts/check-no-cdn-katex.js.
 *
 * Rationale: the previous apps/api/next.config.js `env` block inlined GOOGLE_CLIENT_SECRET into the
 * client bundle. With native Supabase OAuth the secret lives ONLY in the Supabase dashboard. This
 * guard scans built output for any `*_SECRET` identifier (and the specific GOOGLE_CLIENT_SECRET) and
 * exits non-zero if found, so a regression can never ship a secret to the browser.
 *
 * It scans common build roots plus any Next.js build output if present.
 */
import fs from "fs";
import path from "path";

const ROOTS = [
  "dist",
  "dist/public",
  "client/dist",
  "public",
  // Next.js build output (this repo's app is Vite+Express, but guard the Next output too if it exists).
  ".next",
  "apps/api/.next",
];

// Only scan text assets that can end up in a client bundle.
const SCANNED_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".json",
  ".css",
  ".map",
  ".txt",
]);

// Match an assignment / reference to any *_SECRET environment-style token, e.g.
// GOOGLE_CLIENT_SECRET, STRIPE_SECRET_KEY-style names that end in _SECRET, etc.
const SECRET_TOKEN = /\b[A-Z0-9]+(?:_[A-Z0-9]+)*_SECRET\b/;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

let found = false;

for (const root of ROOTS) {
  const files = walk(root);
  for (const file of files) {
    if (!SCANNED_EXTENSIONS.has(path.extname(file))) continue;
    const content = fs.readFileSync(file, "utf8");
    const match = SECRET_TOKEN.exec(content);
    if (match) {
      console.error(
        `FOUND *_SECRET TOKEN (${match[0]}) IN BUILT OUTPUT: ${file}`,
      );
      found = true;
    }
  }
}

if (found) {
  console.error("FOUND SECRET TOKEN IN CLIENT-REACHABLE BUILD OUTPUT - FAIL");
  process.exit(1);
}

console.log("✓ No *_SECRET tokens found in built output.");
