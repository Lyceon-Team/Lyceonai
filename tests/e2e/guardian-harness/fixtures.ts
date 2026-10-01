/**
 * The guardian surface's browser fixtures — printed as JSON for the Playwright specs.
 *
 * @spec [Guardian_Closure_Plan G4-07 (R12 font floor, visual check); Part D screenshots]
 * @implemented [2026-09-30]
 *
 * plain English: the SAME scenario the RTL tests use (`client/src/features/guardian/
 * test-harness.tsx`: Ada active, Bo lapsed; every payload through its shared schema or the
 * real projection), serialised so a browser test can serve it with `page.route`. One scenario,
 * shared (CLAUDE.md): a second hand-built fixture set for the browser would drift from it.
 *
 * run: `pnpm exec tsx tests/e2e/guardian-harness/fixtures.ts` (tsx resolves the tsconfig
 * path aliases the harness imports through).
 */
import {
  ADA,
  BO,
  CY,
  EXAM_SESSION,
  billingStatus,
  calendarWeek,
  examList,
  examReport,
  masteryDomains,
  roster,
} from "../../../client/src/features/guardian/test-harness";
import { billingPlansResponseSchema } from "../../../packages/shared/src/billing-schema";
import { studentCalendarWeek } from "../../../client/src/features/calendar/calendar-week.fixture";
import { browserLocalToday } from "../../../client/src/features/calendar/lib/dates";

const fixtures = {
  ADA,
  BO,
  CY,
  EXAM_SESSION,
  // Cy is on the roster but every per-student read answers 404: the revoked state.
  rosterWithRevoked: roster([
    { id: ADA, name: "Ada" },
    { id: BO, name: "Bo", lapsed: true },
    { id: CY, name: "Cy" },
  ]),
  roster: roster([
    { id: ADA, name: "Ada" },
    { id: BO, name: "Bo", lapsed: true },
  ]),
  // The real week (`calendar-week.fixture.ts`): the guardian's projection of it here, and the
  // student's own payload for the SAME week below — one range, two audiences.
  calendarWeek: calendarWeek(),
  studentCalendar: studentCalendarWeek(browserLocalToday()),
  masteryDomains: masteryDomains(),
  examList: examList(),
  examReport: examReport(),
  billingStatus: billingStatus(),
  // The plans the purchase card offers, through the shared schema. Amounts are illustrative:
  // the route reads them live from Stripe, and this is a layout check, not a price check.
  billingPlans: billingPlansResponseSchema.parse({
    plans: [
      {
        plan: "monthly",
        label: "Monthly",
        amountCents: 2999,
        currency: "usd",
        intervalLabel: "per month",
        interval: "month",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
      {
        plan: "quarterly",
        label: "Quarterly",
        amountCents: 7999,
        currency: "usd",
        intervalLabel: "per 3 months",
        interval: "month",
        intervalCount: 3,
        stripePriceIdConfigured: true,
      },
      {
        plan: "yearly",
        label: "Yearly",
        amountCents: 24999,
        currency: "usd",
        intervalLabel: "per year",
        interval: "year",
        intervalCount: 1,
        stripePriceIdConfigured: true,
      },
    ],
    requestId: "r",
  }),
};

process.stdout.write(JSON.stringify(fixtures));
