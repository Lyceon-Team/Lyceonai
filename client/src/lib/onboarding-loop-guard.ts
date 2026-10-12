/**
 * The onboarding-redirect loop guard (state only; the screen is
 * `components/auth/OnboardingLoopScreen.tsx`, kept apart so the query client can import this
 * without importing the auth context).
 *
 * @spec [hotfix 2026-10-11 (owner brief: "the client never redirects to /profile/complete when
 *        it's already there, or when it arrived from it less than a few seconds ago; if the
 *        check fails twice it shows an error screen with sign-out instead of reloading")]
 *        | @implemented [2026-10-11]
 *
 * plain English: the query client sends a 403 PROFILE_INCOMPLETE to /profile/complete. If the
 * client and server ever disagree about the profile again, that redirect and the completion
 * page's own "you're done, go back" redirect would chase each other. The guard lets the
 * redirect happen once; a second PROFILE_INCOMPLETE within `LOOP_WINDOW_MS` of it is the second
 * failed check, so instead of redirecting again the app shows one calm screen with Sign out.
 * Nothing reloads.
 *
 * trade-offs: module state, not storage. The redirect is now in-app (no reload), so the module
 * lives for the whole cycle; a manual reload starts fresh, which is the right reset. A completed
 * profile resets the guard (`resetOnboardingLoopGuard`, called by the completion page).
 */
/** "A few seconds": a disagreement re-fires within one round trip; a person takes longer. */
export const LOOP_WINDOW_MS = 5_000;

type GuardState = { lastRedirectAt: number | null; looping: boolean };

let state: GuardState = { lastRedirectAt: null, looping: false };
const listeners = new Set<() => void>();

function setState(next: GuardState): void {
  state = next;
  for (const l of listeners) l();
}

/**
 * Called for a PROFILE_INCOMPLETE refusal that is NOT already on /profile/complete.
 * `"redirect"`: go (and the window starts). `"blocked"`: this is the second failed check inside
 * the window — the screen is now showing; do not navigate.
 */
export function admitOnboardingRedirect(
  now: number = Date.now(),
): "redirect" | "blocked" {
  if (state.looping) return "blocked";
  if (
    state.lastRedirectAt !== null &&
    now - state.lastRedirectAt < LOOP_WINDOW_MS
  ) {
    setState({ ...state, looping: true });
    return "blocked";
  }
  setState({ lastRedirectAt: now, looping: false });
  return "redirect";
}

/** A completed profile (or a sign-out) ends any suspicion of a loop. */
export function resetOnboardingLoopGuard(): void {
  setState({ lastRedirectAt: null, looping: false });
}

/** For the screen (`components/auth/OnboardingLoopScreen.tsx`), via useSyncExternalStore. */
export function subscribeOnboardingLoop(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Is the guard showing its screen? */
export function isOnboardingLooping(): boolean {
  return state.looping;
}
