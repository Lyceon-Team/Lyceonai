/**
 * F-59: every HTML page carries the security headers, set by vercel.json.
 *
 * @spec [student-UI register §8 F-59, owner ruling (Karl) 2026-10-02: headers on all HTML pages
 *        via vercel.json; frame-ancestors, X-Frame-Options, nosniff, Referrer-Policy and
 *        Permissions-Policy enforced; the CSP report-only first, enforced once the preview flows
 *        report nothing; F-58 (the theme script by hash). Owner ruling (Karl) 2026-10-03: allow
 *        'unsafe-eval' (the Desmos calculator evals; it was the only flow reporting) and enforce
 *        the CSP] | @implemented [2026-10-02; enforced 2026-10-03]
 *
 * plain English: Vercel serves index.html and the assets from its CDN, so the Express helmet
 * headers never reach a page. vercel.json carries them instead. This walks vercel.json's
 * `routes` the way Vercel does (in order; a route with `headers` and `continue: true` adds its
 * headers and matching goes on; any other matching route ends it) for real page paths and for
 * the paths Express answers, and checks:
 *   1. every page path gets every header, with the exact value;
 *   2. the header route sits before `handle: filesystem`, so a file served from the CDN (`/`,
 *      the assets) gets the headers too, not only the SPA fallback;
 *   3. /api and /auth/callback get none of them: Express sets its own there, and two CSP
 *      headers would both apply;
 *   4. the page CSP is enforced (no report-only header) and allows scripts from our origin, the
 *      theme script by its hash, eval (Desmos only needs it; ruled 2026-10-03) and the Desmos
 *      calculator, and nothing inline. 'unsafe-eval' applies to every page, not only the Math
 *      runner: the SPA is one document, so a per-route CSP is not possible here. That scope is
 *      a known gap in register §8, with isolating Desmos in a sandboxed cross-origin iframe
 *      recorded in §7.
 * The built page is checked separately, after the build: scripts/ci/page-csp-built-hash-gate.mjs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { THEME_BOOT_SCRIPT_HASH } from "../../server/middleware/security-headers";

const routeSchema = z.union([
  z.object({ handle: z.string() }).strict(),
  z
    .object({
      src: z.string(),
      dest: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      continue: z.boolean().optional(),
    })
    .strict(),
]);
type Route = z.infer<typeof routeSchema>;

const ROUTES: Route[] = z
  .object({ routes: z.array(routeSchema) })
  .passthrough()
  .parse(
    JSON.parse(
      readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"),
    ),
  ).routes;

/** The headers Vercel adds to a request for `pathname`, walking the routes in order. */
function headersFor(
  pathname: string,
  routes: Route[] = ROUTES,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const route of routes) {
    if ("handle" in route) continue;
    if (!new RegExp(route.src).test(pathname)) continue;
    Object.assign(out, route.headers ?? {});
    if (route.continue !== true) break;
  }
  return out;
}

/**
 * Each source beyond 'self', with the flow that needs it (observed with
 * tests/e2e/page-csp-flows.spec.ts against the built bundle, 2026-10-02):
 *   - script-src theme hash: every page (the theme boot in client/index.html, F-58).
 *   - script-src https://www.desmos.com: practice, review and exam Math runners (calculator.js).
 *   - script-src 'unsafe-eval': the Desmos calculator evals (261 reports per session with the
 *     policy report-only, 2026-10-02; blank calculator when enforced without it). Owner ruling
 *     (Karl) 2026-10-03: allowed, page-wide (see 4. above).
 *   - style-src 'unsafe-inline': every page (React style attributes, Radix positioning).
 *   - style-src / font-src Google Fonts: every page (Poppins and Inter, client/index.html).
 *   - font-src data:: review and LISA (KaTeX inlines a small font in MathRenderer's CSS).
 *   - img-src data:: inline SVG/data images in the bundle.
 *   - worker-src blob:: the Desmos calculator starts its worker from a blob URL.
 * Not needed, and so absent: Supabase (Google sign-in is a top-level navigation to its
 * authorize URL, which CSP does not govern; no browser fetch reaches Supabase), Stripe (Checkout
 * and the portal are navigations; no Stripe.js), Vercel Analytics (same-origin /_vercel/insights).
 */
const PAGE_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  `script-src 'self' '${THEME_BOOT_SCRIPT_HASH}' 'unsafe-eval' https://www.desmos.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
].join("; ");

const EXPECTED: Record<string, string> = {
  "Content-Security-Policy": PAGE_CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const PAGE_PATHS = [
  "/",
  "/index.html",
  "/login",
  "/dashboard",
  "/practice",
  "/review",
  "/calendar",
  "/profile",
  "/guardian/7f2c1e9a",
  "/exam/report/abc",
  "/assets/index-Cn6uYJjk.js",
  "/fonts/source-sans-3-latin-variable.woff2",
  // Paths that only look like the excluded ones are still pages.
  "/apixyz",
  "/auth/callbackx",
  "/auth",
];

const EXPRESS_PATHS = [
  "/api",
  "/api/",
  "/api/profile",
  "/api/billing/portal",
  "/auth/callback",
];

describe("F-59: page security headers (vercel.json)", () => {
  it.each(PAGE_PATHS)("%s gets every header, exactly", (p) => {
    expect(headersFor(p)).toEqual(EXPECTED);
  });

  it.each(EXPRESS_PATHS)("%s gets none (Express sets its own)", (p) => {
    expect(headersFor(p)).toEqual({});
  });

  it("the header route comes before the filesystem, so CDN files get the headers", () => {
    const headerAt = ROUTES.findIndex((r) => "headers" in r);
    const filesystemAt = ROUTES.findIndex(
      (r) => "handle" in r && r.handle === "filesystem",
    );
    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(filesystemAt).toBeGreaterThan(headerAt);
    expect(ROUTES.slice(0, headerAt).every((r) => "handle" in r)).toBe(true);
  });

  it("the CSP is enforced: no report-only header on any page", () => {
    for (const p of PAGE_PATHS) {
      expect(headersFor(p)["Content-Security-Policy"]).toBe(PAGE_CSP);
      expect(headersFor(p)).not.toHaveProperty(
        "Content-Security-Policy-Report-Only",
      );
    }
  });

  it("script-src is our origin, the theme script's hash, eval (Desmos) and Desmos; nothing inline", () => {
    const csp = headersFor("/")["Content-Security-Policy"] ?? "";
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src "));
    expect(scriptSrc).toBe(
      `script-src 'self' '${THEME_BOOT_SCRIPT_HASH}' 'unsafe-eval' https://www.desmos.com`,
    );
    // 'unsafe-eval' appears in script-src only (owner ruling 2026-10-03), never inline script.
    expect(csp.match(/'unsafe-eval'/g)).toHaveLength(1);
    expect(scriptSrc).not.toMatch(/unsafe-inline/);
    expect(csp).toMatch(/(^|; )frame-ancestors 'none'(;|$)/);
  });

  it("the walker stops at a non-continue route, and a route without continue adds its own headers", () => {
    // The walker is what every assertion above rests on, so pin its two rules.
    const routes: Route[] = [
      { src: "^/a", headers: { X: "1" }, continue: true },
      { src: "^/a$", dest: "/index.html" },
      { src: "^/a", headers: { Y: "2" }, continue: true },
    ];
    expect(headersFor("/a", routes)).toEqual({ X: "1" });
    expect(headersFor("/ab", routes)).toEqual({ X: "1", Y: "2" });
  });
});
