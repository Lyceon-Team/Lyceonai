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
 * and returns to `/chat` after sign-in. The trust pages link to `/chat`, and
 * `/tutor` is no longer advertised as a public page (SSR list, meta, sitemap).
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
import { PUBLIC_SSR_ROUTES } from "../../server/seo-content";
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

  it("the trust pages link to /chat, not /tutor", () => {
    for (const file of [
      "client/src/pages/trust.tsx",
      "client/src/pages/trust-evidence.tsx",
    ]) {
      const page = source(file);
      expect(page, `${file} links to /chat`).toMatch(/href="\/chat"/);
      expect(page, `${file} does not link to /tutor`).not.toMatch(
        /href="\/tutor"/,
      );
      expect(page, `${file} has no developer-path link copy`).not.toContain(
        "Open /tutor",
      );
    }
  });

  it("/tutor is no longer advertised as a public page (SSR, meta, sitemap, SSR trust hub)", () => {
    // Presence first: the lists are non-trivial, so absence is not vacuous.
    expect(Object.keys(PUBLIC_SSR_ROUTES)).toContain("/trust");
    expect(Object.keys(PUBLIC_META)).toContain("/trust");
    const sitemap = readFileSync(
      resolve(REPO, "client/public/sitemap.xml"),
      "utf-8",
    );
    expect(sitemap).toContain("<loc>https://lyceon.ai/trust</loc>");

    expect(Object.keys(PUBLIC_SSR_ROUTES)).not.toContain("/tutor");
    expect(Object.keys(PUBLIC_META)).not.toContain("/tutor");
    expect(sitemap).not.toContain("https://lyceon.ai/tutor<");

    const ssrTrust = PUBLIC_SSR_ROUTES["/trust"];
    expect(ssrTrust?.bodyHtml).toContain('href="/trust/evidence"');
    expect(ssrTrust?.bodyHtml).not.toContain('href="/tutor"');
  });
});
