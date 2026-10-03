/**
 * @spec [Doc-06A §5.3.1 (fields extended per RB-06A-V1-11); docs/plans/seo/seo-marketing-vertical.md
 *   §5 F12, F1, F2, F3; owner rulings 2026-10-03 (registry is canonical, public non-content routes stay
 *   unauth_marketing with prerender/indexable false, lastmod from content dates)]
 * @implemented [2026-10-03]
 *
 * plain English: reads `infra/route-surface-classification.yaml` and derives everything that has to
 * agree with it — which pages are prerendered, what goes in sitemap.xml (with lastmod), which paths
 * vercel.json hands to the SPA shell, and which paths it 301s. One registry, several consumers, so
 * the sitemap, the static output and the edge routing cannot drift apart.
 *
 * trade-offs:
 *  - The YAML is a strict subset (one `key: value` per line, `- ` opens a row) parsed here, because
 *    the repo has no YAML dependency and adding one needs approval. Anything outside the subset
 *    throws, so a malformed registry fails the build rather than parsing to something partial.
 *  - Pure functions only: no fs. Callers (the prerender script, CI checks, tests) read the files.
 *
 * edge cases:
 *  - A duplicate path_pattern is a parse error (two classifications for one route).
 *  - A prerendered static row with no last_modified is a parse error: the sitemap never invents a
 *    date.
 *  - A redirect row must not be prerendered or indexable.
 */
import { z } from "zod";

const SURFACE_CLASSES = [
  "unauth_marketing",
  "authenticated_student",
  "authenticated_guardian",
  "authenticated_admin",
  "internal",
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const routeRegistryRowSchema = z
  .object({
    path_pattern: z
      .string()
      .regex(
        /^\/[A-Za-z0-9\-/:]*$/,
        "path_pattern must be an App.tsx route path",
      ),
    surface_class: z.enum(SURFACE_CLASSES),
    clarity_allowed: bool,
    masking_required: bool,
    owning_doc: z.string().min(1),
    last_classified_at: isoDate,
    is_internal_api: bool,
    requires_cloudflare_access: bool,
    requires_hmac: bool,
    prerender: bool,
    indexable: bool,
    last_modified: isoDate.optional(),
    content_source: z.enum(["blog", "legal"]).optional(),
    redirect_to: z
      .string()
      .regex(/^\/[A-Za-z0-9\-/]*$/)
      .optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    const fail = (message: string): void => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.path_pattern}: ${message}`,
      });
    };
    if (
      row.surface_class !== "unauth_marketing" &&
      (row.prerender || row.indexable)
    ) {
      fail("only unauth_marketing routes may be prerendered or indexed");
    }
    if (row.surface_class.startsWith("authenticated_") && row.clarity_allowed) {
      fail(
        "clarity_allowed on an authenticated route needs the Doc 06A §10 compliance gate",
      );
    }
    if (row.clarity_allowed && !row.masking_required) {
      fail(
        "clarity_allowed: true requires masking_required: true (Doc 06A §5.3.1)",
      );
    }
    if (row.indexable && !row.prerender)
      fail("an indexable route must be prerendered");
    const parameterised = row.path_pattern.includes(":");
    if (row.prerender && parameterised && !row.content_source) {
      fail("a prerendered parameterised route needs a content_source");
    }
    if (row.content_source && !parameterised)
      fail("content_source is only for parameterised routes");
    if (row.prerender && !parameterised && !row.last_modified) {
      fail(
        "a prerendered static route needs last_modified (the sitemap never invents a date)",
      );
    }
    if (row.redirect_to && (row.prerender || row.indexable || parameterised)) {
      fail(
        "a redirect row is a static path that is neither prerendered nor indexed",
      );
    }
  });

export type RouteRegistryRow = z.infer<typeof routeRegistryRowSchema>;

/** Strict-subset YAML → rows. Throws with the line number on anything it does not recognise. */
export function parseRouteRegistry(text: string): RouteRegistryRow[] {
  const rawRows: Record<string, string>[] = [];
  let sawRoutesKey = false;
  text.split("\n").forEach((line, index) => {
    const where = `infra/route-surface-classification.yaml:${index + 1}`;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    if (line === "routes:") {
      if (sawRoutesKey) throw new Error(`${where}: duplicate \`routes:\``);
      sawRoutesKey = true;
      return;
    }
    if (!sawRoutesKey)
      throw new Error(`${where}: expected \`routes:\` before any row`);
    const opener = /^ {2}- ([a-z_]+): (\S.*)$/.exec(line);
    const field = /^ {4}([a-z_]+): (\S.*)$/.exec(line);
    const match = opener ?? field;
    if (!match)
      throw new Error(
        `${where}: not a \`key: value\` line of the registry subset`,
      );
    const key = match[1] ?? "";
    const value = (match[2] ?? "").trim();
    if (opener) {
      rawRows.push({});
    }
    const row = rawRows[rawRows.length - 1];
    if (!row) throw new Error(`${where}: a field before the first \`- \` row`);
    if (Object.prototype.hasOwnProperty.call(row, key))
      throw new Error(`${where}: duplicate key ${key}`);
    row[key] = value;
  });
  if (!sawRoutesKey)
    throw new Error(
      "infra/route-surface-classification.yaml: no `routes:` key",
    );

  const rows = rawRows.map((raw) => {
    const parsed = routeRegistryRowSchema.safeParse(raw);
    if (!parsed.success) {
      const label = raw.path_pattern ?? "(row without path_pattern)";
      throw new Error(
        `route registry row ${label} is invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    return parsed.data;
  });

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.path_pattern))
      throw new Error(
        `route registry: duplicate path_pattern ${row.path_pattern}`,
      );
    seen.add(row.path_pattern);
  }
  return rows;
}

/**
 * `/tests/:sessionId` → `^/tests/[^/]+/?$` — the vercel.json `src` for a route pattern.
 * A trailing slash is accepted, as wouter matches both.
 */
export function routePatternToVercelSource(pattern: string): string {
  if (pattern === "/") return "^/$";
  const body = pattern
    .split("/")
    .map((segment) =>
      segment.startsWith(":")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return `^${body}/?$`;
}

/** Content the parameterised prerendered rows expand over. Dates are YYYY-MM-DD. */
export type PrerenderContent = {
  blog: readonly { slug: string; date: string }[];
  legal: readonly { slug: string; effectiveDate: string }[];
};

export type PrerenderPage = {
  /** URL path, e.g. `/blog/is-digital-sat-harder`. */
  path: string;
  /** The registry row it came from. */
  pattern: string;
  indexable: boolean;
  /** YYYY-MM-DD. */
  lastmod: string;
};

function maxDate(dates: readonly string[]): string | undefined {
  const sorted = [...dates].sort();
  return sorted[sorted.length - 1];
}

/**
 * Every page to prerender, with its sitemap lastmod. A hub (`/blog`, `/legal`) takes the latest of
 * its own last_modified and its children's dates, since a new child changes the hub's list.
 */
export function expandPrerenderPages(
  rows: readonly RouteRegistryRow[],
  content: PrerenderContent,
): PrerenderPage[] {
  const pages: PrerenderPage[] = [];
  const childDates: Record<"blog" | "legal", string[]> = {
    blog: content.blog.map((post) => post.date),
    legal: content.legal.map((doc) => doc.effectiveDate),
  };
  for (const row of rows) {
    if (!row.prerender) continue;
    if (row.content_source === "blog") {
      for (const post of content.blog) {
        pages.push({
          path: `/blog/${post.slug}`,
          pattern: row.path_pattern,
          indexable: row.indexable,
          lastmod: post.date,
        });
      }
      continue;
    }
    if (row.content_source === "legal") {
      for (const doc of content.legal) {
        pages.push({
          path: `/legal/${doc.slug}`,
          pattern: row.path_pattern,
          indexable: row.indexable,
          lastmod: doc.effectiveDate,
        });
      }
      continue;
    }
    const own = row.last_modified;
    if (!own)
      throw new Error(`${row.path_pattern}: prerendered without last_modified`);
    const hubChildren =
      row.path_pattern === "/blog"
        ? childDates.blog
        : row.path_pattern === "/legal"
          ? childDates.legal
          : [];
    pages.push({
      path: row.path_pattern,
      pattern: row.path_pattern,
      indexable: row.indexable,
      lastmod: maxDate([own, ...hubChildren]) ?? own,
    });
  }
  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.path))
      throw new Error(`prerender: ${page.path} is produced twice`);
    seen.add(page.path);
  }
  return pages;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** sitemap.xml for the indexable pages, in registry order. `baseUrl` has no trailing slash. */
export function buildSitemapXml(
  pages: readonly PrerenderPage[],
  baseUrl: string,
): string {
  const urls = pages
    .filter((page) => page.indexable)
    .map((page) => {
      const loc = page.path === "/" ? `${baseUrl}/` : `${baseUrl}${page.path}`;
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${page.lastmod}</lastmod>\n  </url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** The vercel.json `src` patterns the SPA shell must answer: every route that is not prerendered or redirected. */
export function spaShellSources(rows: readonly RouteRegistryRow[]): string[] {
  return rows
    .filter((row) => !row.prerender && !row.redirect_to)
    .map((row) => routePatternToVercelSource(row.path_pattern));
}

/** The permanent redirects vercel.json must serve. */
export function edgeRedirects(
  rows: readonly RouteRegistryRow[],
): { source: string; location: string }[] {
  return rows.flatMap((row) =>
    row.redirect_to
      ? [
          {
            source: routePatternToVercelSource(row.path_pattern),
            location: row.redirect_to,
          },
        ]
      : [],
  );
}

/** A vercel.json legacy route, as far as the generator needs to know one. */
export type VercelRoute = {
  src?: string;
  dest?: string;
  status?: number;
  check?: boolean;
  continue?: boolean;
  handle?: string;
  headers?: Record<string, string>;
};

/**
 * Routes the generator does not own and re-emits UNCHANGED, in their existing order, ahead of
 * everything it derives: the page security-headers route(s) (`continue: true` with headers — F-59,
 * owned by the security workstream) and the serverless-function routes (`dest: /api/index`).
 */
export function preservedVercelRoutes(
  existing: readonly VercelRoute[],
): VercelRoute[] {
  return existing.filter(
    (route) =>
      (route.continue === true && route.headers !== undefined) ||
      route.dest === "/api/index",
  );
}

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F2; owner instruction 2026-10-03 (security-headers
 *   route emitted unchanged as the first route)] | @implemented [2026-10-03]
 *
 * plain English: the whole `routes` array of vercel.json. In order:
 *   1. the preserved routes — security headers first, then the function routes — byte-for-byte;
 *   2. 301s for the registry's redirect rows;
 *   3. `filesystem` (prerendered pages, assets, legal files);
 *   4. `/` → the prerendered homepage;
 *   5. the SPA shell for every route that is not prerendered (BEFORE the directory-index rewrite:
 *      Vercel carries a missed `check: true` rewrite forward, so a later SPA row would never match
 *      — the preview proved it on /dashboard);
 *   6. the directory-index rewrite, applied only when the file exists;
 *   7. 404.html for everything else.
 * Throws if the preserved set has no security-headers route or it is not first, so the generator
 * can never silently drop or reorder it.
 */
export function buildVercelRoutes(
  rows: readonly RouteRegistryRow[],
  existing: readonly VercelRoute[],
): VercelRoute[] {
  const preserved = preservedVercelRoutes(existing);
  const first = preserved[0];
  if (!first || first.continue !== true || first.headers === undefined) {
    throw new Error(
      "vercel.json: the security-headers route (continue: true) must exist and be the first route",
    );
  }
  return [
    ...preserved,
    ...edgeRedirects(rows).map((r) => ({
      src: r.source,
      status: 301,
      headers: { Location: r.location },
    })),
    { handle: "filesystem" },
    { src: "^/$", dest: "/index.html" },
    ...spaShellSources(rows).map((src) => ({ src, dest: "/app.html" })),
    { src: "^/(.+?)/?$", dest: "/$1/index.html", check: true },
    { src: "^/.*$", status: 404, dest: "/404.html" },
  ];
}
