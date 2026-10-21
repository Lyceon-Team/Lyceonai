/**
 * The current page as a route pattern, for feedback.
 *
 * @spec [final brief "Trustpilot card + Feedback" (Karl, 2026-10-20) §3: "the route pattern only
 *       (e.g. /practice/session/:id; no real IDs, no query string)"] | @implemented [2026-10-20]
 *
 * plain English: the student routes' own patterns (route-shells.ts) are matched first, so a
 * practice session reads `/practice/session/:sessionId`; any other page has every id-like segment
 * replaced by `:id` (`toRoutePattern`, packages/shared). The query string and fragment are
 * dropped. The server re-checks the shape and the table refuses anything else.
 */
import { STUDENT_ROUTE_SHELLS } from "./route-shells";
import { toRoutePattern } from "../../../packages/shared/src/product-feedback-schema";

const KNOWN_PATTERNS: readonly string[] = Object.keys(STUDENT_ROUTE_SHELLS);

export function currentRoutePattern(
  location: string = typeof window === "undefined"
    ? "/"
    : window.location.pathname,
): string | null {
  return toRoutePattern(location, KNOWN_PATTERNS);
}
