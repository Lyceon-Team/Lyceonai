/**
 * @spec [Coding Standards §7.2 (one definition), CLAUDE.md "unified code across agents"; owner
 *        brief 2026-09-15 Part C.2 (support mailbox is moving — one place to change it);
 *        owner brief 2026-09-16 Parts A and B (both mailboxes now exist as Google Workspace
 *        groups; Reply-To on transactional mail; privacy-facing copy routes to privacy@)]
 *        | @implemented [2026-09-15, extended 2026-09-16]
 *
 * plain English: THE two public mailboxes. `server/lib/support-contact.ts` and
 * `client/src/lib/support-contact.ts` were two identical literals that could drift the day the
 * mailbox moves; both now re-export these. Pages and templates that spelled an address out by
 * hand read it from here. Which one a surface uses is a content decision, not a config one:
 * privacy policy, data-rights, deletion and parental-consent copy → PRIVACY_EMAIL; everything
 * else, and the Reply-To on every transactional send → SUPPORT_EMAIL. Not env vars on
 * purpose: they are public copy rendered into pages and emails, not configuration, and a
 * build-time constant is what a static page needs.
 */
export const SUPPORT_EMAIL = "support@lyceon.ai";
export const PRIVACY_EMAIL = "privacy@lyceon.ai";
