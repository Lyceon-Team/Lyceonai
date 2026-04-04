import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PUBLIC_SSR_ROUTES } from "../server/seo-content";
import { LEGAL_META } from "../shared/seo/public-meta";

function getSitemapPaths(): string[] {
  const sitemapPath = path.join(process.cwd(), "client", "public", "sitemap.xml");
  const xml = fs.readFileSync(sitemapPath, "utf-8");
  const matches = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g));
  return matches.map((match) => {
    const url = new URL(match[1]);
    return url.pathname;
  });
}

describe("SEO SSR coverage", () => {
  it("covers all sitemap URLs with SSR metadata ownership", () => {
    const sitemapPaths = getSitemapPaths();
    const ssrRoutes = new Set(Object.keys(PUBLIC_SSR_ROUTES));
    const legalRoutes = new Set(Object.keys(LEGAL_META).map((slug) => `/legal/${slug}`));

    const missing = sitemapPaths.filter((pathName) => !ssrRoutes.has(pathName) && !legalRoutes.has(pathName));

    expect(missing, `Missing SSR metadata for: ${missing.join(", ")}`).toEqual([]);
  });
});
