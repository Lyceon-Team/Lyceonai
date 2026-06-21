import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { apiRequestRaw } from "@/lib/queryClient";
import { SUPPORT_EMAIL } from "@/lib/support-contact";

/**
 * @spec [Doc-01_V8 §40.4 recovery during grace] | @implemented 2026-06-21
 * plain English: the landing page for the recovery link in the deletion email. It reads the one-time
 * token from the URL and POSTs it to /api/account/recover-deletion (unauthenticated, capability-gated
 * by the token — no session needed, so a soft-locked user can recover). Distinguishes restored vs the
 * EMAIL_RECLAIMED (409, email re-registered during grace) vs invalid/expired token. Without this page
 * the email's cancel link 404s and the §40.4 7-day recovery isn't user-reachable.
 */
type RecoverState = "loading" | "success" | "invalid" | "reclaimed" | "error";

export default function AccountRecover() {
  const [state, setState] = useState<RecoverState>("loading");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("invalid");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiRequestRaw("/api/account/recover-deletion", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        if (res.ok) setState("success");
        else if (res.status === 409) setState("reclaimed");
        else if (res.status === 404 || res.status === 400) setState("invalid");
        else setState("error");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#EAF0FF] to-white p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 space-y-5 text-center">
        {state === "loading" && (
          <>
            <h1 className="text-2xl font-semibold text-neutral-800">
              Restoring your account…
            </h1>
            <p className="text-sm text-neutral-600">
              One moment while we cancel the scheduled deletion.
            </p>
          </>
        )}

        {state === "success" && (
          <>
            <h1 className="text-2xl font-semibold text-neutral-800">
              Your account is restored
            </h1>
            <p className="text-sm text-neutral-600">
              The scheduled deletion has been cancelled. You can sign in and
              pick up where you left off.
            </p>
            <Link href="/login">
              <Button className="w-full" data-testid="recover-signin">
                Sign in
              </Button>
            </Link>
          </>
        )}

        {state === "reclaimed" && (
          <>
            <h1 className="text-2xl font-semibold text-neutral-800">
              We couldn't restore your account automatically
            </h1>
            <p className="text-sm text-neutral-600">
              Your email address is no longer available, so we couldn't
              reactivate this account. Please contact{" "}
              <a
                className="font-medium text-blue-600"
                href={`mailto:${SUPPORT_EMAIL}`}
              >
                {SUPPORT_EMAIL}
              </a>{" "}
              and we'll help you recover it.
            </p>
          </>
        )}

        {state === "invalid" && (
          <>
            <h1 className="text-2xl font-semibold text-neutral-800">
              This recovery link is invalid or expired
            </h1>
            <p className="text-sm text-neutral-600">
              The link may have already been used, or the recovery window has
              passed. If you still need help, contact{" "}
              <a
                className="font-medium text-blue-600"
                href={`mailto:${SUPPORT_EMAIL}`}
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </>
        )}

        {state === "error" && (
          <>
            <h1 className="text-2xl font-semibold text-neutral-800">
              Something went wrong
            </h1>
            <p className="text-sm text-neutral-600">
              We couldn't process this recovery link. Please try again, or
              contact{" "}
              <a
                className="font-medium text-blue-600"
                href={`mailto:${SUPPORT_EMAIL}`}
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
