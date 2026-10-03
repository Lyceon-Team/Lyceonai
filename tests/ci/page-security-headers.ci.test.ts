/**
 * F-59: every HTML page carries the security headers, set by vercel.json.
 *
 * @spec [student-UI register §8 F-59, owner ruling (Karl) 2026-10-02: headers on all HTML pages
 *        via vercel.json; frame-ancestors, X-Frame-Options, nosniff, Referrer-Policy and
 *        Permissions-Policy enforced; the CSP report-only first, enforced once the preview flows
 *        report nothing; F-58 (the theme script by hash)] | @implemented [2026-10-02]
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
 *   4. the page CSP allows scripts from our origin, the theme script by its hash and the Desmos
 *      calculator, and nothing inline or eval'd.
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
      // SEO Wave 1A (#1054): 301 redirects and the final 404 carry a status; the
      // directory-index rewrite applies only when its file exists (check).
      status: z.number().int().optional(),
      check: z.boolean().optional(),
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
  `script-src 'self' '${THEME_BOOT_SCRIPT_HASH}' https://www.desmos.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const EXPECTED: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Content-Security-Policy-Report-Only": PAGE_CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // SEO Wave 1B F5 (owner answer 8, 2026-10-03): two years, subdomains included, and
  // deliberately NO `preload` — preload-list submission is hard to undo and is not approved.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
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

  it("script-src is our origin, the theme script's hash and Desmos; nothing inline or eval'd", () => {
    const csp = headersFor("/")["Content-Security-Policy-Report-Only"] ?? "";
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src "));
    expect(scriptSrc).toBe(
      `script-src 'self' '${THEME_BOOT_SCRIPT_HASH}' https://www.desmos.com`,
    );
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(scriptSrc).not.toMatch(/unsafe-inline/);
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
