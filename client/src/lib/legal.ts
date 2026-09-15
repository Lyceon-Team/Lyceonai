/**
 * @spec [LYCEON legal versioning — hub completeness; Coding Standards §11.1]
 * @implemented 2026-09-15
 *
 * plain English: the client-side API for recording and reading a user's legal
 * acceptances. It holds no list of documents and no document metadata at all.
 *
 * expected outcome: `legal/` is the only place that says which documents exist
 * and what they are called. The hub enumerates the generated
 * `legal/index.json`; titles, descriptions and hub order come from each
 * manifest; versions, effective dates and bodies from each version directory.
 * Publishing a tenth document puts it on the hub with no change to any file
 * under `client/`.
 *
 * WHAT WAS HERE, in the order it left:
 *  - 1,037 lines carrying the full body of six documents, stamped
 *    `lastUpdated: '2024-12-22'` with no version field, spelling `Lyceon` 151
 *    times against the corpus's `LYCEON`. It was the text users actually read,
 *    two versions behind `docs/Spec`, and nothing tied it to the `docVersion`
 *    recorded against them at signup.
 *  - `pdfPath`, and with it six PDFs under `client/public/legal/` — the last
 *    duplicate of any document text, v1 December 2024, already drifted. Binary,
 *    so no gate could see it. Deleted rather than resynchronised; the markdown
 *    page is the document and `index.css` makes it print.
 *  - `getLegalDocBySlug`, which existed only to gate the document page on a
 *    six-entry list and 404'd three real documents, and `getLegalDocByKey`,
 *    which never had a caller.
 *  - `legalDocs` itself. Its `shortDescription` moved into the manifests, so a
 *    description travels with its document; its `title` was already there; and
 *    its `docKey` had no reader — `shared/legal-consent.ts` carries the two
 *    keys actually captured at signup. Six entries in this file were why
 *    `billing-terms`, `refund-policy` and `subscription-auto-renewal-notice`
 *    never appeared on the hub despite rendering at their own URLs.
 *
 * trade-offs:
 *  - Hub ORDER lives in the manifests too, as an integer. Presentation is not
 *    document content, so this is the one arguable field — but a tenth
 *    document has to be able to place itself, and any list here would be the
 *    hardcoded array this file just spent three phases shedding.
 *
 * edge cases:
 *  - `hasAccepted` compares a version string. Publishing a new version makes it
 *    false for everyone who accepted the old one, which is the intended effect:
 *    they are asked again.
 */
import { csrfFetch } from "./csrf";

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
