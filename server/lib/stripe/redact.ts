/**
 * @spec [Charter §6; Doc 01A §14] | @implemented [2026-08-20]
 * @revised [2026-08-28] — implementation promoted to `server/lib/redact.ts`.
 *
 * plain English: this path is now a re-export, not a second copy. The digest
 * moved up a layer because `server/logger.ts` became the structural chokepoint
 * that applies it (Codex HIGH-6), and the core logger must not import from the
 * Stripe vertical. Expected outcome: existing importers
 * (`webhook-handler.ts:45`, `billing-routes.ts:52`) keep working against ONE
 * implementation. Trade-off: an extra hop for the reader, paid to avoid a
 * second digest that could drift from the first.
 */
export { digestId, classifyError } from "../redact";
export type { ErrorClass } from "../redact";
