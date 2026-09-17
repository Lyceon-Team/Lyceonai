import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MailWarning } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { apiRequestRaw } from "@/lib/queryClient";

/**
 * @spec [SCL-090 PROPOSED as ruled 2026-09-17 ("keep the suppression, surface it, one click to
 *        clear"); owner follow-up 2026-09-17 "Replace Bespoke Suppression With Resend's" §4;
 *        contracts/notifications.contract.md §11A.4-§11A.6; lyceon-coding-standards §11.1
 *        business logic out of components, §11.2 server state via the query layer, §11.3 no
 *        client-side privilege] | @implemented [2026-09-17]
 *
 * plain English: the only place in the product that can tell somebody why their email went
 * quiet. A do-not-contact request outlives the account it was made from, and the provider
 * applies it to ALL mail — password resets included — so a student who deleted with suppression
 * and later signed up again has a working account that receives nothing, including the reset
 * link they would reach for when they cannot get in. This card says so in plain words and gives
 * them one button to turn it back on.
 *
 * WHAT IT DOES NOT DO. It does not clear anything by itself, and nothing clears on
 * re-registration: signing up again is not unambiguous consent to be contacted, and the original
 * request may have come from a parent. The clearing is an explicit act, recorded server-side as
 * affirmative re-consent.
 *
 * RENDERS NOTHING in the ordinary case — no suppression, still loading, or the provider could not
 * be asked (the route answers 503 and this stays hidden). An informational panel that cannot
 * establish its fact is worse than absent: it would tell people their mail is fine when it may
 * not be. The server is the only authority here; there is no client-held state to trust.
 */

const SUPPRESSION_QUERY_KEY = ["/api/account/email-suppression"] as const;

type SuppressionState = {
  ok: boolean;
  suppressed: boolean;
  origin: "bounce" | "complaint" | "manual" | null;
  clearable: boolean;
};

export function EmailNotificationsCard() {
  const queryClient = useQueryClient();

  const { data } = useQuery<SuppressionState>({
    queryKey: SUPPRESSION_QUERY_KEY,
    retry: false,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequestRaw("/api/account/email-suppression/clear", {
        method: "POST",
      });
      if (!res.ok) throw new Error(String(res.status));
    },
    onSuccess: () => {
      toast({
        title: "Email turned back on",
        description:
          "We've recorded that you asked us to contact you again. Password resets and account emails will reach you from now on.",
      });
      void queryClient.invalidateQueries({ queryKey: SUPPRESSION_QUERY_KEY });
    },
    onError: () => {
      toast({
        title: "Could not turn email back on",
        description:
          "Something went wrong at our email provider. Please try again, or contact support if it keeps happening.",
        variant: "destructive",
      });
    },
  });

  if (!data?.suppressed) return null;

  // A bounce or a complaint is not a do-not-contact request, so it is not this card's to lift —
  // and saying "because of a previous request" would be false. Report it honestly instead.
  if (!data.clearable) {
    return (
      <Alert data-testid="alert-email-suppressed-unclearable">
        <MailWarning className="h-4 w-4" />
        <AlertDescription>
          We are not able to send email to your address at the moment, because
          earlier messages could not be delivered. Please contact support so we
          can look into it — this is not something you can change here.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert data-testid="alert-email-suppressed">
      <MailWarning className="h-4 w-4" />
      <AlertDescription className="space-y-3">
        <p>
          Email to your address is turned off because of an earlier request to
          stop contacting you. That request still applies, so nothing reaches
          you — <strong>including password reset links</strong>.
        </p>
        <Button
          size="sm"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          data-testid="button-clear-email-suppression"
        >
          {clearMutation.isPending
            ? "Turning email back on…"
            : "Turn email back on"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
