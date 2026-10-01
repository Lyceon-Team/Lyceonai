/**
 * @spec [Guardian_Closure_Plan G2-02; audit G-AUD-23; Coding Standards §11.3] | @implemented [2026-09-29]
 *
 * plain English: what an account the application does not recognise sees. The server refuses
 * the session (403 `ROLE_UNRECOGNIZED`); this screen says so in neutral words, names no role and
 * nothing about the account, and offers sign-out and the support address. It is deliberately not
 * a redirect to /login: the next sign-in would be refused the same way and loop back here.
 */
import { Button } from "@/components/ui/button";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { SUPPORT_EMAIL } from "@/lib/support-contact";

export function AccountUnavailable() {
  const { signOut } = useSupabaseAuth();
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background p-6"
      data-testid="account-unavailable"
    >
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold">This account can't be opened</h1>
        <p className="text-muted-foreground">
          Something about this account needs our help before it can be used.
          Please contact{" "}
          <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
