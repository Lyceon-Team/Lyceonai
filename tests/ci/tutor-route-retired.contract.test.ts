/**
 * UI-04 — the app's `/tutor` page is retired; `/tutor` redirects to `/chat`.
 *
 * @spec [owner ruling 2026-09-29 (UI-04: retire `/tutor` as planned);
 *        contracts/auth-standard-flow.contract.md AS-5 (allowlisted `next`);
 *        `return-path.ts` ("Every entry is a route in App.tsx")]
 * @implemented [2026-09-29]
 *
 * plain English: `/tutor` used to mount a second, older tutor landing page next
 * to `/chat`, and the server also rendered a public "Tutor Transparency" page at
 * the same URL. Both are gone. The SPA route is now a plain redirect to `/chat`,
 * which is role-gated, so a signed-out visitor lands on `/login?next=%2Fchat`
 * and returns to `/chat` after sign-in. The trust hub does not link to `/tutor`
 * (its `/chat` card was removed under SEO Wave 1B F6, 2026-10-03, and
 * `/trust/evidence` under F14), and `/tutor` is no longer advertised as a public
 * page (SSR list, meta, sitemap).
 *
 * WHY SOURCE TEXT. `App.tsx`'s `Router` is not exported and mounts every page
 * lazily inside one `<Switch>`; the route registration is a fact about the
 * file. Same approach as `client/src/review-entry-points.test.ts` and
 * `analytics-student-surface.contract.test.ts`. Comments are stripped first so
 * prose about `/tutor` cannot satisfy or trip an assertion.
 *
 * edge cases: the redirect must NOT be wrapped in RequireRole itself — the
 * guard belongs to `/chat`, where `next` is computed from the location the
 * visitor actually ends up on.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loginPathWithReturn,
  sanitizeReturnPath,
} from "@lyceon/shared/return-path";
import { PUBLIC_META } from "../../shared/seo/public-meta";
import { getPrerenderedSite, loadRouteRegistry } from "../lib/prerendered-site";
import { stripComments } from "./lib/strip-comments";

const REPO = resolve(__dirname, "../..");

function source(relative: string): string {
  return stripComments(readFileSync(resolve(REPO, relative), "utf-8"));
}

/** The `<Route …>` chunk in App.tsx whose path is exactly `path`. */
function routeChunk(app: string, path: string): string {
  // Segment at each `<Route`, as analytics-student-surface does: each chunk
  // runs to the next route, so it holds this route's element only.
  const chunk = app
    .split(/(?=<Route\b)/)
    .find((c) => /^<Route\s+path="([^"]+)"/.exec(c)?.[1] === path);
  if (chunk === undefined) {
    throw new Error(`App.tsx has no <Route path="${path}">`);
  }
  return chunk;
}

describe("UI-04 — /tutor is retired and redirects to /chat", () => {
  const app = source("client/src/App.tsx");

  it("App.tsx mounts /tutor as a redirect to /chat, with no page and no guard of its own", () => {
    const tutor = routeChunk(app, "/tutor");
    expect(tutor).toMatch(/<Redirect\s+to="\/chat"\s+replace\s*\/>/);
    expect(tutor).not.toMatch(/<RequireRole\b/);
    expect(tutor).not.toMatch(/TutorPage/);
  });

  it("the old tutor page and its lazy import are gone", () => {
    expect(app).not.toMatch(/@\/pages\/tutor["']/);
    expect(app).not.toMatch(/\bTutorPage\b/);
    expect(existsSync(resolve(REPO, "client/src/pages", "tutor.tsx"))).toBe(
      false,
    );
  });

  it("/chat is role-gated, so a signed-out visitor goes to /login?next=/chat and comes back", () => {
    const chat = routeChunk(app, "/chat");
    expect(chat).toMatch(/<RequireRole\s+allow=\{\["student",\s*"admin"\]\}>/);
    expect(chat).toMatch(/<Chat\s*\/>/);
    expect(sanitizeReturnPath("/chat")).toBe("/chat");
    expect(loginPathWithReturn("/chat")).toBe("/login?next=%2Fchat");
  });

  // F6/F14 (2026-10-03): the trust hub's "Tutor Transparency" card (which linked to /chat)
  // and the /trust/evidence page are removed, so the trust hub is the only trust page left and
  // it no longer links to the tutor at all. What this guarded still holds: no /tutor link.
  it("the trust hub does not link to /tutor", () => {
    const file = "client/src/pages/trust.tsx";
    const page = source(file);
    // Presence first: the page still carries its policy links.
    expect(page, `${file} links to the legal hub`).toMatch(/href="\/legal"/);
    expect(page, `${file} does not link to /tutor`).not.toMatch(
      /href="\/tutor"/,
    );
    expect(page, `${file} has no developer-path link copy`).not.toContain(
      "Open /tutor",
    );
    expect(
      existsSync(resolve(REPO, "client/src/pages", "trust-evidence.tsx")),
    ).toBe(false);
  });

  it("/tutor is no longer advertised as a public page (registry, meta, sitemap, prerendered trust hub)", async () => {
    // The Express SSR table this used to read is gone (SEO F4, 2026-10-03); the same claims are
    // now made against the registry and the real prerendered output.
    const site = await getPrerenderedSite();
    const tutorRow = loadRouteRegistry().find((r) => r.path_pattern === "/tutor");
    const trustPage = site.pages.find((p) => p.path === "/trust");

    // Presence first: the lists are non-trivial, so absence is not vacuous.
    expect(trustPage).toBeDefined();
    expect(Object.keys(PUBLIC_META)).toContain("/trust");
    expect(site.sitemapXml).toContain("<loc>https://lyceon.ai/trust</loc>");
    expect(tutorRow).toBeDefined();

    expect(tutorRow?.prerender).toBe(false);
    expect(tutorRow?.indexable).toBe(false);
    expect(site.pages.map((p) => p.path)).not.toContain("/tutor");
    expect(Object.keys(PUBLIC_META)).not.toContain("/tutor");
    expect(site.sitemapXml).not.toContain("https://lyceon.ai/tutor<");

    expect(trustPage?.html).toContain('href="/legal"');
    expect(trustPage?.html).not.toContain('href="/trust/evidence"');
    expect(trustPage?.html).not.toContain('href="/tutor"');
  });
});
