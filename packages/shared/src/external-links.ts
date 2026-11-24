/**
 * @spec [owner ruling 2026-11-21 (counsel-approved) 8; Privacy Policy (the Calendly third-party
 *        entry)] | @implemented [2026-11-22]
 *
 * plain English: outbound links to third-party sites, defined once. Each is a plain link,
 * opened in a new tab with `rel="noopener noreferrer"`: no embed, no script, nothing loaded
 * from the third party on our pages, so the page CSP is unchanged. A build-time constant, not
 * an env var, for the same reason as `support-contact.ts`: it is public copy, and a static
 * page needs it at build time.
 */

/** A 15-minute call with a parent, booked on Calendly. */
export const PARENT_CALL_URL =
  "https://calendly.com/amingwa-lyceon/lyceon-for-parents-15-minute-call";

/** The words every placement uses for that link. */
export const PARENT_CALL_LABEL = "Book a call";

/**
 * The `/parent` hero's wording for the same link (owner brief 2026-11-22, approved prototype:
 * "Book a 15-minute call"). Same URL; the hero names the length, every other placement keeps
 * `PARENT_CALL_LABEL`.
 */
export const PARENT_CALL_HERO_LABEL = "Book a 15-minute call";
