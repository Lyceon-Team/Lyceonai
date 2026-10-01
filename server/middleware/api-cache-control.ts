import type { NextFunction, Request, Response } from "express";

/**
 * @spec [owner ruling F-27, 2026-09-30; Coding Standards §12.2 (minimise data on student
 *   surfaces); register F-27] | @implemented [2026-09-30] |
 * plain English: every `/api/*` response is `Cache-Control: private, no-store` unless its route
 * deliberately says otherwise. Before this, no API response set the header, so Vercel sent its
 * default `public, max-age=0, must-revalidate` on per-user bodies such as `/api/profile`.
 * `public` lets a shared cache store a student's data; `private, no-store` forbids any cache
 * from keeping it.
 *
 * The default is set before any router runs, so a route that sets its own header later wins.
 * Routes allowed to stay cacheable must serve public, non-user data, and are listed in
 * `API_CACHEABLE_ROUTES` with the reason; a route setting `public` anywhere else is a defect.
 *
 * edge cases: 404s, error responses and early rejections (CSRF, rate limit, auth) carry the
 * default too, because the header is set before they run.
 */
export const API_CACHE_CONTROL_DEFAULT = "private, no-store";

/** The only `/api` routes that may set a public cache header, each with its reason. */
export const API_CACHEABLE_ROUTES: ReadonlyArray<{
  method: "GET";
  path: string;
  reason: string;
}> = [
  {
    method: "GET",
    path: "/api/public/pricing",
    reason:
      "The public price list shown to signed-out visitors: the same body for every viewer, no user data (server/routes/public-pricing-routes.ts).",
  },
];

export function apiCacheControlDefault(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Cache-Control", API_CACHE_CONTROL_DEFAULT);
  next();
}
