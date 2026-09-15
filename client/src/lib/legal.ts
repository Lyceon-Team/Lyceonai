/**
 * @spec [LYCEON legal versioning Phase 2 §2; Coding Standards §11.1]
 * @implemented 2026-09-15
 *
 * plain English: the app-side registry for legal documents — slug, consent key,
 * blurb. It no longer contains a single line of document text, nor a path to a
 * file that does.
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
 * AND THE SIX PDFs. `client/public/legal/` held the last duplicate of any legal
 * document text: v1, December 2024, `Lyceon` branding, sitting beside markdown
 * that is v2.0 effective 2026-09-11. A reader on the v2.0 Privacy Policy who
 * asked for the downloadable copy got the December 2024 text. They were binary,
 * so nothing regenerated them from `en.md` and no gate could see they had
 * drifted. Deleted with their links rather than resynchronised — the markdown
 * page is the document, and `index.css` makes it print.
 *
 * trade-offs:
 *  - `shortDescription` stays here because it is product metadata, not document
 *    content: no manifest carries it, and it is not text anybody agrees to.
 *  - The PDF path is GONE. A path to a deleted file is a dangling citation, and
 *    an entry still carrying one would invite regenerating the file to satisfy it.
 *  - `title` is deliberately NOT here. It lives in each manifest, so the hub
 *    and the document page name a document from the same place the
 *    cross-reference gate resolves it.
 *
 * edge cases:
 *  - THREE published documents have no entry here and so are not listed on the
 *    hub, though each renders at its own URL: `billing-terms`, `refund-policy`
 *    and `subscription-auto-renewal-notice`. They have no blurb and no consent
 *    key. `billing-terms` in particular was published on 2026-09-15, so the
 *    note that previously stood here — "not listed on the hub until it is
 *    published" — no longer describes anything: it IS published, and still not
 *    listed. Listing them needs a `shortDescription` each, which is product
 *    copy nobody has written. Reported, not silently left implying otherwise.
 *  - There are no lookup helpers here. `getLegalDocBySlug` existed only to gate
 *    the document page on this six-entry list, which 404'd three real
 *    documents; removing that gate left it with no caller. `getLegalDocByKey`
 *    had no caller before Phase 2 either. `legalDocs` is consumed directly by
 *    the hub, which is the one surface this list is for.
 */
import { csrfFetch } from "./csrf";

export type LegalDocRegistryEntry = {
  slug: string;
  docKey: string;
  shortDescription: string;
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
  },
  {
    slug: "community-guidelines",
    docKey: "community_guidelines",
    shortDescription: "How users are expected to behave when using LYCEON.",
  },
  {
    slug: "privacy-policy",
    docKey: "privacy_policy",
    shortDescription:
      "How we collect, use, store, share, and protect information.",
  },
  {
    slug: "honor-code",
    docKey: "honor_code",
    shortDescription:
      "Our commitment to honest learning and academic integrity.",
  },
  {
    slug: "student-terms",
    docKey: "student_terms",
    shortDescription: "The terms that govern your access to and use of LYCEON.",
  },
  {
    slug: "parent-guardian-terms",
    docKey: "parent_guardian_terms",
    shortDescription:
      "Terms for parents or guardians providing consent for minors.",
  },
];

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
