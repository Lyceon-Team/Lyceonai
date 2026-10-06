/**
 * Removes credential-like values from anything PostHog would send.
 *
 * @spec [owner Step 0 decision 5, 2026-10-05 ("Guardian link code: scrub it in before_send");
 *       Coding Standards §12.1 (never log tokens); SCL-201 IS 1 ("no PII in any event property")]
 *       | @implemented [2026-10-05]
 *
 * plain English: the guardian deep link is `/guardian?code=<student link code>`, and PostHog's
 * defaults record the page address on every event (`$current_url`, `$referrer`, the first-touch
 * `$initial_*` person properties), in the clicked element chain (`$elements_chain` carries link
 * `href`s), and in replay page metadata. Every string value is passed through one regex that
 * blanks the value of any credential-shaped query parameter, and the URL-valued properties lose
 * their `#fragment` (Supabase-style tokens travel there). The parameter names are the generic
 * ones (code, token, …), not a Lyceon-specific list, so a future link of the same shape is
 * covered too.
 */

// The value stops at a backslash too, so a match inside JSON-encoded replay data never swallows
// an escape character.
const SENSITIVE_PARAM =
  /([?&](?:code|token|token_hash|access_token|refresh_token|link_code)=)[^&#"'\s\\]*/gi;

export const REDACTED = "[redacted]";

/** Properties whose whole value is a URL: their fragment is dropped as well. */
const URL_PROPERTIES = new Set([
  "$current_url",
  "$referrer",
  "$initial_current_url",
  "$initial_referrer",
  "$prev_pageview_pathname",
]);

export function scrubString(value: string): string {
  return value.replace(SENSITIVE_PARAM, `$1${REDACTED}`);
}

export function scrubUrl(value: string): string {
  const hash = value.indexOf("#");
  return scrubString(hash === -1 ? value : value.slice(0, hash));
}

/** Scrubs one level of an event's property bag (and `$set` / `$set_once`, one level deeper). */
export function scrubProperties(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "string") {
      out[key] = URL_PROPERTIES.has(key) ? scrubUrl(value) : scrubString(value);
    } else if ((key === "$set" || key === "$set_once") && isRecord(value)) {
      out[key] = scrubProperties(value);
    } else if (key === "$snapshot_data" && value !== undefined) {
      // Replay data (any rrweb event: full DOM snapshots, mutations, page metadata) can carry a
      // link `href` anywhere in its tree, so the whole payload is scrubbed as one string.
      out[key] = JSON.parse(scrubString(JSON.stringify(value))) as unknown;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
