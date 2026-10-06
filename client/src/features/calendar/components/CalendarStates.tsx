/**
 * @spec [Doc_05F_Study_Calendar, §17.5 states, §16 entitlement; student-UI register UI-55,
 *        §2 entitlement denial contract (SCL-185: key on the code, never the status)]
 * @implemented [2026-09-23; UI-55 2026-10-03]
 *
 * plain English: the screens the calendar shows when it is not showing a plan — loading,
 * error — and the one question the student page asks of a refused read: was it the calendar's
 * entitlement denial? Expected outcome: never a blank page and never a spinner that does not
 * end.
 *
 * THE 402 IS A STATE, NOT AN ERROR. §16 makes the calendar premium for the SUBJECT, and a
 * free student opening it is the ordinary case, not a failure. Since UI-55 the student page
 * answers it with the free calendar (`FreeCalendar.tsx`: the inline setup form and the plan
 * upsell card, DESIGN.md §4), which replaced the shared premium prompt that stood here.
 *
 * The guardian's own states (not set up, no longer linked, lapsed) moved to
 * `features/guardian/GuardianStates.tsx` in G4-06, where every guardian surface shares them
 * and they name the student. The guardian loading skeleton (`CalendarSkeleton`) stays here;
 * the student's (`StudentCalendarSkeleton`) mirrors the App-shell layout instead.
 *
 * edge cases: the skeletons mirror the REGIONS of the real layout so the page does not
 * reflow when the data lands. A centred spinner would be less work and would make every load
 * feel like a jump.
 */
import { getEntitlementDenial, isApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * True when this error is the calendar's paid-feature denial. Keyed on the denial's code and
 * feature through the one canonical reader (register §2, SCL-185: "The upgrade modal keys off
 * the code, never the status"; wiring table §9: "client must key on the code"), so another 402
 * — or a 402 without the calendar's `details.feature` — is a fault, not an upsell.
 */
export function isEntitlementDenial(error: unknown): boolean {
  return getEntitlementDenial(error)?.feature === "calendar_access";
}

/** The student page while its reads resolve: the header, seven columns, and nothing else. */
export function StudentCalendarSkeleton(): JSX.Element {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="calendar-skeleton"
      aria-busy="true"
    >
      <div className="flex shrink-0 items-center justify-center border-b border-lyc-rule px-4 py-5 lg:px-7">
        <Skeleton variant="lyc" className="h-8 w-48" />
      </div>
      <div className="grid flex-1 grid-cols-1 gap-3 p-4 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton
            key={index}
            variant="lyc"
            className={`h-40 w-full${index > 0 ? " hidden lg:block" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

/** `hideBrand`: as `LeftRail`'s — the guardian's skeleton sits under a shell with the logo. */
export function CalendarSkeleton({
  hideBrand = false,
}: { hideBrand?: boolean } = {}): JSX.Element {
  return (
    <div className="app" data-testid="calendar-skeleton" aria-busy="true">
      <aside className="rail">
        {hideBrand ? null : (
          <div className="brand">
            <i aria-hidden="true" /> Lyceon
          </div>
        )}
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
 * try again. Student only (the guardian has `GuardianStates`), so it draws with the student
 * tokens (UI-55).
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
    <div
      className="flex flex-col items-start gap-3 px-4 py-8 lg:px-14 lg:py-12"
      data-testid="calendar-error"
    >
      <h1 className="m-0 font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong">
        We couldn&apos;t load your calendar
      </h1>
      <p className="m-0 text-lyc-body text-lyc-muted" role="alert">
        {message}
      </p>
      <Button type="button" variant="lyc-primary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
