/**
 * @spec [LYCEON legal versioning Phase 2 §3; contracts/auth-standard-flow.contract.md AS-1]
 * @implemented 2026-09-15
 *
 * plain English: which documents a signup consents to, named by slug. The
 * version and content hash are NOT here — they are resolved at write time from
 * `legal/<slug>/` by `server/lib/legal-registry.ts`, so the version recorded
 * against a person and the text served to them come from one place.
 *
 * WHAT CHANGED. This file used to carry `docVersion: "2024-12-22"` — a date,
 * in a file separate from the text, which by then was two versions behind the
 * documents in the repository. A consent row named a version whose words
 * nothing could produce. Slugs point at the versioned directories instead.
 *
 * This module is imported by the browser as well as the server, so it must
 * stay free of `fs` and of anything Node-only. Resolution lives server-side.
 */
export const LEGAL_DOCS = {
  studentTerms: {
    docKey: "student_terms",
    slug: "student-terms",
  },
  privacyPolicy: {
    docKey: "privacy_policy",
    slug: "privacy-policy",
  },
} as const;

export const REQUIRED_SIGNUP_LEGAL_DOCS = [
  LEGAL_DOCS.studentTerms,
  LEGAL_DOCS.privacyPolicy,
] as const;

export type ConsentSource =
  | "email_signup_form"
  | "google_continue_pre_oauth"
  | "google_continue_click";
