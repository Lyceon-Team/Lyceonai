/**
 * @spec [Coding Standards §7.2 (one definition), CLAUDE.md "unified code across agents"; owner
 *        brief 2026-09-15 Part C.2 (support mailbox is moving — one place to change it)]
 *        | @implemented [2026-09-15]
 *
 * plain English: THE support address. `server/lib/support-contact.ts` and
 * `client/src/lib/support-contact.ts` were two identical literals that could drift the day the
 * mailbox moves; both now re-export this one. Pages that spelled the address out by hand
 * (legal, trust) read it from here too. Not an env var on purpose: it is public copy rendered
 * into pages and emails, not configuration, and a build-time constant is what a static page
 * needs.
 */
export const SUPPORT_EMAIL = "support@lyceon.ai";
