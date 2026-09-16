/**
 * @spec [LYCEON legal versioning Phase 2 §3; Coding Standards §7.1, §13]
 * @implemented 2026-09-15
 *
 * plain English: resolves a legal slug to the version and content hash that are
 * currently published, by reading `legal/<slug>/manifest.json` and the
 * `meta.yml` of the version it names. This is what a consent record is stamped
 * with, so "prove what this person agreed to" becomes: read the hash on the
 * row, find the version directory whose meta.yml carries it, hash en.md,
 * compare.
 *
 * expected outcome: one source. The version written into `legal_acceptances`
 * and the text served to the browser come from the same files, so they cannot
 * disagree. Before this, the version lived in `shared/legal-consent.ts` and the
 * text lived in `client/src/lib/legal.ts`, and nothing connected them.
 *
 * trade-offs:
 *  - Read once and cached for the process lifetime. A deploy is the only thing
 *    that changes these files, and a deploy is a new process.
 *  - Reads from disk rather than importing, so no document metadata is inlined
 *    into the bundle. `legal/` is the repo directory in development and
 *    `dist/public/legal/` in a deploy — the same path `server/index.ts` already
 *    reads index.html from.
 *  - FAILS CLOSED and loudly. If a slug cannot be resolved this throws rather
 *    than returning a default: a consent row stamped with a guessed version is
 *    worse than a failed signup, because it is a false record rather than an
 *    absent one. Callers already treat a consent failure as fail-closed.
 *
 * edge cases:
 *  - `current: null` (an unpublished document) throws. Nothing can be consented
 *    to before it is published, so there is no version to record.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const manifestSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  current: z.string().min(1).nullable(),
  locales: z.array(z.string().min(1)).min(1),
  aliases: z.array(z.string()),
});

const metaSchema = z.object({
  version: z.string().min(1),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  published: z.enum(["true", "false"]),
  content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

// Re-exported so every existing importer keeps working; the definition moved to
// its own module so the GENERATED table can reference it without a cycle.
export type { ResolvedLegalVersion } from "./legal-registry-types.js";
import type { ResolvedLegalVersion } from "./legal-registry-types.js";
import { GENERATED_LEGAL_REGISTRY } from "./legal-registry.generated.js";

const CANDIDATE_ROOTS = ["legal", path.join("dist", "public", "legal")];

let rootCache: string | null = null;
const resolvedCache = new Map<string, ResolvedLegalVersion>();

/** Test seam: forget the cached root and resolutions. */
export function __resetLegalRegistryForTests(): void {
  rootCache = null;
  resolvedCache.clear();
}

function legalRoot(): string {
  if (rootCache !== null) return rootCache;
  for (const candidate of CANDIDATE_ROOTS) {
    const abs = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(path.join(abs, "privacy-policy", "manifest.json"))) {
      rootCache = abs;
      return abs;
    }
  }
  throw new Error(
    `legal/ not found. Looked in: ${CANDIDATE_ROOTS.join(", ")} relative to ${process.cwd()}`,
  );
}

/** Strict flat YAML, matching scripts/ci/legal-manifest-gate.mjs. */
function parseFlatYaml(text: string, where: string): Record<string, string> {
  const out: Record<string, string> = {};
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "" || line.trimStart().startsWith("#")) return;
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`${where}:${i + 1} is not a flat \`key: value\` line`);
    }
    out[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
  });
  return out;
}

/**
 * The currently published version of a slug.
 * @throws when the slug is unknown, unpublished, or malformed.
 */
/**
 * THE FILESYSTEM IS TRIED FIRST, THE BUNDLED TABLE SECOND, AND THAT ORDER IS
 * DELIBERATE.
 *
 * On a checkout — local dev, CI, the tests that point `process.cwd()` at a
 * fixture tree — `legal/` is the truth, and reading it keeps every existing
 * suite honest about the real corpus. In the Vercel function there is no
 * checkout: `api/index.ts` imports an esbuild bundle, nothing traces
 * `legal/**` as a dependency, and `process.cwd()` is `/var/task`. That threw
 * `legal/ not found` on every call and took `/api/profile`, `/auth/callback`
 * and email signup down together on 2026-09-16.
 *
 * Reversing the order would be worse: the table is a build artifact, and
 * preferring it would let a stale one mask an edit to `legal/` that every gate
 * would still call correct.
 */
export function resolveLegalVersion(slug: string): ResolvedLegalVersion {
  const cached = resolvedCache.get(slug);
  if (cached) return cached;

  const fromDisk = resolveFromDisk(slug);
  if (fromDisk !== null) {
    resolvedCache.set(slug, fromDisk);
    return fromDisk;
  }

  const generated = GENERATED_LEGAL_REGISTRY[slug];
  if (generated !== undefined) {
    resolvedCache.set(slug, generated);
    return generated;
  }

  throw new Error(
    `legal/${slug} could not be resolved: not on disk (cwd ${process.cwd()}) and not in the bundled registry`,
  );
}

/**
 * Resolve from `legal/` on disk, or null when the tree is not reachable at all.
 *
 * NULL MEANS "NO TREE", NEVER "BAD DOCUMENT". A tree that exists but holds a
 * malformed manifest, an unpublished version or a missing meta.yml still
 * THROWS — falling through to the bundled table there would hide a real defect
 * behind a build artifact. Only the absence of the tree itself is recoverable.
 */
function resolveFromDisk(slug: string): ResolvedLegalVersion | null {
  let root: string;
  try {
    root = legalRoot();
  } catch {
    return null;
  }
  const manifestPath = path.join(root, slug, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`legal/${slug}/manifest.json does not exist`);
  }

  const manifest = manifestSchema.safeParse(
    JSON.parse(fs.readFileSync(manifestPath, "utf-8")),
  );
  if (!manifest.success) {
    throw new Error(`legal/${slug}/manifest.json is not a valid manifest`);
  }
  if (manifest.data.current === null) {
    throw new Error(
      `legal/${slug} has no published version (current: null) — nothing can be consented to`,
    );
  }

  const version = manifest.data.current;
  const metaPath = path.join(root, slug, version, "meta.yml");
  if (!fs.existsSync(metaPath)) {
    throw new Error(`legal/${slug}/${version}/meta.yml does not exist`);
  }

  const meta = metaSchema.safeParse(
    parseFlatYaml(
      fs.readFileSync(metaPath, "utf-8"),
      `legal/${slug}/${version}/meta.yml`,
    ),
  );
  if (!meta.success) {
    throw new Error(`legal/${slug}/${version}/meta.yml is incomplete`);
  }
  if (meta.data.published !== "true") {
    throw new Error(`legal/${slug}/${version} is not published`);
  }

  return {
    slug,
    title: manifest.data.title,
    version: meta.data.version,
    effectiveDate: meta.data.effective_date,
    contentHash: meta.data.content_hash,
  };
}
