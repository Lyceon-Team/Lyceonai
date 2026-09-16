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
 * What a person must currently hold to keep USING the product — the set the
 * blocking re-consent modal enforces.
 *
 * BILLING TERMS IS DELIBERATELY NOT HERE, and this is the one judgement in this
 * file worth arguing with. It is transactional: required at checkout, captured
 * at checkout, and re-consented at the next one. Locking someone out of their
 * study plan because a billing document was revised would punish them for a
 * subscription they may have already cancelled. §17602 asks for consent before
 * a charge, not before a login.
 *
 * Parent Terms IS here, but only for a guardian who actually holds a link.
 * A guardian account with no student has nothing to consent about yet.
 */
export function requiredLegalDocsForUse(context: {
  role: string | null | undefined;
  hasGuardianLink: boolean;
}): readonly LegalDocRef[] {
  const base: LegalDocRef[] = [
    LEGAL_DOCS.studentTerms,
    LEGAL_DOCS.privacyPolicy,
  ];
  if (context.role === "guardian" && context.hasGuardianLink) {
    base.push(LEGAL_DOCS.parentGuardianTerms);
  }
  return base;
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
