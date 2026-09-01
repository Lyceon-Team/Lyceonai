/**
 * @spec [CodeQL js/reflected-xss alert #36 — server/index.ts, the `/legal/:slug` handler;
 *        Coding Standards §12.2] | @implemented [2026-08-27]
 *
 * plain English: proves the `/legal/:slug` page reflects only slugs that are OWN KEYS of
 * `LEGAL_META`, and that the request's own string never reaches the HTML.
 *
 * WHY THE INHERITED-MEMBER CASES ARE THE ONES THAT MATTER.
 *   The handler used to guard with `const meta = LEGAL_META[slug]; if (!meta) return next()`.
 *   `LEGAL_META` is a plain object literal, so that index also resolves members inherited
 *   from `Object.prototype`: `LEGAL_META["constructor"]` is `Object` — truthy — so
 *   `/legal/constructor` passed the guard and echoed "constructor" straight back into the
 *   page body. The guard read like an allowlist and was a truthiness test.
 *
 *   These cases are chosen because they DISCRIMINATE. Restoring the old line turns every
 *   one of them red. A case like `/legal/<script>alert(1)</script>` is deliberately NOT
 *   here: `LEGAL_META["<script>alert(1)</script>"]` is undefined under both the old and the
 *   new code, so it falls through either way and the case could never fail. It would read
 *   as coverage while proving nothing.
 *
 * WHICH SLUGS THIS HANDLER ACTUALLY SEES.
 *   `PUBLIC_SSR_ROUTES` registers exact `/legal/...` routes BEFORE this one, so those never
 *   reach it — an early draft of this file asserted against `/legal/privacy-policy` and was
 *   really exercising the explicit route, not the fallback. The servable set is derived
 *   from both tables below rather than hardcoded, so moving a page between them cannot
 *   quietly empty this test.
 *
 * MUTATION THAT MUST TURN THIS RED — in server/index.ts, replace
 *     const requestedSlug = String(req.params.slug || "");
 *     const slug = Object.keys(LEGAL_META).find((key) => key === requestedSlug);
 *     if (slug === undefined) return next();
 *   with the original
 *     const slug = String(req.params.slug || "");
 *   Every "inherited member" case below then reflects its slug and fails.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { LEGAL_META } from "../../shared/seo/public-meta";
import { PUBLIC_SSR_ROUTES } from "../../server/seo-content";

/**
 * Members every plain object literal inherits from `Object.prototype`. Each one is a
 * truthy `LEGAL_META[key]` and none is a real legal page.
 */
const INHERITED_MEMBERS = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
] as const;

/** Own keys of LEGAL_META with no earlier exact route — the slugs this handler serves. */
const FALLBACK_SLUGS = Object.keys(LEGAL_META).filter(
  (key) => !(`/legal/${key}` in PUBLIC_SSR_ROUTES),
);

describe("/legal/:slug reflects only own keys of LEGAL_META (js/reflected-xss #36)", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
  });

  it("has slugs that actually reach this handler", () => {
    // Guards the two `it.each` blocks below from silently becoming no-ops: if every legal
    // page gained an explicit PUBLIC_SSR_ROUTES entry, the fallback would serve nothing and
    // its cases would vanish rather than fail. Zero cases is not zero risk.
    expect(
      FALLBACK_SLUGS.length,
      "no LEGAL_META key reaches /legal/:slug — this suite proves nothing",
    ).toBeGreaterThan(0);
  });

  it.each(FALLBACK_SLUGS)(
    "still serves /legal/%s and echoes its slug",
    async (slug) => {
      // The positive control. A fix that reflected NOTHING would satisfy every negative case
      // while silently breaking the page, so the feature is asserted too.
      const res = await request(app).get(`/legal/${slug}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain(`<code>/legal/${slug}</code>`);
      expect(res.text).toContain("Back to Legal");
    },
  );

  it.each(INHERITED_MEMBERS)(
    "does not render the legal page for the inherited member %s",
    async (member) => {
      // Sanity: this really is a truthy bare index, which is what the old guard tested. If
      // a future refactor gives LEGAL_META a null prototype, this assertion fails and the
      // case says why it no longer discriminates rather than passing quietly.
      expect(
        (LEGAL_META as Record<string, unknown>)[member],
        `${member} is no longer a truthy bare index — this case no longer discriminates`,
      ).toBeTruthy();

      const res = await request(app).get(`/legal/${member}`);

      // The handler must fall through, so the slug is never echoed into a legal article.
      expect(res.text ?? "").not.toContain(`<code>/legal/${member}</code>`);
      expect(res.text ?? "").not.toContain("Back to Legal");
    },
  );
});
