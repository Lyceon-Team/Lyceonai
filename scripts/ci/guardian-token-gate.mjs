#!/usr/bin/env node
/**
 * Guardian token gate — no hex colour literals and no sub-16px text utilities in guardian files.
 *
 * @spec [Guardian_Closure_Plan G4-07 named proof: "a CI grep gate: zero hex colour literals in
 *       guardian files"; owner ruling R12 (no computed font below 16px; the brand tokens —
 *       `tokens.css` and the `brand-*` classes — not literals)] | @implemented [2026-09-30]
 *
 * plain English: every guardian file is scanned for
 *   (1) a hex colour literal (`#0F2E48`, `#fff` …) — colour comes from the token set; and
 *   (2) a Tailwind text-size utility under 16px (`text-xs`, `text-sm`, `text-[13px]` …) —
 *       the static half of R12. The computed half, which also covers the SHARED components a
 *       guardian page renders, is `tests/e2e/guardian-surfaces.spec.ts`.
 * It also checks that `guardian-type-floor.generated.css` is what the calendar stylesheet
 * currently produces (`scripts/gen-guardian-type-floor.mjs --check`).
 *
 * WHICH FILES. Everything under `client/src/features/guardian/` and
 * `client/src/components/guardian/`, and any client file whose name starts with "guardian"
 * (so a new guardian page is covered without editing this list). Tests are excluded: they
 * render nothing a guardian sees.
 *
 * EXCLUDED, BY NAME AND REASON — and the exclusion is checked, not trusted:
 *   - LEGACY: the retired single-page guardian dashboard and the three components only it
 *     renders. They are unrouted since G4-01 and await deletion (owner decision pending on
 *     the 2026-09-03 no-student template preview they carry). The gate FAILS if any
 *     non-legacy, non-test file imports one, so "unrouted" stays true while they are exempt.
 *   - STUDENT: `guardian-required.tsx` is the page an under-13 STUDENT sees; it is not a
 *     guardian surface despite its name.
 *
 * usage: node scripts/ci/guardian-token-gate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();

const LEGACY = [
  "client/src/pages/guardian-dashboard.tsx",
  "client/src/components/guardian/GuardianTemplatePreview.tsx",
  "client/src/components/guardian/GuardianMetricTile.tsx",
  "client/src/components/guardian/ManageSubscriptionButton.tsx",
];
const STUDENT_FACING = ["client/src/pages/guardian-required.tsx"];
const EXCLUDED = new Set([...LEGACY, ...STUDENT_FACING]);

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1,5})?\b/g;
const SMALL_TEXT =
  /\btext-(?:xs|sm|\[(?:[0-9]|1[0-5])(?:\.\d+)?px\])(?![\w-])/g;

function walk(dir, out) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const all = walk("client/src", []).filter((f) => /\.(tsx?|css)$/.test(f));
const isTest = (f) => /\.test\.tsx?$/.test(f) || f.includes("/__tests__/");
const isGuardianFile = (f) =>
  f.startsWith("client/src/features/guardian/") ||
  f.startsWith("client/src/components/guardian/") ||
  /^guardian/i.test(path.posix.basename(f));

const failures = [];

for (const f of [...EXCLUDED]) {
  if (!fs.existsSync(path.join(ROOT, f))) {
    failures.push(
      `${f}: listed as excluded but does not exist — remove it from the list`,
    );
  }
}

const scanned = all.filter(
  (f) => isGuardianFile(f) && !isTest(f) && !EXCLUDED.has(f),
);

for (const f of scanned) {
  const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(HEX)) {
      failures.push(`${f}:${i + 1}: hex colour literal ${m[0]} — use a token`);
    }
    if (!f.endsWith(".css")) {
      for (const m of line.matchAll(SMALL_TEXT)) {
        failures.push(`${f}:${i + 1}: ${m[0]} is under 16px (R12)`);
      }
    }
  });
}

// "Unrouted" must stay true for the legacy exemption to be honest.
const legacyStems = LEGACY.map((f) =>
  path.posix.basename(f).replace(/\.tsx?$/, ""),
);
for (const f of all) {
  if (isTest(f) || EXCLUDED.has(f)) continue;
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const stem of legacyStems) {
    const imported = new RegExp(
      `(?:from\\s+|import\\()\\s*["'][^"']*/${stem}["']`,
    ).test(text);
    if (imported) {
      failures.push(
        `${f}: imports legacy ${stem}, which is exempt only while unrouted`,
      );
    }
  }
}

try {
  execFileSync("node", ["scripts/gen-guardian-type-floor.mjs", "--check"], {
    stdio: "pipe",
  });
} catch (err) {
  failures.push(
    "client/src/features/guardian/guardian-type-floor.generated.css is stale — run node scripts/gen-guardian-type-floor.mjs",
  );
}

if (failures.length > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`GUARDIAN TOKEN GATE: FAIL (${failures.length})`);
  process.exit(1);
}
console.log(
  `GUARDIAN TOKEN GATE: PASS (${scanned.length} guardian files, ${EXCLUDED.size} excluded by name)`,
);
