/**
 * @spec [Doc-06A §5.3.1; docs/plans/seo/seo-marketing-vertical.md §5 F12, F2, F3; owner rulings 2026-10-03]
 * @implemented [2026-10-03]
 *
 * plain English: everything derived from infra/route-surface-classification.yaml must agree with
 * it — vercel.json's 301s and SPA-shell routes, the generated sitemap (both directions, with
 * content-dated lastmod), and robots.txt — and the registry parser rejects what the build must
 * not accept. The F2 cases (unknown path and unknown blog slug → 404, legal pages and their assets
 * still served) are checked against a model of Vercel's route evaluation over the real build
 * output; the deployed preview is the real proof (PR evidence).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PrerenderedSite } from "../client/src/prerender/entry-server";
import { BLOG_POSTS } from "../shared/content/blog";
import {
  edgeRedirects,
  parseRouteRegistry,
  routePatternToVercelSource,
  spaShellSources,
} from "../shared/seo/route-registry";
import { BASE_URL } from "../shared/seo/structured-data";
import {
  REPO_ROOT,
  getPrerenderedSite,
  loadRouteRegistry,
} from "./lib/prerendered-site";

type VercelRoute = {
  src?: string;
  dest?: string;
  status?: number;
  check?: boolean;
  handle?: string;
  headers?: Record<string, string>;
};

const vercel = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "vercel.json"), "utf8"),
) as { routes: VercelRoute[] };
const registry = loadRouteRegistry();

let site: PrerenderedSite;
beforeAll(async () => {
  site = await getPrerenderedSite();
}, 60_000);

const VALID_ROW = [
  "  - path_pattern: /x",
  "    surface_class: unauth_marketing",
  "    clarity_allowed: false",
  "    masking_required: false",
  "    owning_doc: Doc-10",
  "    last_classified_at: 2026-10-03",
  "    is_internal_api: false",
  "    requires_cloudflare_access: false",
  "    requires_hmac: false",
  "    prerender: true",
  "    indexable: true",
  "    last_modified: 2026-10-03",
];

describe("registry parser", () => {
  it("parses the real registry: one row per route, every Doc 06A field present", () => {
    expect(registry.length).toBeGreaterThan(40);
    expect(new Set(registry.map((r) => r.path_pattern)).size).toBe(
      registry.length,
    );
    expect(
      registry.filter(
        (r) => r.surface_class === "unauth_marketing" && r.prerender,
      ).length,
    ).toBeGreaterThan(5);
    for (const row of registry) {
      expect(row.clarity_allowed, row.path_pattern).toBe(false);
      expect(row.is_internal_api, row.path_pattern).toBe(false);
    }
  });

  it("accepts a valid row", () => {
    expect(
      parseRouteRegistry(["routes:", ...VALID_ROW].join("\n")),
    ).toHaveLength(1);
  });

  it.each([
    ["an unknown key", [...VALID_ROW, "    colour: blue"]],
    [
      "a prerendered static page with no last_modified",
      VALID_ROW.filter((l) => !l.includes("last_modified")),
    ],
    [
      "an authenticated route that is indexable",
      VALID_ROW.map((l) =>
        l.replace("unauth_marketing", "authenticated_student"),
      ),
    ],
    ["a line outside the subset", [...VALID_ROW, "      nested: true"]],
    ["a duplicate key", [...VALID_ROW, "    prerender: true"]],
    ["a duplicate route", [...VALID_ROW, ...VALID_ROW]],
    [
      "a non-boolean flag",
      VALID_ROW.map((l) => l.replace("indexable: true", "indexable: yes")),
    ],
  ])("rejects %s", (_label, rows) => {
    expect(() => parseRouteRegistry(["routes:", ...rows].join("\n"))).toThrow();
  });

  it("turns a route pattern into the vercel source that matches it", () => {
    expect(routePatternToVercelSource("/")).toBe("^/$");
    expect(routePatternToVercelSource("/tests/:sessionId/report")).toBe(
      "^/tests/[^/]+/report/?$",
    );
    const re = new RegExp(routePatternToVercelSource("/guardian/:studentId"));
    expect(re.test("/guardian/abc")).toBe(true);
    expect(re.test("/guardian/abc/")).toBe(true);
    expect(re.test("/guardian/abc/exams")).toBe(false);
  });
});

describe("vercel.json is derived from the registry", () => {
  const filesystemAt = vercel.routes.findIndex(
    (r) => r.handle === "filesystem",
  );

  it("serves 301s for exactly the registry's redirect rows, before the filesystem", () => {
    const redirects = vercel.routes
      .slice(0, filesystemAt)
      .filter((r) => r.status === 301)
      .map((r) => ({ source: r.src, location: r.headers?.Location }));
    expect(redirects.length).toBeGreaterThan(0);
    expect(redirects).toEqual(edgeRedirects(registry));
  });

  it("hands exactly the non-prerendered routes to the SPA shell, in registry order", () => {
    const shell = vercel.routes
      .filter((r) => r.dest === "/app.html")
      .map((r) => r.src);
    expect(shell.length).toBeGreaterThan(30);
    expect(shell).toEqual(spaShellSources(registry));
  });

  it("ends with a 404 for everything else; only `/` itself is served the prerendered homepage", () => {
    const last = vercel.routes[vercel.routes.length - 1];
    expect(last).toEqual({ src: "^/.*$", status: 404, dest: "/404.html" });
    expect(vercel.routes.filter((r) => r.dest === "/index.html")).toEqual([
      { src: "^/$", dest: "/index.html" },
    ]);
  });
});

/**
 * A model of Vercel's legacy `routes` evaluation, enough for these rules: first match wins,
 * `handle: filesystem` serves an existing file, `check: true` applies only when its destination
 * exists. It is checked here against the files the build writes.
 */
function resolveRequest(
  path: string,
  files: Set<string>,
): { status: number; file?: string; location?: string } {
  for (const route of vercel.routes) {
    if (route.handle === "filesystem") {
      const file = path.slice(1);
      if (file !== "" && files.has(file)) return { status: 200, file };
      continue;
    }
    const match = route.src ? new RegExp(route.src).exec(path) : null;
    if (!match) continue;
    if (route.status === 301)
      return { status: 301, location: route.headers?.Location };
    const dest = (route.dest ?? "")
      .replace(/\$(\d)/g, (_m, i: string) => match[Number(i)] ?? "")
      .slice(1);
    if (route.check && !files.has(dest)) continue;
    if (route.dest === "/api/index") return { status: 200, file: "api" };
    return { status: route.status ?? 200, file: dest };
  }
  return { status: 404 };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe("F2 — real 404s, legal handling intact (model of vercel.json over the build output)", () => {
  let files: Set<string>;
  beforeAll(() => {
    files = new Set([
      ...site.pages.map((p) => p.file),
      "404.html",
      "app.html",
      "sitemap.xml",
      "robots.txt",
      // The legal plugin copies legal/ into dist/public/legal verbatim (plus index.json).
      ...listFiles(resolve(REPO_ROOT, "legal")).map((f) =>
        relative(REPO_ROOT, f),
      ),
      "legal/index.json",
    ]);
  });

  it.each([
    ["/does-not-exist", 404, "404.html"],
    ["/blog/not-a-post", 404, "404.html"],
    ["/legal/not-a-document", 404, "404.html"],
    ["/legal/constructor", 404, "404.html"],
    ["/digital-sat/unknown", 404, "404.html"],
    ["/", 200, "index.html"],
    ["/blog", 200, "blog/index.html"],
    ["/blog/", 200, "blog/index.html"],
    [
      "/blog/is-digital-sat-harder",
      200,
      "blog/is-digital-sat-harder/index.html",
    ],
    ["/legal", 200, "legal/index.html"],
    ["/legal/privacy-policy", 200, "legal/privacy-policy/index.html"],
    ["/legal/refund-policy", 200, "legal/refund-policy/index.html"],
    ["/legal/index.json", 200, "legal/index.json"],
    [
      "/legal/privacy-policy/manifest.json",
      200,
      "legal/privacy-policy/manifest.json",
    ],
    ["/legal/privacy-policy/v4/en.md", 200, "legal/privacy-policy/v4/en.md"],
    ["/dashboard", 200, "app.html"],
    ["/login", 200, "app.html"],
    ["/tests/abc/report", 200, "app.html"],
    ["/guardian/abc/exams/def", 200, "app.html"],
    ["/admin/crisis-review/xyz", 200, "app.html"],
  ])("%s → %i %s", (path, status, file) => {
    expect(resolveRequest(path, files)).toEqual({ status, file });
  });

  it.each([
    ["/privacy", "/legal/privacy-policy"],
    ["/terms", "/legal/student-terms"],
  ])("%s → 301 %s", (path, location) => {
    expect(resolveRequest(path, files)).toEqual({ status: 301, location });
  });
});

describe("F3 — sitemap.xml is generated from the registry, both ways", () => {
  function sitemapLocs(): { loc: string; lastmod: string }[] {
    return [
      ...site.sitemapXml.matchAll(
        /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g,
      ),
    ].map((m) => ({
      loc: m[1] ?? "",
      lastmod: m[2] ?? "",
    }));
  }

  it("every indexable prerendered page is in the sitemap, and every sitemap URL is one", () => {
    const locs = sitemapLocs().map((e) => e.loc);
    const expected = site.pages
      .filter((p) => p.indexable)
      .map((p) => (p.path === "/" ? `${BASE_URL}/` : `${BASE_URL}${p.path}`));
    expect(locs.length).toBeGreaterThan(15);
    expect([...locs].sort()).toEqual([...expected].sort());
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("every registry row maps to the sitemap as its flags say: indexable rows present, others absent", () => {
    const locs = new Set(
      sitemapLocs().map((e) => e.loc.replace(BASE_URL, "") || "/"),
    );
    for (const row of registry) {
      const re = new RegExp(routePatternToVercelSource(row.path_pattern));
      const listed = [...locs].some((loc) => re.test(loc));
      expect(listed, row.path_pattern).toBe(row.indexable);
    }
  });

  it("lastmod comes from content: blog post dates and legal effective dates", () => {
    const byLoc = new Map(sitemapLocs().map((e) => [e.loc, e.lastmod]));
    for (const post of BLOG_POSTS)
      expect(byLoc.get(`${BASE_URL}/blog/${post.slug}`)).toBe(post.date);
    const privacyMeta = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, "legal/privacy-policy/manifest.json"),
        "utf8",
      ),
    ) as {
      current: string;
    };
    const effective = /effective_date: (\S+)/.exec(
      readFileSync(
        resolve(
          REPO_ROOT,
          "legal/privacy-policy",
          privacyMeta.current,
          "meta.yml",
        ),
        "utf8",
      ),
    )?.[1];
    expect(byLoc.get(`${BASE_URL}/legal/privacy-policy`)).toBe(effective);
    for (const { lastmod } of sitemapLocs())
      expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("no hand-written sitemap remains to drift from the generated one", () => {
    expect(existsSync(resolve(REPO_ROOT, "client/public/sitemap.xml"))).toBe(
      false,
    );
  });
});

describe("robots.txt", () => {
  const robots = readFileSync(
    resolve(REPO_ROOT, "client/public/robots.txt"),
    "utf8",
  );
  const disallowed = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map(
    (m) => m[1] ?? "",
  );
  const blocks = (path: string): boolean =>
    disallowed.some((prefix) => path.startsWith(prefix));

  it("disallows every signed-in route", () => {
    const authenticated = registry.filter((r) =>
      r.surface_class.startsWith("authenticated_"),
    );
    expect(authenticated.length).toBeGreaterThan(20);
    for (const row of authenticated)
      expect(
        blocks(row.path_pattern.replace(/:[A-Za-z]+/g, "x")),
        row.path_pattern,
      ).toBe(true);
  });

  it("disallows no page in the sitemap, and names no route that does not exist", () => {
    for (const page of site.pages.filter((p) => p.indexable))
      expect(blocks(page.path), page.path).toBe(false);
    expect(robots).not.toContain("/full-test");
    expect(robots).toContain(`Sitemap: ${BASE_URL}/sitemap.xml`);
  });
});
