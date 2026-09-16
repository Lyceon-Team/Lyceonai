/**
 * @spec [LYCEON consent capture §6; owner ruling 2026-09-16 — re-consent is
 *        non-blocking for guardians]
 * @implemented 2026-09-16
 *
 * plain English: remembers, for this browser tab and this sign-in only, that a
 * guardian waved the re-consent prompt away. It exists so one dismissal lasts
 * the session instead of re-firing on every navigation.
 *
 * expected outcome: dismiss once, browse freely, and see the prompt again at the
 * next sign-in. Nothing here is a consent record and nothing here reaches the
 * server — `legal_acceptances` still knows only what was actually accepted.
 *
 * WHY sessionStorage AND a sign-out clear, rather than either alone.
 * sessionStorage is per-tab and dies with the tab, which covers "next sign-in"
 * for anyone who closes the browser. It does NOT die on sign-out, so signing out
 * and back in within the same tab would otherwise inherit the dismissal and skip
 * the prompt — `clearReconsentDismissal()` is called from the auth context's
 * sign-out path to close that. The per-user key is the third guard: a different
 * account in the same tab reads a different key and is prompted on its own terms.
 *
 * WHAT IS DELIBERATELY ABSENT: any "don't show this again". A control that
 * suppresses the prompt for good while recording no acceptance would tell a
 * person their choice was saved when the only thing saved is our silence.
 *
 * trade-offs / edge cases:
 *  - Storage can throw (private browsing, blocked site data) or come back empty.
 *    Every path falls back to NOT dismissed, so the failure mode is seeing the
 *    prompt again — never silently suppressing it.
 *  - Two tabs are two sessions, so dismissing in one still prompts in the other.
 *    Correct: each is its own surface, and the prompt is not an error to be
 *    deduplicated.
 */

const PREFIX = "lyceon.reconsent.dismissed.";

function key(userId: string): string {
  return `${PREFIX}${userId}`;
}

/**
 * Has this user dismissed the prompt in this tab-session?
 * Returns false whenever the answer cannot be read — the prompt is the safe
 * default, so an unreadable store shows it rather than hides it.
 */
export function isReconsentDismissed(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(key(userId)) === "1";
  } catch {
    // Not swallowed: an unreadable store is a definite "not dismissed". There is
    // nothing to recover and nothing to report — the caller shows the prompt,
    // which is exactly what we want when we cannot prove it was waved away.
    return false;
  }
}

/** Record the dismissal for this tab-session. Never throws into the UI. */
export function dismissReconsent(userId: string): void {
  try {
    window.sessionStorage.setItem(key(userId), "1");
  } catch {
    // A failed write means the prompt returns on the next navigation. Mildly
    // annoying, and strictly better than pretending it was remembered.
    return;
  }
}

/**
 * Forget every dismissal in this tab. Called from the auth context on sign-out
 * so the next sign-in is prompted, per the rule that the prompt returns until it
 * is accepted.
 */
export function clearReconsentDismissal(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (k !== null && k.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) window.sessionStorage.removeItem(k);
  } catch {
    // Nothing to clear if the store is unreachable; `isReconsentDismissed`
    // returns false on the same failure, so the prompt shows either way.
    return;
  }
}
