/**
 * /parent — the public page for parents and guardians.
 *
 * @spec [owner brief "Build: /parent page + card-first parent onboarding" (Karl, 2026-11-22),
 *       Part 1, and its approved prototype (copy verbatim, US English; section order and layout);
 *       owner rulings 2026-11-22: (1) a full prerendered, indexable public page, not a redirect,
 *       (2) card first, charged when the teen joins, (3) Karl approves every claim on the page
 *       (docs/compliance/claim-inventory.md, P-rows); Doc 09 §1.4, §5.1 Stripe canonical for
 *       prices; Public Disclosure Doctrine rules 1, 2, 5] | @implemented [2026-11-22]
 *
 * plain English: one page that tells a parent what they will see, how card-first sign-up works
 * and what it costs, with a call booking for anyone unsure. Every control reads an existing
 * source and nothing is restated here:
 *   - Sign up (header, hero, final)  → GUARDIAN_SIGNUP_HREF
 *   - Sign in                        → SIGN_IN_HREF (the existing sign-in link, via HomeNav)
 *   - Book a call (hero, call band)  → PARENT_CALL_URL, a plain new-tab link (ruling 8)
 *   - Prices                         → GET /api/public/pricing/plans, live from Stripe
 *   - Sample card "Test day"         → the shared SAT test-date module
 *   - Footer                         → the existing public footer (PublicLayout)
 *
 * Expected outcome: the prerendered HTML carries the whole page except the prices, which load
 * on the client (a skeleton until then, and no tiles at all if they fail), so a build never
 * bakes a stale number into static HTML.
 *
 * Edge cases: the sample card's test day is computed at render. A prerender built before an SAT
 * date and visited after it shows the build-time date until hydration replaces it with the next
 * one; React recovers from that text difference by re-rendering on the client. If the shared
 * list ever runs out of future dates, the line is left out rather than showing a past date.
 * The yearly saving is rounded down and is left out when it cannot be computed from live prices.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import PublicLayout from "@/components/layout/PublicLayout";
import { HomeNav } from "@/components/marketing/HomeNav";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { FREE_DAILY_PRACTICE_QUESTIONS } from "@/lib/free-tier";
import { GUARDIAN_SIGNUP_HREF } from "@/lib/marketing-links";
import {
  formatPlanAmount,
  getPublicPlanPrices,
  yearlySavings,
} from "@/lib/public-pricing";
import { PARENT_FAQS, faqParagraphs } from "@shared/seo/faqs";
import {
  chicagoToday,
  formatSatTestDate,
  offeredSatTestDates,
} from "@shared/sat-test-dates";
import {
  PARENT_CALL_HERO_LABEL,
  PARENT_CALL_LABEL,
  PARENT_CALL_URL,
} from "@lyceon/shared/external-links";
import type { PublicPlanPrice } from "../../../packages/shared/src/billing-schema";

/** The query key for the plan list, exported so the test asserts the page reads the API. */
export const PARENT_PLAN_PRICES_QUERY_KEY = [
  "/api/public/pricing/plans",
] as const;

const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-foreground px-6 py-3.5 text-base font-semibold text-background no-underline transition-opacity hover:opacity-90 sm:text-[17px]";
const OUTLINE_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-6 py-3.5 text-base font-semibold text-foreground no-underline transition-colors hover:bg-card sm:text-[17px]";
const WRAP = "mx-auto flex max-w-[1120px] flex-col px-4 sm:px-6";
const CARD = "rounded-2xl border border-border";
const H2 = "text-3xl font-bold leading-tight sm:text-4xl";

/** Static illustration: sample data, captioned as such on the page. */
const SAMPLE_DOMAINS = [
  { name: "Algebra", label: "Strong", pct: 82 },
  { name: "Advanced Math", label: "Building", pct: 58 },
  { name: "Craft and Structure", label: "Strong", pct: 76 },
  { name: "Standard English Conventions", label: "Needs work", pct: 41 },
] as const;

const WHAT_YOU_SEE = [
  {
    title: "Projected score range",
    body: "Where they would likely score today, and how the range tightens as they practice.",
  },
  {
    title: "Target and test date",
    body: "The score they are aiming for and the days left until test day.",
  },
  {
    title: "Mastery by area",
    body: "How they are doing across the SAT’s Math and Reading & Writing areas, so you know what needs work.",
  },
  {
    title: "Study calendar",
    body: "The sessions they planned and the ones they actually did, week by week.",
  },
  {
    title: "Practice test results",
    body: "Scores from full-length practice tests, taken under real timing.",
  },
] as const;

const STEPS = [
  {
    title: "Sign up as a parent",
    body: "Takes a minute with Google or email.",
  },
  {
    title: "Pick a plan and add your card",
    body: "Your card is saved securely with Stripe. Nothing is charged yet.",
  },
  {
    title: "Invite your teen",
    body: "Send an email invite, or copy the link and text it to them.",
  },
  {
    title: "Your teen joins",
    body: "You’re linked, your card is charged, and Pro turns on for them right away.",
  },
] as const;

const FREE_FEATURES = [
  "Diagnostic test with a projected score",
  `${FREE_DAILY_PRACTICE_QUESTIONS} practice questions a day`,
  "Review of missed questions",
] as const;

const PRO_FEATURES = [
  "Everything in Free, with no daily limit on practice questions",
  "The parent view",
  "A study calendar built around test day",
  "LISA, the AI tutor",
  "Full-length practice tests",
  "A projected score that updates as they practice",
] as const;

/** "Sat, Dec 5, 2026": the next official SAT date, or null if the shared list has run out. */
export function sampleTestDay(today: string = chicagoToday()): string | null {
  const next = offeredSatTestDates(today)[0];
  return next ? formatSatTestDate(next.date) : null;
}

function CallLink({
  label,
  className,
  testId,
}: {
  label: string;
  className: string;
  testId: string;
}): JSX.Element {
  return (
    <a
      href={PARENT_CALL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      data-testid={testId}
    >
      {label}
    </a>
  );
}

function SampleProgressCard(): JSX.Element {
  const testDay = sampleTestDay();
  return (
    <figure
      className={`${CARD} m-0 flex min-w-0 flex-col gap-[18px] bg-background p-6 shadow-[0_12px_32px_rgba(15,27,45,0.08)] sm:p-7`}
      data-testid="parent-sample-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[15px] font-semibold">Maya's progress</p>
        {testDay !== null && (
          <p
            className="text-sm text-[var(--home-caption)]"
            data-testid="parent-sample-test-day"
          >
            Test day: {testDay}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-[var(--home-caption)]">Projected score</p>
        <p className="text-[40px] font-bold leading-none">1310–1390</p>
        <p className="text-sm text-[var(--home-caption)]">
          Target 1450 · range narrows as she practices
        </p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {SAMPLE_DOMAINS.map((d) => (
          <li key={d.name} className="flex flex-col gap-1.5">
            <div className="flex justify-between gap-3 text-sm">
              <span>{d.name}</span>
              <span className="text-[var(--home-caption)]">
                {d.label}, {d.pct}%
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-[var(--home-rule)]"
              aria-hidden="true"
            >
              <div
                className="h-2 rounded-full bg-foreground"
                style={{ width: `${d.pct}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-border pt-3.5 text-sm text-[var(--home-caption)]">
        This week: 4 of 5 planned sessions done
      </p>
    </figure>
  );
}

function PriceTile({
  price,
  per,
}: {
  price: string;
  per: string;
}): JSX.Element {
  return (
    <div className="flex min-w-[120px] flex-1 flex-col justify-center gap-0.5 rounded-xl bg-card px-3.5 py-3">
      <span className="text-[22px] font-bold">{price}</span>
      <span className="text-sm text-[var(--home-caption)]">{per}</span>
    </div>
  );
}

/**
 * The three price tiles. Loading: a skeleton of the same shape. Failure or no prices: nothing
 * (the rest of the pricing section stays). Never a hardcoded amount.
 */
function PlanPrices(): JSX.Element | null {
  const { data: plans, isPending } = useQuery({
    queryKey: PARENT_PLAN_PRICES_QUERY_KEY,
    queryFn: getPublicPlanPrices,
    retry: 1,
  });

  if (isPending) {
    return (
      <div
        className="flex flex-wrap gap-2.5 pt-1.5"
        aria-hidden="true"
        data-testid="parent-prices-skeleton"
      >
        <div className="h-[68px] min-w-[120px] flex-1 animate-pulse rounded-xl bg-card" />
        <div className="h-[68px] min-w-[120px] flex-1 animate-pulse rounded-xl bg-card" />
        <div className="h-[96px] w-full animate-pulse rounded-[14px] bg-card" />
      </div>
    );
  }
  if (!plans || plans.length === 0) return null;

  const byPlan = (plan: PublicPlanPrice["plan"]): PublicPlanPrice | undefined =>
    plans.find((p) => p.plan === plan);
  const monthly = byPlan("monthly");
  const quarterly = byPlan("quarterly");
  const yearly = byPlan("yearly");
  const savings = yearlySavings(plans);

  return (
    <div
      className="flex flex-wrap items-stretch gap-2.5 pt-1.5"
      data-testid="parent-prices"
    >
      {monthly && (
        <PriceTile
          price={formatPlanAmount(monthly.amountCents, monthly.currency)}
          per="per month"
        />
      )}
      {quarterly && (
        <PriceTile
          price={formatPlanAmount(quarterly.amountCents, quarterly.currency)}
          per="every 3 months"
        />
      )}
      {yearly && (
        <div
          className="flex w-full flex-col items-center gap-1 rounded-[14px] border-2 border-foreground bg-background px-4 py-[18px] text-center shadow-[0_8px_20px_rgba(15,27,45,0.10)]"
          data-testid="parent-price-yearly"
        >
          {savings !== null && (
            <span className="text-sm font-bold uppercase tracking-[0.04em]">
              Best value · save {savings.savePercent}%
            </span>
          )}
          <span className="text-[28px] font-bold">
            {formatPlanAmount(yearly.amountCents, yearly.currency)}
          </span>
          <span className="text-sm text-[var(--home-caption)]">
            {savings !== null
              ? `per year (about ${savings.aboutPerMonth} a month)`
              : "per year"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function ParentPage(): JSX.Element {
  const { isAuthenticated, isGuardian } = useSupabaseAuth();
  const homeHref = isGuardian ? "/guardian" : "/dashboard";

  return (
    <PublicLayout
      className="home-palette"
      nav={
        <HomeNav
          isAuthenticated={isAuthenticated}
          homeHref={homeHref}
          sectionLinks={[]}
          signUp={{ href: GUARDIAN_SIGNUP_HREF, label: "Sign up" }}
        />
      }
      footerTone="navy"
    >
      <div data-testid="parent-page">
        <section className="bg-card">
          <div className={`${WRAP} gap-0 pb-6 pt-14 sm:pt-20`}>
            <div className="flex flex-col items-center gap-12 lg:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-5">
                <p className="text-sm font-semibold uppercase tracking-[0.06em] text-[var(--home-eyebrow)]">
                  For parents
                </p>
                <h1 className="text-[2.5rem] font-bold leading-[1.08] sm:text-5xl lg:text-[52px]">
                  See real progress before test day.
                </h1>
                <p className="max-w-[560px] text-lg leading-[1.55] text-muted-foreground sm:text-[19px]">
                  Stop guessing whether they're ready. Get real peace of mind
                  before test day.
                </p>
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
                  <Link
                    href={GUARDIAN_SIGNUP_HREF}
                    className={PRIMARY_BUTTON}
                    data-testid="parent-hero-sign-up"
                  >
                    Sign up
                  </Link>
                  <CallLink
                    label={PARENT_CALL_HERO_LABEL}
                    className={OUTLINE_BUTTON}
                    testId="parent-hero-call"
                  />
                </div>
                <p className="text-sm text-[var(--home-caption)]">
                  Students can practice free. The parent view is part of Lyceon
                  Pro.
                </p>
              </div>
              <div className="w-full min-w-0 lg:max-w-[440px] lg:flex-1">
                <SampleProgressCard />
              </div>
            </div>
            <p className="pt-6 text-sm text-[var(--home-caption)]">
              Example view with sample data.
            </p>
          </div>
        </section>

        <section aria-labelledby="parent-see-h">
          <div className={`${WRAP} gap-9 py-16 sm:py-20`}>
            <div className="flex max-w-[680px] flex-col gap-3">
              <h2 id="parent-see-h" className={H2}>
                What you'll see
              </h2>
              <p className="text-[17px] leading-relaxed text-muted-foreground">
                A clear picture of their prep, without hovering over their
                shoulder.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {WHAT_YOU_SEE.map((f) => (
                <li
                  key={f.title}
                  className={`${CARD} flex flex-col gap-2.5 p-6`}
                >
                  <h3 className="text-[19px] font-semibold">{f.title}</h3>
                  <p className="text-[15px] leading-[1.55] text-muted-foreground">
                    {f.body}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-[15px] text-muted-foreground">
              Your teen's answers and their conversations with the AI tutor stay
              private to them.
            </p>
          </div>
        </section>

        <section className="bg-card" aria-labelledby="parent-how-h">
          <div className={`${WRAP} gap-9 py-16 sm:py-20`}>
            <h2 id="parent-how-h" className={H2}>
              How it works
            </h2>
            <ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  className={`${CARD} flex flex-col gap-2.5 bg-background p-6`}
                >
                  <span className="text-[28px] font-bold" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className="text-[19px] font-semibold">{s.title}</h3>
                  <p className="text-[15px] leading-[1.55] text-muted-foreground">
                    {s.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="pricing" aria-labelledby="parent-pricing-h">
          <div className={`${WRAP} gap-9 py-16 sm:py-20`}>
            <div className="flex max-w-[680px] flex-col gap-3">
              <h2 id="parent-pricing-h" className={H2}>
                Free to start. Pro when you want the full picture.
              </h2>
              <p className="text-[17px] leading-relaxed text-muted-foreground">
                A month of Pro costs less than an hour or two with most private
                SAT tutors, and it's there every day.
              </p>
            </div>
            <div className="flex flex-col gap-5 md:flex-row">
              <div
                className={`${CARD} flex min-w-0 flex-1 flex-col gap-3.5 p-7`}
              >
                <h3 className="text-[22px] font-semibold">Free for students</h3>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-normal text-muted-foreground">
                  {FREE_FEATURES.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-2xl border-2 border-foreground p-7">
                <h3 className="text-[22px] font-semibold">Lyceon Pro</h3>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-normal text-muted-foreground">
                  {PRO_FEATURES.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <PlanPrices />
                <p className="text-sm text-[var(--home-caption)]">
                  Cancel any time from your billing page. Prices load live from
                  checkout.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          className="bg-foreground text-background"
          aria-labelledby="parent-call-h"
        >
          <div className="mx-auto flex max-w-[760px] flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-[72px]">
            <div className="flex flex-col items-center gap-2.5">
              <h2
                id="parent-call-h"
                className="text-[32px] font-bold leading-tight text-background"
              >
                Not sure it's right for your teen?
              </h2>
              <p className="text-[17px] leading-relaxed text-[var(--home-footer-muted)]">
                Talk to Karl, Lyceon's founder, for 15 minutes. Bring your
                questions about the SAT, your teen's plan, or how Lyceon works.
              </p>
            </div>
            <CallLink
              label={PARENT_CALL_LABEL}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-background px-6 py-3.5 text-base font-semibold text-foreground no-underline hover:opacity-90 sm:text-[17px]"
              testId="parent-band-call"
            />
          </div>
        </section>

        <section aria-labelledby="parent-faq-h">
          <div className="mx-auto flex max-w-[820px] flex-col gap-7 px-4 py-16 sm:px-6 sm:py-20">
            <h2 id="parent-faq-h" className={H2}>
              Questions parents ask
            </h2>
            {/* One copy of this FAQ: rendered here, and the /parent FAQPage JSON-LD is built from
                the same array (shared/seo/faqs.ts PARENT_FAQS). */}
            <div className="flex flex-col">
              {PARENT_FAQS.map((faq) => (
                <div
                  key={faq.question}
                  className="flex flex-col gap-2 border-t border-border py-5"
                >
                  <h3 className="text-lg font-semibold">{faq.question}</h3>
                  {faqParagraphs(faq.answer).map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-[15px] leading-relaxed text-muted-foreground"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-card" aria-labelledby="parent-final-h">
          <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-[18px] px-4 py-16 text-center sm:px-6 sm:py-[72px]">
            <h2 id="parent-final-h" className={H2}>
              Study smarter, score higher.
            </h2>
            <p className="text-[17px] text-muted-foreground">
              Sign up, add your card, invite your teen. You’re only charged once
              they join.
            </p>
            <Link
              href={GUARDIAN_SIGNUP_HREF}
              className={PRIMARY_BUTTON}
              data-testid="parent-final-sign-up"
            >
              Sign up
            </Link>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
