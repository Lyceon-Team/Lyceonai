#!/usr/bin/env node
/**
 * LEGAL REGISTRY BUNDLE GATE
 *
 * @spec [LYCEON consent capture §2; incident 2026-09-16 — /api/profile 500]
 *
 * WHAT WENT WRONG THAT NOTHING CAUGHT. Phase 2 fixed the RENDERER's path to
 * `legal/` — the browser reads `dist/public/legal/`, and a gate proves the build
 * copy is byte-identical. The SERVER then started resolving versions from the
 * same tree at request time, and nobody asked whether the server's runtime could
 * reach it. In the Vercel function it could not: `api/index.ts` imports an
 * esbuild bundle, nothing traces `legal/**`, and `process.cwd()` is `/var/task`.
 * Every consent lookup threw and sign-in went down.
 *
 * The lesson is not "check this path" — it is that EVERY RUNTIME THAT RESOLVES
 * LEGAL METADATA MUST BE SHOWN TO REACH IT, and a gate that only knows about the
 * browser will keep missing the ones that come later.
 *
 * This asserts four things:
 *   A  the generated module is current — regenerating produces no diff
 *   B  every published slug in legal/ appears in it
 *   C  every version and hash matches meta.yml exactly
 *   D  the serverless bundle really carries the data, when one has been built
 *
 * (D) is the one that would have caught the outage. (A) is what stops the module
 * becoming a second editable copy of version and hash data — the fork this whole
 * structure exists to prevent.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEGAL = path.join(ROOT, "legal");
const GENERATED = path.join(ROOT, "server/lib/legal-registry.generated.ts");
const BUNDLE = path.join(ROOT, "dist/vercel-api.cjs");

let failed = 0;
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  failed += 1;
};
const ok = (m) => console.log(`    OK ${m}`);

// ── A. the generated module is current ───────────────────────────────────
console.log("==> A the generated module matches legal/");
if (!fs.existsSync(GENERATED)) {
  fail(`${path.relative(ROOT, GENERATED)} does not exist — run pnpm run generate:legal-registry`);
} else {
  const before = fs.readFileSync(GENERATED, "utf-8");
  execFileSync("node", [path.join(ROOT, "scripts/build/generate-legal-registry.mjs")], {
    cwd: ROOT,
    stdio: "pipe",
  });
  const after = fs.readFileSync(GENERATED, "utf-8");
  if (before !== after) {
    fs.writeFileSync(GENERATED, before);
    fail(
      "the generated registry is STALE. legal/ changed without regenerating.\n" +
        "        Run: pnpm run generate:legal-registry",
    );
  } else {
    ok("regenerating produces no diff");
  }
}

// ── parse the committed module, as data rather than by importing TS ──────
const generatedText = fs.existsSync(GENERATED)
  ? fs.readFileSync(GENERATED, "utf-8")
  : "";
const entries = new Map();
for (const m of generatedText.matchAll(
  /"([a-z0-9-]+)": \{\s*slug: "[^"]+",\s*title: "((?:[^"\\]|\\.)*)",\s*version: "([^"]+)",\s*effectiveDate: "([^"]+)",\s*contentHash: "([^"]+)",/g,
)) {
  entries.set(m[1], {
    title: m[2],
    version: m[3],
    effectiveDate: m[4],
    contentHash: m[5],
  });
}

/** Strict flat YAML, matching the registry and the other gates. */
function parseFlatYaml(text) {
  const out = {};
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

// ── B + C. every published slug, with matching version and hash ──────────
console.log("==> B/C every published slug is present, with meta.yml's own values");
let published = 0;
for (const slug of fs.readdirSync(LEGAL).sort()) {
  const manifestPath = path.join(LEGAL, slug, "manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (manifest.current === null) {
    if (entries.has(slug)) {
      fail(`${slug} is current:null but appears in the generated registry`);
    }
    continue;
  }
  const meta = parseFlatYaml(
    fs.readFileSync(path.join(LEGAL, slug, manifest.current, "meta.yml"), "utf-8"),
  );
  if (meta.published !== "true") continue;
  published += 1;

  const got = entries.get(slug);
  if (!got) {
    fail(`${slug} is published but MISSING from the generated registry`);
    continue;
  }
  if (got.version !== meta.version) {
    fail(`${slug} version: generated ${got.version} vs meta.yml ${meta.version}`);
  }
  if (got.contentHash !== meta.content_hash) {
    fail(`${slug} content_hash disagrees with meta.yml`);
  }
  if (got.effectiveDate !== meta.effective_date) {
    fail(`${slug} effective_date disagrees with meta.yml`);
  }
}
if (published === 0) fail("no published slugs found — the gate would prove nothing");
else if (failed === 0) ok(`${published} published slugs, versions and hashes match`);

// ── D. the serverless bundle carries it ──────────────────────────────────
console.log("==> D the serverless bundle carries the registry");
if (!fs.existsSync(BUNDLE)) {
  console.log(
    "    SKIP no dist/vercel-api.cjs — run `pnpm run build:vercel` for this check",
  );
} else {
  const bundle = fs.readFileSync(BUNDLE, "utf-8");
  let missing = 0;
  for (const [slug, e] of entries) {
    // The hash is the sharpest probe: it appears nowhere else in the bundle and
    // cannot be produced by accident.
    if (!bundle.includes(e.contentHash)) {
      fail(`${slug}'s content hash is NOT in dist/vercel-api.cjs — the function cannot resolve it`);
      missing += 1;
    }
  }
  if (missing === 0) ok(`all ${entries.size} hashes present in the function bundle`);

  // The failure mode that started this: a filesystem read reaching for legal/
  // from inside the bundle. The registry still has one, deliberately, as the
  // dev/test path — but it must be GUARDED, never the only way in.
  if (!bundle.includes("GENERATED_LEGAL_REGISTRY")) {
    fail("the bundle has no GENERATED_LEGAL_REGISTRY — the fallback was tree-shaken away");
  } else {
    ok("the bundled fallback table is reachable");
  }
}

console.log("");
if (failed > 0) {
  console.error(`LEGAL REGISTRY BUNDLE GATE: FAIL (${failed})`);
  process.exit(1);
}
console.log("LEGAL REGISTRY BUNDLE GATE: PASS");
