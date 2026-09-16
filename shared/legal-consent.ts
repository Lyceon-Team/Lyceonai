/**
 * @spec [LYCEON consent capture §1, §2; contracts/auth-standard-flow.contract.md AS-1;
 *        Cal. Bus. & Prof. Code § 17602(a)(4)]
 * @implemented 2026-09-16
 *
 * plain English: which documents require an acceptance RECORD, and at which
 * surface. Named by slug only — the version and content hash are resolved at
 * write time from `legal/<slug>/` by `server/lib/legal-registry.ts`, so the
 * version recorded against a person and the text served to them come from one
 * place. Nothing here names a version, ever.
 *
 * FOUR RECORDS, NINE DOCUMENTS. The other five are incorporated by reference:
 * Honor Code and Community Guidelines through Student Terms §6 and §11, Refund
 * Policy and Auto-Renewal Notice through Billing Terms §5 and §8, and Trust &
 * Safety is not a contract at all. Incorporation by reference is ordinary
 * contract practice; a signup form with nine checkboxes is worse for
 * comprehension, not better, and a person who ticks nine boxes has read fewer
 * of them than one who ticks two.
 *
 * WHAT CHANGED. This file used to carry `docVersion: "2024-12-22"` — a date, in
 * a file separate from the text, by then two versions behind the documents in
 * the repository. A consent row named a version whose words nothing could
 * produce. It then carried two slugs and a flat required-list, which could not
 * express "Parent Terms, but only for a guardian" or "Billing Terms, but only
 * at checkout". Requirement is a function of context now, because it always was.
 *
 * This module is imported by the browser as well as the server, so it must stay
 * free of `fs` and of anything Node-only. Resolution lives server-side.
 */
import { z } from "zod";

export type LegalDocRef = {
  readonly docKey: string;
  readonly slug: string;
};

export const LEGAL_DOCS = {
  studentTerms: {
    docKey: "student_terms",
    slug: "student-terms",
  },
  privacyPolicy: {
    docKey: "privacy_policy",
    slug: "privacy-policy",
  },
  parentGuardianTerms: {
    docKey: "parent_guardian_terms",
    slug: "parent-guardian-terms",
  },
  billingTerms: {
    docKey: "billing_terms",
    slug: "billing-terms",
  },
} as const satisfies Record<string, LegalDocRef>;

/**
 * Accepted by everyone at account creation, whatever their role. A guardian
 * uses the platform too, and Student Terms governs use of it.
 */
export const REQUIRED_SIGNUP_LEGAL_DOCS = [
  LEGAL_DOCS.studentTerms,
  LEGAL_DOCS.privacyPolicy,
] as const;

/** Accepted by a guardian when they connect to a student. */
export const GUARDIAN_LINK_LEGAL_DOC = LEGAL_DOCS.parentGuardianTerms;

/** Accepted by a payer in Checkout, separately from Terms of Use. */
export const CHECKOUT_LEGAL_DOC = LEGAL_DOCS.billingTerms;

/**
 * The account facts the outstanding set is derived FROM. Not a role, not a
 * category — two things that are either true of this account or not.
 *
 * `hasActiveGuardianLink` is "this account is the guardian on at least one
 * active link". The student on the other side of that link does not owe Parent
 * Terms; the document governs the guardian's obligations, not the student's.
 *
 * `hasEverPaid` is "this account has been the PAYER in a Checkout Session we
 * created" — see `loadLegalAccountFacts` for why that is the fact we can
 * actually establish, and what it over-includes.
 */
export type LegalAccountFacts = {
  readonly hasActiveGuardianLink: boolean;
  readonly hasEverPaid: boolean;
};

/**
 * What this account has not agreed to, derived from the account's own facts.
 * Not a gate — nothing anywhere withholds access on the strength of this list.
 *
 * WHATEVER A USER HAS NOT GIVEN, PROMPT FOR IT. Owner ruling 2026-09-16. One
 * rule, every user:
 *
 *   Student Terms    always — every account uses the platform
 *   Privacy Policy   always — every account
 *   Parent Terms     the account holds an active guardian link
 *   Billing Terms    the account has ever paid
 *
 * WHY THIS IS NOT THE ROLE LOGIC THAT WAS RULED OUT. The version this replaces
 * took `{ role, hasGuardianLink }` and branched on ROLE: an account whose
 * `profiles.role` said "guardian" owed Parent Terms whether or not it was
 * linked to anyone, and a linked account whose role said "student" did not.
 * That asked a category. This asks a fact: a guardian owes Parent Terms
 * BECAUSE THEY ARE LINKED, and stops owing it if every link is revoked. No
 * role appears here, in any form — `LegalAccountFacts` has nowhere to put one.
 *
 * WHY NOT "CAPTURED AT THE ACTION, SO NEVER ASK AGAIN". That was the previous
 * ruling and it left a hole this one closes: capture at redemption and at
 * checkout only covers people who went through those surfaces AFTER the capture
 * existed. In production one guardian holds two active links and no Parent
 * Terms acceptance at all — they linked before that capture was built, and
 * before this change there was no surface anywhere that would ever ask them.
 * A document nobody can be asked for is a document nobody holds.
 *
 * ORDER IS STABLE AND DELIBERATE: the two universal documents first, then the
 * conditional ones. The prompt renders in this order, so a guardian sees the
 * same first two rows every other account sees.
 */
export function requiredLegalDocsForUse(
  facts: LegalAccountFacts,
): readonly LegalDocRef[] {
  const docs: LegalDocRef[] = [...REQUIRED_SIGNUP_LEGAL_DOCS];
  if (facts.hasActiveGuardianLink) docs.push(LEGAL_DOCS.parentGuardianTerms);
  if (facts.hasEverPaid) docs.push(LEGAL_DOCS.billingTerms);
  return docs;
}

/**
 * Where an acceptance was collected. Mirrors the `consent_source` CHECK on
 * `public.legal_acceptances` — a value absent there is refused by the database,
 * not by the application, so the two must be widened together.
 */
export type ConsentSource =
  | "email_signup_form"
  | "google_continue_pre_oauth"
  | "google_continue_click"
  | "guardian_link_redeem"
  | "stripe_checkout"
  | "reconsent_prompt";

/** Every value the CHECK accepts, for tests that assert the two agree. */
export const CONSENT_SOURCES: readonly ConsentSource[] = [
  "email_signup_form",
  "google_continue_pre_oauth",
  "google_continue_click",
  "guardian_link_redeem",
  "stripe_checkout",
  "reconsent_prompt",
] as const;

/**
 * What `/api/profile` reports as outstanding, and what the blocking re-consent
 * modal renders. Every field is server-derived: the title, version and date come
 * from `legal/<slug>/`, and `acceptedVersion` from this person's own rows.
 *
 * WHY THE SCHEMA LIVES HERE rather than in `packages/shared`. It is the wire
 * shape of the concept this file already owns, and both the server that emits it
 * and the browser that parses it already import this module. Putting the doc
 * refs here and their response shape one package away would be two homes for one
 * idea — the divergence the unified-code rule exists to prevent.
 *
 * `acceptedVersion` is nullable and means exactly "never accepted this document".
 * It is NOT an empty string and not the string "none": the modal renders those
 * two cases with different words, so the distinction has to survive the wire.
 */
export const outstandingLegalDocSchema = z.object({
  slug: z.string().min(1),
  docKey: z.string().min(1),
  title: z.string().min(1),
  version: z.string().min(1),
  effectiveDate: z.string().min(1),
  acceptedVersion: z.string().min(1).nullable(),
});

export type OutstandingLegalDoc = z.infer<typeof outstandingLegalDocSchema>;

export const outstandingLegalSchema = z.array(outstandingLegalDocSchema);
