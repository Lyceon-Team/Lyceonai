/**
 * @spec [LYCEON legal versioning Phase 2 §1, §2, §4; Coding Standards §7.1]
 * @implemented 2026-09-15
 *
 * plain English: loads a legal document from `legal/` at runtime. The manifest
 * names the current version, `meta.yml` carries the version and effective date,
 * and `en.md` is the body. The body contains neither a version nor a date —
 * both are injected here, from meta.yml, which is what makes date drift
 * structurally impossible rather than something a person has to remember.
 *
 * expected outcome: one document, one source. `loadLegalDocument` returns a
 * `published` document with its version, effective date, content hash and
 * parsed sections; an `unpublished` marker for a slug whose manifest says
 * `current: null`; or an `error` the caller renders as an error page.
 *
 * trade-offs:
 *  - There is NO fallback text on any path. A missing or malformed document is
 *    an error state, never stale content: shipping the wrong contract silently
 *    is worse than showing nothing, and `server/index.ts`'s index.html fallback
 *    constant is exactly the shape being avoided here.
 *  - `meta.yml` is read by a strict flat parser rather than a YAML dependency.
 *    The file is deliberately five scalar lines; a line that is not
 *    `key: value` is an error, matching scripts/ci/legal-manifest-gate.mjs so
 *    the gate and the runtime agree on what the format is.
 *  - Sections are split on `##` headings so the page keeps its table of
 *    contents, search and scroll-spy. The split is deterministic and derived
 *    from the one source, so it adds no second copy.
 *
 * edge cases:
 *  - A document with no `##` heading yields a single section holding the whole
 *    body, rather than an empty page.
 *  - Heading text is cleaned for display (bold markers, escaped periods) but
 *    the section's markdown is carried through untouched for rendering.
 */
import { z } from "zod";

const manifestSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  /** One line for the hub. Lives here so it travels with the document. */
  description: z.string().min(1),
  /** Hub display position. Ascending; gaps of 10 leave room to insert. */
  order: z.number().int(),
  current: z.string().min(1).nullable(),
  locales: z.array(z.string().min(1)).min(1),
  aliases: z.array(z.string()),
});

const indexSchema = z.object({ slugs: z.array(z.string().min(1)) });

export type LegalManifest = z.infer<typeof manifestSchema>;

const metaSchema = z.object({
  version: z.string().min(1),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supersedes: z.string().nullable(),
  published: z.enum(["true", "false"]),
  content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

export type LegalSection = {
  id: string;
  title: string;
  markdown: string;
};

export type LegalDocumentContent =
  | {
      state: "published";
      slug: string;
      title: string;
      description: string;
      order: number;
      version: string;
      effectiveDate: string;
      contentHash: string;
      sections: LegalSection[];
    }
  | { state: "unpublished"; slug: string; title: string }
  | { state: "not-found"; slug: string }
  | { state: "error"; slug: string; reason: string };

const BASE = "/legal";

/** Thrown when a legal path 404s, so a routing miss is distinguishable. */
export class LegalNotFoundError extends Error {
  constructor(url: string) {
    super(`${url} responded 404`);
    this.name = "LegalNotFoundError";
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: "*/*" } });
  if (res.status === 404) throw new LegalNotFoundError(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

/**
 * Strict flat YAML: every non-empty, non-comment line must be `key: value`.
 * Values may be quoted; `null` is the bare literal.
 */
function parseFlatYaml(
  text: string,
  where: string,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "" || line.trimStart().startsWith("#")) return;
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`${where}:${i + 1} is not a flat \`key: value\` line`);
    }
    const raw = match[2].trim();
    out[match[1]] =
      raw === "null"
        ? null
        : raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  });
  return out;
}

/** Display form of a markdown heading: drop bold markers and escaped periods. */
function cleanHeading(raw: string): string {
  return raw.replace(/\*\*/g, "").replace(/\\\./g, ".").trim();
}

function toSectionId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : `section-${index + 1}`;
}

/** Split a body on its `##` headings, preserving each section's markdown. */
export function parseSections(markdown: string): LegalSection[] {
  const lines = markdown.split("\n");
  const sections: LegalSection[] = [];
  let current: { title: string; body: string[] } | null = null;
  const preamble: string[] = [];

  for (const line of lines) {
    const heading = /^##\s+(?!#)(.*)$/.exec(line);
    if (heading) {
      if (current) sections.push(finish(current, sections.length));
      current = { title: cleanHeading(heading[1]), body: [] };
      continue;
    }
    if (current) current.body.push(line);
    else preamble.push(line);
  }
  if (current) sections.push(finish(current, sections.length));

  if (sections.length === 0) {
    // No `##` heading at all — one section holding the whole body beats an
    // empty page, and the caller still gets something to render.
    return [{ id: "document", title: "", markdown: markdown.trim() }];
  }

  const lead = preamble.join("\n").trim();
  if (lead.length > 0) {
    sections.unshift({ id: "introduction", title: "", markdown: lead });
  }
  return sections;

  function finish(
    s: { title: string; body: string[] },
    index: number,
  ): LegalSection {
    return {
      id: toSectionId(s.title, index),
      title: s.title,
      markdown: s.body.join("\n").trim(),
    };
  }
}

export async function loadLegalManifest(slug: string): Promise<LegalManifest> {
  const parsed = manifestSchema.safeParse(
    JSON.parse(await fetchText(`${BASE}/${slug}/manifest.json`)),
  );
  if (!parsed.success) {
    throw new Error(`legal/${slug}/manifest.json is not a valid manifest`);
  }
  return parsed.data;
}

export async function loadLegalDocument(
  slug: string,
): Promise<LegalDocumentContent> {
  let manifest: LegalManifest;
  try {
    manifest = await loadLegalManifest(slug);
  } catch (err: unknown) {
    // No manifest at this slug means no such document — a routing miss, which
    // the page renders as 404. A manifest that exists but cannot be read is a
    // different thing entirely and must not be disguised as "no such page".
    if (err instanceof LegalNotFoundError) return { state: "not-found", slug };
    return {
      state: "error",
      slug,
      reason: err instanceof Error ? err.message : "manifest could not be read",
    };
  }

  if (manifest.current === null) {
    return { state: "unpublished", slug, title: manifest.title };
  }

  try {
    const versionBase = `${BASE}/${slug}/${manifest.current}`;
    const [metaText, body] = await Promise.all([
      fetchText(`${versionBase}/meta.yml`),
      fetchText(`${versionBase}/en.md`),
    ]);

    const meta = metaSchema.safeParse(
      parseFlatYaml(metaText, `legal/${slug}/${manifest.current}/meta.yml`),
    );
    if (!meta.success) {
      throw new Error(
        `legal/${slug}/${manifest.current}/meta.yml is incomplete`,
      );
    }

    return {
      state: "published",
      slug,
      title: manifest.title,
      description: manifest.description,
      order: manifest.order,
      version: meta.data.version,
      effectiveDate: meta.data.effective_date,
      contentHash: meta.data.content_hash,
      sections: parseSections(body),
    };
  } catch (err: unknown) {
    return {
      state: "error",
      slug,
      reason: err instanceof Error ? err.message : "document could not be read",
    };
  }
}

/** Summary a hub or index needs: the title and, when published, the version. */
export type LegalIndexEntry =
  | {
      state: "published";
      slug: string;
      title: string;
      description: string;
      order: number;
      version: string;
      effectiveDate: string;
    }
  | { state: "unpublished"; slug: string; title: string }
  | { state: "not-found"; slug: string }
  | { state: "error"; slug: string; reason: string };

/**
 * The slugs that exist, from the generated `legal/index.json`.
 *
 * Static hosting has no directory listing, so this is the one fact a client
 * cannot derive from `legal/` itself. Everything else about a document comes
 * from its own manifest — this answers only "which documents are there", so a
 * tenth document appears on the hub with no code change.
 */
export async function loadLegalSlugs(): Promise<string[]> {
  const parsed = indexSchema.safeParse(
    JSON.parse(await fetchText(`${BASE}/index.json`)),
  );
  if (!parsed.success) {
    throw new Error("legal/index.json is not a valid slug index");
  }
  return parsed.data.slugs;
}

/**
 * Loads the manifest (and meta, when published) for each slug. Used by the
 * legal hub so a document's name and date come from the same place the
 * document page reads them, rather than from a second list.
 */
export async function loadLegalIndex(
  slugs: readonly string[],
): Promise<LegalIndexEntry[]> {
  return Promise.all(
    slugs.map(async (slug): Promise<LegalIndexEntry> => {
      const doc = await loadLegalDocument(slug);
      if (doc.state === "published") {
        return {
          state: "published",
          slug,
          title: doc.title,
          description: doc.description,
          order: doc.order,
          version: doc.version,
          effectiveDate: doc.effectiveDate,
        };
      }
      return doc;
    }),
  );
}
