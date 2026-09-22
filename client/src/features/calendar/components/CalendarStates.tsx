/**
 * @spec [Doc_05F_Study_Calendar, §17.5 states, §16 entitlement]
 * @implemented [2026-09-23]
 *
 * plain English: the screens the calendar shows when it is not showing a plan — loading,
 * entitlement-denied, error. Expected outcome: never a blank page and never a spinner that
 * does not end.
 *
 * THE 402 IS A STATE, NOT AN ERROR. §16 makes the calendar premium for the SUBJECT, and a
 * free student opening it is the ordinary case, not a failure. It renders the existing
 * `PremiumUpgradePrompt` — the shared component, not a second upgrade card — which is why
 * this module classifies the error rather than rendering a generic message.
 *
 * edge cases: the skeleton mirrors the REGIONS of the real layout (rail, top bar, grid) so
 * the page does not reflow when the data lands. A centred spinner would be less work and
 * would make every load feel like a jump.
 */
import { PremiumUpgradePrompt } from "@/components/billing/PremiumUpgradePrompt";
import { isApiError } from "@/lib/api-error";

/** True when this error is an entitlement denial rather than a fault. */
export function isEntitlementDenial(error: unknown): boolean {
  return isApiError(error) && error.status === 402;
}

export function CalendarSkeleton(): JSX.Element {
  return (
    <div className="app" data-testid="calendar-skeleton" aria-busy="true">
      <aside className="rail">
        <div className="brand">
          <i aria-hidden="true" /> Lyceon
        </div>
        <div className="who" style={{ height: 52 }} />
        <div className="mini" style={{ height: 180 }} />
      </aside>
      <div className="main">
        <div className="top">
          <div className="range" style={{ opacity: 0.3 }}>
            Loading your plan…
          </div>
        </div>
        <div className="scroll">
          <div className="week">
            {Array.from({ length: 7 }, (_, index) => (
              <div className="col" key={index}>
                <div className="dayhead">
                  <div className="dow" style={{ opacity: 0.25 }}>
                    ···
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * §17.5: "error (inline retry, never a blank page)". The message is the one the API gave
 * when it gave one, because "Something went wrong" tells a student nothing about whether to
 * try again.
 */
export function CalendarError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}): JSX.Element {
  const message =
    isApiError(error) && error.message.length > 0
      ? error.message
      : "We couldn't load your calendar.";
  return (
    <div className="app" data-testid="calendar-error">
      <div className="main" style={{ gridColumn: "1 / -1", padding: 32 }}>
        <h3
          style={{
            fontFamily: "'Bricolage Grotesque'",
            fontSize: 21,
            margin: "0 0 8px",
          }}
        >
          We couldn&apos;t load your calendar
        </h3>
        <p style={{ color: "var(--muted)", marginTop: 0 }} role="alert">
          {message}
        </p>
        <button type="button" className="btn primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

/** §16 + §17.5: the premium CTA, using the shared component the rest of the app uses. */
export function CalendarPremiumGate(): JSX.Element {
  return (
    <div className="app" data-testid="calendar-premium-gate">
      <div className="main" style={{ gridColumn: "1 / -1", padding: 32 }}>
        <PremiumUpgradePrompt featureBenefit="your study calendar" />
      </div>
    </div>
  );
}

/**
 * §17.5's guardian pre-setup state. A guardian cannot run setup (§16 gives them no write
 * path), so this says what is true and offers nothing — a setup sheet here would be a
 * control that cannot work.
 */
export function GuardianNotSetUp(): JSX.Element {
  return (
    <div className="app" data-testid="calendar-guardian-not-set-up">
      <div className="main" style={{ gridColumn: "1 / -1", padding: 32 }}>
        <h3
          style={{
            fontFamily: "'Bricolage Grotesque'",
            fontSize: 21,
            margin: "0 0 8px",
          }}
        >
          Not set up yet
        </h3>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          There&apos;s no study calendar to show yet. It will appear here once
          it has been set up.
        </p>
      </div>
    </div>
  );
}
