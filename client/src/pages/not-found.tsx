import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import { BareCardHeader } from "@/components/layout/BareCardShell";

/**
 * @spec [student-UI register UI-3A, UI-59; DESIGN.md §1 "Hierarchy" (one primary action), §2
 *        "Bare card" (404)] | @implemented [2026-10-03]
 *
 * plain English: the 404, inside the Bare card App.tsx wraps it in. The heading is the shipped
 * "404 Page Not Found". The way home is one filled link to /dashboard with the shipped words
 * "Back to dashboard": RequireRole sends each visitor on from there (a student stays, a guardian
 * goes to /guardian, a signed-out visitor to sign-in), so one target serves every role without
 * the page reading who is signed in. The shipped developer line ("Did you forget to add the page
 * to the router?") is gone: it spoke to developers, not students (owner question in UI-59).
 */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center" data-testid="not-found">
      <BareCardHeader title="404 Page Not Found" align="center" />
      <Link
        href="/dashboard"
        className={buttonVariants({
          variant: "lyc-primary",
          className: "no-underline",
        })}
        data-testid="not-found-home"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
