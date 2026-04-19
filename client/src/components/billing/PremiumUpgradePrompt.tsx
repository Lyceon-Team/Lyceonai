import { useState } from "react";
import { useLocation } from "wouter";
import { X, Sparkles, CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { openBillingPortal } from "@/lib/billing-client";

export type PremiumPromptReason =
  | "premium_required"
  | "payment_required"
  | "payment_past_due"
  | "subscription_canceled"
  | "subscription_expired";

export type PremiumUpgradePromptProps = {
  reason: PremiumPromptReason;
  mode?: "floating" | "inline";
  onDismiss?: () => void;
};

function reasonCopy(reason: PremiumPromptReason): {
  title: string;
  description: string;
  ctaLabel: string;
  ctaKind: "plans" | "billing";
} {
  switch (reason) {
    case "payment_past_due":
      return {
        title: "Payment update needed",
        description: "Your subscription payment needs attention before premium access can continue.",
        ctaLabel: "Manage billing",
        ctaKind: "billing",
      };
    case "subscription_canceled":
      return {
        title: "Subscription ended",
        description: "Restart your subscription to unlock premium features again.",
        ctaLabel: "View plans",
        ctaKind: "plans",
      };
    case "subscription_expired":
      return {
        title: "Subscription expired",
        description: "Renew your subscription to restore premium access.",
        ctaLabel: "View plans",
        ctaKind: "plans",
      };
    case "payment_required":
      return {
        title: "Subscription required",
        description: "Choose a plan to unlock this premium feature.",
        ctaLabel: "View plans",
        ctaKind: "plans",
      };
    case "premium_required":
    default:
      return {
        title: "Premium required",
        description: "This feature is available on an active premium plan.",
        ctaLabel: "View plans",
        ctaKind: "plans",
      };
  }
}

export function PremiumUpgradePrompt({
  reason,
  mode = "inline",
  onDismiss,
}: PremiumUpgradePromptProps) {
  const [, navigate] = useLocation();
  const [portalPending, setPortalPending] = useState(false);
  const copy = reasonCopy(reason);

  const handlePrimaryAction = async () => {
    if (copy.ctaKind === "plans") {
      navigate("/upgrade");
      return;
    }

    setPortalPending(true);
    try {
      await openBillingPortal();
    } finally {
      setPortalPending(false);
    }
  };

  return (
    <Card
      className={mode === "floating"
        ? "fixed right-4 bottom-4 z-50 w-[min(440px,calc(100vw-2rem))] border-primary/30 shadow-lg"
        : "border-primary/30 bg-card"}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {copy.title}
            </CardTitle>
            <CardDescription className="mt-1">{copy.description}</CardDescription>
          </div>
          {mode === "floating" && onDismiss && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss upgrade prompt"
              onClick={onDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <Button onClick={() => void handlePrimaryAction()} disabled={portalPending}>
          <CreditCard className="h-4 w-4 mr-2" />
          {portalPending ? "Opening billing..." : copy.ctaLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

