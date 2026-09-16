#!/usr/bin/env node
/**
 * Generate `server/lib/legal-registry.generated.ts` from `legal/`.
 *
 * @spec [LYCEON consent capture §2; incident 2026-09-16 — /api/profile 500]
 *
 * WHY THIS EXISTS. The server resolves a document's version and content hash at
 * request time by reading `legal/<slug>/manifest.json` and `meta.yml` off disk.
 * That works everywhere a repository checkout exists and nowhere else. The
 * Vercel function is an esbuild bundle (`api/index.ts` imports
 * `dist/vercel-api.cjs`), so nothing in the dependency graph mentions those
 * files, Vercel's file tracing never ships them, and `process.cwd()` is
 * `/var/task`. Every read threw:
 *
 *   Error: legal/ not found. Looked in: legal, dist/public/legal relative to /var/task
 *
 * which took down `/api/profile`, `/auth/callback` and email signup at once.
 *
 * A generated MODULE fixes the class, not the instance. esbuild bundles a
 * static import unconditionally, so the data is in `/var/task` by construction —
 * there is no path to get wrong and no tracing to outsmart. Adding the files to
 * an `includeFiles` list would have fixed this one deployment target while
 * leaving the next one to rediscover it.
 *
 * BODIES ARE NOT INCLUDED. The server needs slug, title, version, effective date
 * and content hash — never the text. The text is served to the browser from
 * `dist/public/legal/`, and keeping it out of here keeps the function small and
 * keeps exactly one copy of every document's words.
 *
 * THE HASH IS COPIED FROM meta.yml, NOT RECOMPUTED. The immutability gate
 * already proves meta.yml's `content_hash` matches its `en.md` byte for byte, so
 * recomputing here would be a second implementation of a rule that is already
 * enforced — and a second implementation is a second thing to drift.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEGAL = path.join(ROOT, "legal");
const OUT = path.join(ROOT, "server/lib/legal-registry.generated.ts");

/** Strict flat YAML, matching server/lib/legal-registry.ts and the gates. */
function parseFlatYaml(text, where) {
  const out = {};
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "" || line.trimStart().startsWith("#")) return;
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`${where}:${i + 1} is not a flat \`key: value\``);
    out[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
  });
  return out;
}

const entries = [];
for (const slug of fs.readdirSync(LEGAL).sort()) {
  const manifestPath = path.join(LEGAL, slug, "manifest.json");
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  // `current: null` is a legitimate state — the slug exists so citations to it
  // resolve, but there is nothing published to consent to. It is skipped rather
  // than emitted, so a lookup falls through to the same "not published" error
  // it would raise from disk.
  if (manifest.current === null) continue;

  const metaPath = path.join(LEGAL, slug, manifest.current, "meta.yml");
  const meta = parseFlatYaml(
    fs.readFileSync(metaPath, "utf-8"),
    `legal/${slug}/${manifest.current}/meta.yml`,
  );
  if (meta.published !== "true") continue;

  entries.push({
    slug,
    title: manifest.title,
    version: meta.version,
    effectiveDate: meta.effective_date,
    contentHash: meta.content_hash,
  });
}

if (entries.length === 0) {
  console.error("FAIL: generated registry would be empty — refusing to write.");
  process.exit(1);
}

const body = entries
  .map(
    (e) =>
      `  ${JSON.stringify(e.slug)}: {\n` +
      `    slug: ${JSON.stringify(e.slug)},\n` +
      `    title: ${JSON.stringify(e.title)},\n` +
      `    version: ${JSON.stringify(e.version)},\n` +
      `    effectiveDate: ${JSON.stringify(e.effectiveDate)},\n` +
      `    contentHash: ${JSON.stringify(e.contentHash)},\n` +
      `  },`,
  )
  .join("\n");

const out = `/**
 * GENERATED FILE — DO NOT EDIT.
 * Written by scripts/build/generate-legal-registry.mjs from legal/.
 * Regenerate with: pnpm run generate:legal-registry
 *
 * The published version of every legal document, inlined so the serverless
 * bundle carries it. See the generator's header for why this is a module rather
 * than a file read.
 */
import type { ResolvedLegalVersion } from "./legal-registry-types.js";

export const GENERATED_LEGAL_REGISTRY: Readonly<
  Record<string, ResolvedLegalVersion>
> = {
${body}
};
`;

fs.writeFileSync(OUT, out);
console.log(
  `LEGAL REGISTRY GENERATED: ${entries.length} published slugs -> ${path.relative(ROOT, OUT)}`,
);
