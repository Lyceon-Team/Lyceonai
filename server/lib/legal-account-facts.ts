/**
 * @spec [LYCEON consent capture §6; owner ruling 2026-09-16 — "whatever consents
 *        a user has not given, prompt for them at sign-in"; Coding Standards §2
 *        layering, §13]
 * @implemented 2026-09-16
 *
 * plain English: the two account facts that decide which documents a person is
 * prompted for. ONE place derives them, because two places would drift and the
 * drift is invisible: the prompt would offer a document that re-accept refuses
 * to write, or the reverse, and both look like "the prompt is broken".
 *
 * expected outcome: `/api/profile` and `POST /api/legal/reaccept` compute the
 * same outstanding set for the same person on the same request path.
 *
 * NEVER THROWS. A consent lookup can never fail a request — the rule the
 * /api/profile outage of 2026-09-16 was written in. A link read that errors is
 * logged at ERROR and the fact reads false, so the worst case is a prompt that
 * does not appear yet, never a person who cannot sign in. Failing open on a
 * FACT under-prompts, which is the safe direction: it withholds a question, not
 * an account.
 *
 * ONE QUERY. `stripeCustomerId` is passed in because both callers already load
 * the profile row and the column rides along in that same select for free. Only
 * the link read is new, and it goes through the canonical `guardian_links` data
 * layer rather than a fourth ad-hoc query against that table.
 *
 * trade-offs / edge cases:
 *  - `hasEverPaid` is `stripe_customer_id !== null`, which is set on the PAYER
 *    when a Checkout Session is created (`billing-routes.ts`), not when money
 *    moves. So it reads true for somebody who opened checkout and abandoned it.
 *    The alternative is worse: entitlements are STUDENT-scoped, so a guardian
 *    who paid has no entitlement row of their own, and inferring the payer from
 *    a link would name a guardian who is merely linked to a student that paid
 *    for themselves. This fact needs no inference and no join — it is recorded
 *    against the account that transacted. Over-asking a dismissible prompt is
 *    the lesser error, and the two production accounts it over-includes are
 *    named in the PR.
 *  - A guardian whose every link is revoked stops owing Parent Terms. That is
 *    the rule working: the obligation follows the relationship.
 */
import { getAllGuardianStudentLinks } from "./account";
import type { LegalAccountFacts } from "../../shared/legal-consent.js";
import { logger } from "../logger";

export async function loadLegalAccountFacts(
  userId: string,
  stripeCustomerId: string | null,
): Promise<LegalAccountFacts> {
  let hasActiveGuardianLink = false;
  try {
    const links = await getAllGuardianStudentLinks(userId);
    hasActiveGuardianLink = links.length > 0;
  } catch (err: unknown) {
    logger.error(
      "LEGAL",
      "account_facts_link_read_failed",
      "Could not read guardian links while deriving the outstanding consent set; treating the account as unlinked",
      { error: err instanceof Error ? err.message : "unknown" },
    );
  }

  return {
    hasActiveGuardianLink,
    hasEverPaid: stripeCustomerId !== null,
  };
}
