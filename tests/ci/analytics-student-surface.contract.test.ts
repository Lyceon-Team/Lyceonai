/**
 * E1 — analytics does not follow a student around the product.
 *
 * @spec [Coding Standards §12.2 ("No invasive analytics on student-facing
 *        pages"); Privacy Policy v4 §6.6 and §5.2; Doc-06A §5.3
 *        (`infra/route-surface-classification.yaml`, defaults to deny);
 *        owner ruling 2026-09-22 E1 option 3]
 * @implemented 2026-09-22
 *
 * plain English: `<Analytics />` was mounted at the root of the app, so every
 * page a signed-in student visited — `/chat`, `/practice`, `/full-test`,
 * `/mastery` — reported a page view to a third party. It is now behind one
 * predicate at one call site.
 *
 * The predicate is a hand-written allowlist, and a hand-written list is the
 * thing that rots. So E1.2 does not read it: it parses `App.tsx` for every
 * route wrapped in `RequireRole` and requires the predicate to deny each one.
 * A route that gains a role guard tomorrow and keeps its analytics is a
 * failing test, not a silent regression. E1.1 does the same in the other
 * direction against the canonical public-route list the SSR layer already
 * owns, so the two classifications cannot drift apart.
 *
 * trade-offs:
 *  - Doc 06A §5.3 puts this classification in
 *    `infra/route-surface-classification.yaml`, which does not exist. The
 *    owner ruling leaves that file to the Doc 06A workstream, so the coupling
 *    is asserted here rather than imported from a registry.
 *  - `App.tsx` is parsed with a regex over comment-stripped source. A router
 *    rewrite that stops using `<Route path=... RequireRole>` would make E1.2
 *    collect nothing, so E1.0 asserts the collection is non-empty first.
 *
 * edge cases:
 *  - E1.6 pins the segment-boundary rule: `/blogging-internal` must not
 *    inherit `/blog`'s allowance.
 *  - E1.7 pins that a path-like query value cannot flip the verdict.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isAnalyticsAllowedPath,
  analyticsBeforeSend,
} from "../../client/src/lib/analytics-surface";
import { PUBLIC_SSR_ROUTES } from "../../server/seo-content";
import { stripComments } from "./lib/strip-comments";

const REPO = resolve(__dirname, "../..");
const APP = stripComments(
  readFileSync(resolve(REPO, "client/src/App.tsx"), "utf-8"),
);

/**
 * Every route in App.tsx whose element is wrapped in `RequireRole`. Parsed
 * rather than listed: the point is that the router is the source of truth for
 * which surfaces are behind a role, not a list in this file.
 */
const ROLE_GATED_PATHS: string[] = ((): string[] => {
  // Segment the file at each `<Route`, then ask whether THAT route's own
  // block contains a RequireRole. A single lookahead regex is wrong here: a
  // public route immediately followed by a guarded one matches the next
  // route's guard, which silently classified `/digital-sat/reading-writing`
  // as role-gated on the first run of this test.
  const chunks = APP.split(/(?=<Route\b)/);
  const out: string[] = [];
  for (const chunk of chunks) {
    const path = /^<Route\s+path="([^"]+)"/.exec(chunk)?.[1];
    if (!path) continue;
    if (/<RequireRole\s+allow=/.test(chunk)) out.push(path);
  }
  return out;
})();

describe("E1 — Vercel Analytics is off on every role-gated surface", () => {
  it("E1.0 — collected role-gated routes from App.tsx (guards a vacuous pass)", () => {
    // If the router is rewritten and this collects nothing, every assertion
    // below passes over an empty list. This is the tripwire for that.
    expect(ROLE_GATED_PATHS.length).toBeGreaterThanOrEqual(10);
    expect(ROLE_GATED_PATHS).toContain("/chat");
    expect(ROLE_GATED_PATHS).toContain("/practice");
  });

  it("E1.1 — every public route that is not ALSO role-gated is allowed", () => {
    // PUBLIC_SSR_ROUTES is the list the SSR layer already treats as public.
    // Reusing it is what stops two classifications of the same routes.
    //
    // The subtraction is not a fudge: it is the rule. A path in both sets
    // serves two different pages at one URL, and the analytics event cannot
    // tell them apart, so deny wins. E1.11 pins the one path in that state.
    const denied = Object.keys(PUBLIC_SSR_ROUTES)
      .filter((p) => !ROLE_GATED_PATHS.includes(p))
      .filter((p) => !isAnalyticsAllowedPath(p));
    expect(denied).toEqual([]);
  });

  it("E1.11 — /tutor is public AND role-gated, and deny wins", () => {
    // Recorded rather than absorbed. `server/seo-content.ts` renders a public
    // "Tutor Transparency" page there for a logged-out visitor; `App.tsx`
    // wraps the SPA route in RequireRole allow={["student","admin"]}. If that
    // ever stops being true in either direction, this test says so instead of
    // the subtraction in E1.1 quietly covering it.
    expect(Object.keys(PUBLIC_SSR_ROUTES)).toContain("/tutor");
    expect(ROLE_GATED_PATHS).toContain("/tutor");
    expect(isAnalyticsAllowedPath("/tutor")).toBe(false);
  });

  it("E1.2 — every role-gated route is denied", () => {
    const allowed = ROLE_GATED_PATHS.filter((p) =>
      // Path params are substituted with a plausible value: the verdict must
      // not depend on what the id happens to be.
      isAnalyticsAllowedPath(p.replace(/:[A-Za-z]+/g, "abc123")),
    );
    expect(allowed).toEqual([]);
  });

  it("E1.3 — an unknown path is denied (defaults to deny, per Doc 06A §5.3)", () => {
    for (const p of [
      "/something-added-next-week",
      "/practice/session/abc",
      "/admin/crisis-review/42",
      "/account/recover",
      "/update-password",
      "/notifications",
      "/guardian",
      "/upgrade",
    ]) {
      expect(`${p}:${isAnalyticsAllowedPath(p)}`).toBe(`${p}:false`);
    }
  });

  it("E1.4 — the learning surfaces are denied by name", () => {
    // Named explicitly as well as derived, because these are the pages the
    // standard is actually about and a parser change must not lose them.
    for (const p of [
      "/chat",
      "/dashboard",
      "/practice",
      "/practice/topics",
      "/full-test",
      "/mastery",
      "/review-errors",
      "/profile",
    ]) {
      expect(`${p}:${isAnalyticsAllowedPath(p)}`).toBe(`${p}:false`);
    }
  });

  it("E1.5 — content slugs under an allowed prefix are allowed", () => {
    expect(isAnalyticsAllowedPath("/blog/is-digital-sat-harder")).toBe(true);
    expect(isAnalyticsAllowedPath("/legal/privacy-policy")).toBe(true);
    expect(isAnalyticsAllowedPath("/blog/")).toBe(true); // normalises to /blog
  });

  it("E1.6 — a prefix matches at a segment boundary, not as a substring", () => {
    expect(isAnalyticsAllowedPath("/blogging-internal")).toBe(false);
    expect(isAnalyticsAllowedPath("/legalese")).toBe(false);
    expect(isAnalyticsAllowedPath("/trustee/dashboard")).toBe(false);
  });

  it("E1.7 — the verdict comes from the path, not from the query string", () => {
    // `/?next=/chat` is public; `/chat?from=/` is not. A predicate that
    // string-matched the whole URL would get both wrong.
    expect(
      analyticsBeforeSend({ url: "https://lyceon.ai/?next=/chat" }),
    ).not.toBeNull();
    expect(
      analyticsBeforeSend({ url: "https://lyceon.ai/chat?from=/" }),
    ).toBeNull();
    expect(
      analyticsBeforeSend({ url: "https://lyceon.ai/chat#/blog" }),
    ).toBeNull();
  });

  it("E1.8 — an unparseable URL is denied rather than guessed", () => {
    expect(analyticsBeforeSend({ url: "" })).toBeNull();
    expect(analyticsBeforeSend({ url: "::::" })).toBeNull();
  });

  it("E1.9 — the event is passed through unchanged when it is allowed", () => {
    // beforeSend may drop or modify. This one only drops: a returned event
    // that had been rewritten would make the analytics data quietly wrong.
    const event = { url: "https://lyceon.ai/blog/x", type: "pageview" };
    expect(analyticsBeforeSend(event)).toBe(event);
  });

  it("E1.10 — there is exactly one Analytics mount, and it carries the predicate", () => {
    // "One predicate at the single call site" is only true while there is a
    // single call site. A second <Analytics /> anywhere would bypass it.
    const clientSources = [
      "client/src/App.tsx",
      "client/src/main.tsx",
    ] as const;
    let mounts = 0;
    for (const rel of clientSources) {
      const src = stripComments(readFileSync(resolve(REPO, rel), "utf-8"));
      mounts += (src.match(/<Analytics\b/g) ?? []).length;
    }
    expect(mounts).toBe(1);
    expect(APP).toMatch(
      /<Analytics\s+beforeSend=\{analyticsBeforeSend\}\s*\/>/,
    );
  });
});
