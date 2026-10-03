import { useEffect, useState } from "react";
import { Link } from "wouter";
import { LYC_INLINE_LINK, buttonVariants } from "@/components/ui/button";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { apiRequestRaw } from "@/lib/queryClient";
import { SUPPORT_EMAIL } from "@/lib/support-contact";

/**
 * @spec [Doc-01_V8 §40.4 recovery during grace] | @implemented 2026-06-21
 * plain English: the landing page for the recovery link in the deletion email. It reads the one-time
 * token from the URL and POSTs it to /api/account/recover-deletion (unauthenticated, capability-gated
 * by the token — no session needed, so a soft-locked user can recover). Distinguishes restored vs the
 * EMAIL_RECLAIMED (409, email re-registered during grace) vs invalid/expired token. Without this page
 * the email's cancel link 404s and the §40.4 7-day recovery isn't user-reachable.
 *
 * @spec [student-UI register UI-3A, UI-59; DESIGN.md §1, §2 "Bare card"] | @implemented [2026-10-03]
 * UI-59: drawn with the student tokens only, inside the Bare card. Copy and behaviour unchanged.
 * "Sign in" was a Button inside a Link (a button nested in an anchor); it is now the Link itself,
 * drawn as the filled primary. The support address is a real inline link, so it is underlined.
 */
const BODY = "m-0 text-lyc-body text-lyc-ink";
/** A real inline link inside the sentence (`LYC_INLINE_LINK`). */
const SUPPORT_LINK = LYC_INLINE_LINK;
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

  const support = (
    <a className={SUPPORT_LINK} href={`mailto:${SUPPORT_EMAIL}`}>
      {SUPPORT_EMAIL}
    </a>
  );

  return (
    <div
      className="flex flex-col items-center text-center"
      data-testid="account-recover"
      data-state={state}
    >
      {state === "loading" && (
        <BareCardHeader
          title="Restoring your account…"
          description="One moment while we cancel the scheduled deletion."
          align="center"
        />
      )}

      {state === "success" && (
        <>
          <BareCardHeader
            title="Your account is restored"
            description="The scheduled deletion has been cancelled. You can sign in and pick up where you left off."
            align="center"
          />
          <Link
            href="/login"
            className={buttonVariants({
              variant: "lyc-primary",
              className: "w-full no-underline",
            })}
            data-testid="recover-signin"
          >
            Sign in
          </Link>
        </>
      )}

      {state === "reclaimed" && (
        <>
          <BareCardHeader
            title="We couldn't restore your account automatically"
            align="center"
          />
          <p className={BODY}>
            Your email address is no longer available, so we couldn't reactivate
            this account. Please contact {support} and we'll help you recover
            it.
          </p>
        </>
      )}

      {state === "invalid" && (
        <>
          <BareCardHeader
            title="This recovery link is invalid or expired"
            align="center"
          />
          <p className={BODY}>
            The link may have already been used, or the recovery window has
            passed. If you still need help, contact {support}.
          </p>
        </>
      )}

      {state === "error" && (
        <>
          <BareCardHeader title="Something went wrong" align="center" />
          <p className={BODY}>
            We couldn't process this recovery link. Please try again, or contact{" "}
            {support}.
          </p>
        </>
      )}
    </div>
  );
}
