/**
 * @spec [hotfix 2026-10-11: the loop guard's error screen (sign-out instead of another reload)]
 * | @implemented [2026-10-11]
 * plain English: see `lib/onboarding-loop-guard.ts`. Mounted once at the app root.
 */
import { useState, useSyncExternalStore } from "react";
import { navigate } from "wouter/use-browser-location";
import { Button } from "@/components/ui/button";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  isOnboardingLooping,
  resetOnboardingLoopGuard,
  subscribeOnboardingLoop,
} from "@/lib/onboarding-loop-guard";

/**
 * The screen the guard shows instead of a third redirect. Mounted once, at the app root; renders
 * nothing until the guard trips.
 */
export function OnboardingLoopScreen(): JSX.Element | null {
  const looping = useSyncExternalStore(
    subscribeOnboardingLoop,
    isOnboardingLooping,
    () => false,
  );
  const { signOut } = useSupabaseAuth();
  const [signOutFailed, setSignOutFailed] = useState(false);
  if (!looping) return null;

  async function onSignOut(): Promise<void> {
    setSignOutFailed(false);
    try {
      await signOut();
    } catch {
      // Shown, not swallowed: the message appears and the button stays, so they can retry.
      setSignOutFailed(true);
      return;
    }
    resetOnboardingLoopGuard();
    navigate("/login", { replace: true });
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="onboarding-loop-h"
      aria-modal="true"
      data-testid="onboarding-loop-screen"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-lyc-paper px-4"
    >
      <div className="flex w-full max-w-[440px] flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet p-7">
        <h1
          id="onboarding-loop-h"
          className="m-0 font-lyc-serif text-[26px] font-semibold text-lyc-ink-strong"
        >
          We couldn&apos;t open your account
        </h1>
        <p className="m-0 text-[17px] leading-relaxed text-lyc-ink">
          Something went wrong checking your profile. Sign out and sign back in.
          If this keeps happening, contact support.
        </p>
        {signOutFailed ? (
          <p className="m-0 text-[15px] text-lyc-muted" role="alert">
            Sign-out didn&apos;t go through. Please try again.
          </p>
        ) : null}
        <Button
          variant="lyc-primary"
          size="lyc-lg"
          className="self-start"
          onClick={() => void onSignOut()}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
