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

export type ResolvedLegalVersion = {
  slug: string;
  title: string;
  version: string;
  effectiveDate: string;
  contentHash: string;
};

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
export function resolveLegalVersion(slug: string): ResolvedLegalVersion {
  const cached = resolvedCache.get(slug);
  if (cached) return cached;

  const root = legalRoot();
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

  const resolved: ResolvedLegalVersion = {
    slug,
    title: manifest.data.title,
    version: meta.data.version,
    effectiveDate: meta.data.effective_date,
    contentHash: meta.data.content_hash,
  };
  resolvedCache.set(slug, resolved);
  return resolved;
}
