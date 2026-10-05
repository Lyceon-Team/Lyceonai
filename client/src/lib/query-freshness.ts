/**
 * @spec [Coding Standards §11.2 (server state via the query layer); Doc_05F §17.7
 *        (calendar refetches on window focus, no polling); student-ui register UI-14]
 * @implemented [2026-09-29]
 *
 * plain English: how long each kind of server data may be served from the React Query cache
 * before it is re-read, in ONE place. Expected outcome: a query states which data type it is
 * (`QUERY_FRESHNESS.profile`, `.billingStatus`, ...) instead of carrying a bare number, and the
 * app-wide default (`staleTime: Infinity` in `queryClient.ts`) is only what applies to data that
 * has not been classified here.
 *
 * WHY NOT JUST CHANGE THE DEFAULT. `Infinity` is right for the question bank and for anything
 * a student cannot change from another tab; it is wrong for account facts that DO change
 * elsewhere (a checkout completing in Stripe, a profile completed in another tab). Shortening
 * the default would re-read the question bank on every mount; so the data that changes opts
 * into a short window here, and the data that does not says so explicitly.
 *
 * Trade-offs: a short window is a ceiling on staleness, not a polling interval — nothing here
 * refetches on a timer (the KPI entry's 60 s interval was removed 2026-10-01). Mutations that change one of
 * these resources still invalidate it (profile completion invalidates the profile key), so the
 * window only bounds changes made OUTSIDE this tab.
 *
 * Edge cases: the account-fact windows are not zero because every consumer of the profile
 * mounts just after the auth provider's own read, and a zero window would turn one request into
 * one per consumer — the defect UI-14 closes. The single exception is the auth provider's own
 * read (sign-in, sign-up, `refreshUser`), which overrides to 0 at its call site because it
 * exists to learn what the server says now.
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

export const QUERY_FRESHNESS = {
  /**
   * `GET /api/profile` — role, onboarding flags, outstanding legal documents, pending deletion.
   * Changes when the student completes onboarding (invalidated by that mutation), accepts a
   * re-consent (invalidated by `ReconsentModal`), or acts in another tab. 30 s bounds the last.
   */
  profile: { staleTime: 30 * SECOND_MS },

  /**
   * `GET /api/billing/status` — entitlement as the server derives it. Changes when a Stripe
   * webhook lands, which is never in this tab, so a short window is the only way a returning
   * student sees it without a reload. The checkout-return poller overrides the interval while
   * it is waiting, and only then.
   */
  billingStatus: { staleTime: 30 * SECOND_MS },

  /**
   * `GET /api/practice/topics` — the published domain/skill taxonomy. Changes with a question
   * bank release, not with anything a student does. An hour is long and still bounded.
   */
  taxonomy: { staleTime: HOUR_MS },

  /**
   * `GET /api/billing/plans` — live prices from Stripe. Changes when the owner reprices, which
   * is rare and not time-critical within a session.
   */
  pricing: { staleTime: HOUR_MS },

  /**
   * `GET /api/progress/kpis` (`useProgressKpis`). No timer (owner ruling 2026-10-01): refetch on
   * window focus, and on session completion through `invalidateProgressKpis`. KPIs only move when
   * the student answers questions. It replaced a 60 s interval that cost every open dashboard 60
   * requests an hour. The window only stops a focus event from re-reading a fresh copy.
   */
  kpis: { staleTime: 30 * SECOND_MS, refetchOnWindowFocus: true },

  /**
   * `GET /api/calendar` (range reads, guardian projection, adjacent-range prefetch). Doc 05F
   * §17.7: refetch on window focus, no polling. The window only stops a focus event from
   * re-reading a range read seconds ago.
   */
  calendarRange: { staleTime: 30 * SECOND_MS, refetchOnWindowFocus: true },

  /**
   * `GET /api/practice/quota` (OQ-21; UI-50). The count moves with every practice question the
   * student answers or skips (OQ-50), which happens on another page of this tab, so a page
   * showing the quota reads it
   * afresh each time it mounts rather than showing the morning's figure.
   */
  practiceQuota: { staleTime: 0 },
} as const;

export type QueryFreshnessKind = keyof typeof QUERY_FRESHNESS;
