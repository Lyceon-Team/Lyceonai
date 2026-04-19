export const LEGAL_DOCS = {
  studentTerms: {
    docKey: "student_terms",
    docVersion: "2024-12-20",
  },
  privacyPolicy: {
    docKey: "privacy_policy",
    docVersion: "2024-12-22",
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
