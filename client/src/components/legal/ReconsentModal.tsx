/**
 * @spec [LYCEON consent capture §6, §7; Coding Standards §11.1, §11.3;
 *        owner ruling 2026-09-16 — non-blocking for guardians]
 * @implemented 2026-09-16
 *
 * plain English: a prompt shown when a person holds an out-of-date acceptance of
 * a document they are required to hold. It names the documents, links each one,
 * and offers to record the acceptance.
 *
 * expected outcome: they agree once, fresh records are written at the current
 * version, and the prompt does not return. The old records are untouched.
 *
 * ALWAYS DISMISSIBLE, FOR EVERY ROLE. Owner ruling 2026-09-16. Escape, the
 * backdrop, a close control and "Not now" all close it, and the page behind it
 * is live the whole time — the caller renders `children` unconditionally.
 *
 * There was a `dismissible` prop and a blocking mode behind it. Both are gone,
 * not defaulted: a flag that is always one value is a second thing to get wrong,
 * and the wall it selected is the defect this removes. Consent is captured where
 * it is GIVEN — signup, guardian link redemption, checkout — each part of an
 * action the person chose to take. A periodic prompt is not one of those, so it
 * asks and does not insist.
 *
 * DISMISSING RECORDS NOTHING. No row, no partial state, no "don't show again".
 * The dismissal lives in sessionStorage for this tab only and is cleared on
 * sign-out, so the prompt returns at the next sign-in and keeps returning until
 * it is accepted. A control that suppressed it for good while writing nothing
 * would tell a person their choice was saved when the only thing saved is our
 * silence.
 *
 * NO CONTRACT TEXT LIVES HERE. Titles come from the manifest by way of the
 * server, and each document is a LINK to /legal/:slug. A summary of what
 * changed, written in this component, would be a tenth copy of nine documents
 * and would drift from all of them.
 *
 * trade-offs / edge cases:
 *  - The version a person previously accepted is shown when there is one, and
 *    the row simply reads "not previously accepted" when there is not. Both are
 *    true statements; inventing a version for the second case would not be.
 *  - A failed write leaves the prompt open with the error visible, in BOTH
 *    modes. Closing on failure would claim an acceptance that did not happen.
 *  - `aria-modal` stays true: it is still a dialog while it is open and a
 *    screen reader should treat it as one. Being closeable does not stop it
 *    being a dialog.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/csrf";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, FileText, X } from "lucide-react";
import type { OutstandingLegalDoc } from "@shared/legal-consent";

function formatEffectiveDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ReconsentModal({
  documents,
  onDismiss,
}: {
  documents: OutstandingLegalDoc[];
  /** Called when the person waves it away. Records nothing. */
  onDismiss: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Escape closes it, for everyone. It used to be gated on `dismissible`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const accept = useMutation({
    mutationFn: async () => {
      // No body. The server recomputes which documents and which versions —
      // a client that named them would be asserting what it was shown.
      const res = await csrfFetch("/api/legal/reaccept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || data?.success !== true) {
        throw new Error(data?.error || "Could not record your agreement");
      }
      return data;
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Something went wrong");
    },
  });

  if (documents.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reconsent-title"
      data-testid="reconsent-modal"
      data-dismissible="true"
      onClick={(e) => {
        // The target guard is what keeps a click INSIDE the card from closing
        // it — without it, clicking a document link would dismiss on the way out.
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="relative w-full max-w-lg rounded-lg bg-background p-6 shadow-xl">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss for now"
          data-testid="reconsent-dismiss"
          className="absolute right-4 top-4 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <h2
          id="reconsent-title"
          className="text-xl font-semibold text-foreground"
        >
          We&rsquo;ve updated our terms
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {documents.length === 1
            ? "One of the documents you agreed to has a new version. Please review it to continue."
            : "Some of the documents you agreed to have new versions. Please review them to continue."}
        </p>

        <ul className="mt-5 space-y-3">
          {documents.map((doc) => (
            <li
              key={doc.slug}
              className="rounded-md border border-border/70 p-3"
              data-testid={`reconsent-doc-${doc.slug}`}
            >
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <a
                    href={`/legal/${doc.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    {doc.title}
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Version {doc.version} · Effective{" "}
                    {formatEffectiveDate(doc.effectiveDate)}
                    {doc.acceptedVersion
                      ? ` · you accepted ${doc.acceptedVersion}`
                      : " · not previously accepted"}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <Alert className="mt-4 border-destructive/40">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <AlertDescription data-testid="reconsent-error">
              {error}
            </AlertDescription>
          </Alert>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            onClick={() => accept.mutate()}
            disabled={accept.isPending}
            data-testid="reconsent-accept"
            className="sm:flex-1"
          >
            {accept.isPending ? "Saving…" : "I agree to the updated terms"}
          </Button>
          <Button
            variant="outline"
            onClick={onDismiss}
            data-testid="reconsent-not-now"
            className="sm:flex-1"
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ReconsentModal;
