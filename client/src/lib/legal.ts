/**
 * @spec [LYCEON legal versioning Phase 2 §2; Coding Standards §11.1]
 * @implemented 2026-09-15
 *
 * plain English: the app-side registry for legal documents — slug, consent key,
 * blurb, PDF path. It no longer contains a single line of document text.
 *
 * expected outcome: one source for every document body. Titles, versions,
 * effective dates and bodies come from `legal/` at runtime via
 * `./legal-content`; this file holds only the metadata the app needs to route
 * and describe them, which does not exist in `legal/`.
 *
 * WHAT WAS HERE. 1,037 lines carrying the full body of six documents, stamped
 * `lastUpdated: '2024-12-22'` with no version field at all, spelling `Lyceon`
 * 151 times against the corpus's `LYCEON`, and `hello@lyceon.ai` three times
 * against `support@lyceon.ai`. It was the text users actually read, two
 * versions behind `docs/Spec`, and nothing tied it to the `docVersion` recorded
 * against them at signup. Deleting it is the point of this phase.
 *
 * trade-offs:
 *  - `shortDescription` and `pdfPath` stay here because they are product
 *    metadata, not document content: no manifest carries them, and they are
 *    not text anybody agrees to.
 *  - `title` is deliberately NOT here. It lives in each manifest, so the hub
 *    and the document page name a document from the same place the
 *    cross-reference gate resolves it.
 *
 * edge cases:
 *  - `billing-terms` has no entry: it has no blurb, no PDF and no consent key,
 *    and is not listed on the hub until it is published.
 */
import { csrfFetch } from "./csrf";

export type LegalDocRegistryEntry = {
  slug: string;
  docKey: string;
  shortDescription: string;
  pdfPath: string;
};

/**
 * Order is the order the hub lists them in. `trust-and-safety` is filtered out
 * by the hub and given its own card, as before.
 */
export const legalDocs: LegalDocRegistryEntry[] = [
  {
    slug: "trust-and-safety",
    docKey: "trust_and_safety",
    shortDescription:
      "How we approach trust, safety, and responsibility in tutor-supported learning.",
    pdfPath: "/legal/Trust-and-Safety-at-Lyceon.pdf",
  },
  {
    slug: "community-guidelines",
    docKey: "community_guidelines",
    shortDescription: "How users are expected to behave when using LYCEON.",
    pdfPath: "/legal/Lyceon-Community-Guidelines.pdf",
  },
  {
    slug: "privacy-policy",
    docKey: "privacy_policy",
    shortDescription:
      "How we collect, use, store, share, and protect information.",
    pdfPath: "/legal/Lyceon-Privacy-Policy.pdf",
  },
  {
    slug: "honor-code",
    docKey: "honor_code",
    shortDescription:
      "Our commitment to honest learning and academic integrity.",
    pdfPath: "/legal/Lyceon-Honor-Code.pdf",
  },
  {
    slug: "student-terms",
    docKey: "student_terms",
    shortDescription: "The terms that govern your access to and use of LYCEON.",
    pdfPath: "/legal/Lyceon-Student-Terms-of-Use.pdf",
  },
  {
    slug: "parent-guardian-terms",
    docKey: "parent_guardian_terms",
    shortDescription:
      "Terms for parents or guardians providing consent for minors.",
    pdfPath: "/legal/Lyceon-Parent-Guardian-Terms.pdf",
  },
];

export function getLegalDocBySlug(
  slug: string,
): LegalDocRegistryEntry | undefined {
  return legalDocs.find((doc) => doc.slug === slug);
}

export function getLegalDocByKey(
  docKey: string,
): LegalDocRegistryEntry | undefined {
  return legalDocs.find((doc) => doc.docKey === docKey);
}

export interface LegalAcceptance {
  docKey: string;
  docVersion: string;
  actorType: "student" | "parent";
  minor: boolean;
}

export async function recordAcceptance(
  acceptance: LegalAcceptance,
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await csrfFetch("/api/legal/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(acceptance),
    });

    const data = await resp.json();
    if (!resp.ok)
      return {
        success: false,
        error: data?.error || "Failed to record acceptance",
      };
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function fetchUserAcceptances(): Promise<{
  acceptances: Array<{
    doc_key: string;
    doc_version: string;
    accepted_at: string;
    actor_type: string;
  }>;
  error?: string;
}> {
  try {
    const resp = await csrfFetch("/api/legal/acceptances", {
      method: "GET",
      credentials: "include",
    });

    const data = await resp.json();
    if (!resp.ok)
      return {
        acceptances: [],
        error: data?.error || "Failed to load acceptances",
      };

    return { acceptances: data.acceptances || [] };
  } catch (err: unknown) {
    return {
      acceptances: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export function hasAccepted(
  acceptances: Array<{ doc_key: string; doc_version: string }>,
  docKey: string,
  docVersion: string,
): boolean {
  return acceptances.some(
    (a) => a.doc_key === docKey && a.doc_version === docVersion,
  );
}
