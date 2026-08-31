/**
 * @spec [Charter §6; Doc 01A §14] | @implemented [2026-08-20]
 * @revised [2026-08-28] — implementation promoted to `server/lib/redact.ts`.
 *
 * plain English: this path is now a re-export, not a second copy. The digest
 * moved up a layer because `server/logger.ts` became the structural chokepoint
 * that applies it (Codex HIGH-6), and the core logger must not import from the
 * Stripe vertical. Expected outcome: existing importers
 * (`webhook-handler.ts` and `billing-routes.ts`, both importing `digestId`)
 * keep working against ONE implementation. Trade-off: an extra hop for the
 * reader, paid to avoid a second digest that could drift from the first.
 *
 * The importers are named WITHOUT line numbers on purpose. They carried them
 * once and the numbers were already stale on `origin/stripe`, then drifted
 * again when an unrelated comment edit shifted the file below them. Nothing
 * enforces a citation in a docblock, so a line number here is a claim that
 * rots silently and cannot be checked from where it is written — the exact
 * defect the `callSite` / `callSiteExpect` mechanism exists to prevent in the
 * matrix. Where a citation is not enforced, name the symbol, not the line.
 */
export { digestId, classifyError } from "../redact";
export type { ErrorClass } from "../redact";
