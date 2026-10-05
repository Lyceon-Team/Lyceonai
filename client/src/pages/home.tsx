import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { HOME_FAQS, faqParagraphs } from "@shared/seo/public-meta";
import { sectionDisplayLabel } from "@shared/section-display";
import { loginPathWithReturn } from "@lyceon/shared/return-path";
import type { MasteryLevelKey } from "@lyceon/shared/mastery-levels";
import PublicLayout from "@/components/layout/PublicLayout";
import { HomeNav } from "@/components/marketing/HomeNav";
import { ProductVisual } from "@/components/marketing/ProductVisual";
import {
  MASTERY_METER_SEGMENTS,
  masteryMeterFill,
} from "@/components/mastery/MasteryMeter";
import {
  getPublicMonthlyPrice,
  formatMonthlyPrice,
} from "@/lib/public-pricing";
import { ctaClickHandlers } from "@/lib/cta-click";
import {
  HERO_COPY,
  HERO_SUB_ID,
  HERO_SWAP_SCRIPT,
  HERO_TITLE_ID,
  currentHeroVariant,
} from "@/lib/analytics/hero-experiment";
import { recordHeroExposure } from "@/lib/analytics/posthog-client";
// Lazy and viewport-triggered: keeps the widget and KaTeX out of the homepage's initial script.
import { LazyQotdWidget } from "@/components/qotd/LazyQotdWidget";

/**
 * The free-tier daily practice allowance, as advertised.
 *
 * @spec [Doc 02B (V4) "12. Entitlement Gate System" -> "Entitlement Matrix"
 *        and "Quota Contract": "Free users may submit up to
 *        `practice_runtime_config.daily_quota_free` practice questions per
 *        calendar day (40 at launch)"] | @implemented [2026-09-03]
 *
 * THE SOURCE OF TRUTH IS THE DATABASE, NOT THIS LINE.
 * `practice_runtime_config.daily_quota_free` is what the runtime enforces, and
 * it reads 40 in production (verified 2026-09-03). This page is served to
 * logged-out visitors, so it cannot read an authenticated config endpoint; the
 * number is therefore restated here, which is a drift risk and is named as one.
 * Changing the config without changing this line makes the homepage lie again —
 * the defect this replaces. Reported to the owner as a follow-up: a public
 * free-tier endpoint would close it properly. F13: the free card AND the Question of the
 * Day's "Try 40 more questions free" button both read this one constant.
 *
 * Doc 01A Appendix A.3's example bucket map carries a THIRD number for this
 * ("practice_daily_free": 20) against a bucket that exists in neither
 * production nor Doc 02B. That divergence is reported, not resolved here.
 */
const FREE_DAILY_PRACTICE_QUESTIONS = 40;

/**
 * Where the homepage's calls to action land (owner rulings 2026-10-05, F13 Step 0 decision 4).
 * Signup is /login; the return path rides the shared `next` channel, which survives Google
 * sign-in and onboarding. The diagnostic button returns to /dashboard, where the free diagnostic
 * starts (no auto-start). The parent button returns to /guardian, which also makes Guardian the
 * DEFAULT role on the onboarding form (profile-complete.tsx) — a default only; the server
 * validates the chosen role exactly as before.
 */
const START_DIAGNOSTIC_HREF = loginPathWithReturn("/dashboard");
const GUARDIAN_SIGNUP_HREF = loginPathWithReturn("/guardian");

const TRUST_ITEMS = [
  "Free daily practice",
  "Worked explanation for every question",
  "No credit card required",
  "We don't sell student data",
] as const;

/** Approved by Karl 2026-10-05 (F13 brief; card 2 per Step 0 ruling 1). */
const HOW_IT_WORKS = [
  {
    title: "Find the gaps",
    body: "Start with a free diagnostic to see where you stand in every SAT section.",
  },
  {
    title: "Practice what matters",
    body: "Daily practice with a worked explanation after every question, and on paid plans a study calendar that adapts as you improve.",
  },
  {
    title: "Get help when you're stuck",
    body: "Ask LISA, your AI tutor, follow-up questions and get step-by-step help. On paid plans.",
  },
  {
    title: "See real progress",
    body: "Track progress by section and skill, and take timed full-length practice tests with a score report after each. On paid plans.",
  },
] as const;

/** The example parent view: the guardian card's two sections, drawn with its five-segment rule. */
const EXAMPLE_PROGRESS: readonly {
  section: "RW" | "M";
  level: MasteryLevelKey;
}[] = [
  { section: "RW", level: "L2" },
  { section: "M", level: "L1" },
];

const EXAMPLE_DAY = [
  "Practice block · Linear equations in one variable",
  "Review missed questions",
  "Ask LISA when you're stuck",
] as const;

const PRO_FEATURES = [
  "A study plan that adapts and focuses on your weak areas",
  "LISA, your AI tutor, for step-by-step help",
  "Full-length practice tests with score reports",
  "Skill-level progress, plus a read-only view for a linked parent or guardian",
  "No daily limit on practice questions",
] as const;

const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-foreground no-underline px-6 py-3.5 text-base font-semibold text-background hover:opacity-90 transition-opacity sm:text-[17px]";
const OUTLINE_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-xl border-[1.5px] no-underline border-foreground px-6 py-3 text-base font-semibold text-foreground hover:bg-card transition-colors sm:text-[17px]";
const SECTION = "border-t border-[var(--home-rule)]";
const CARD = "rounded-2xl border border-border bg-card";
const INSET = "rounded-xl border border-[var(--home-rule)] bg-background";

function ExampleMeter({ level }: { level: MasteryLevelKey }): JSX.Element {
  const filled = masteryMeterFill(level);
  return (
    <div className="grid grid-cols-5 gap-1.5" aria-hidden="true">
      {Array.from({ length: MASTERY_METER_SEGMENTS }, (_, i) => (
        <div
          key={i}
          className={`h-2.5 rounded ${i < filled ? "bg-foreground" : "bg-border"}`}
        />
      ))}
    </div>
  );
}

export default function HomePage() {
  /**
   * The paid card's price, from Stripe via `GET /api/public/pricing`.
   *
   * @spec [owner ruling 2026-09-03 — publish the monthly price]
   *
   * `retry: 1` and no fallback: when this resolves to null the card renders
   * WITHOUT a price line. There is deliberately no default amount to fall back
   * to — see `client/src/lib/public-pricing.ts` for why a constant here would
   * be the defect rather than the safety net.
   */
  const { data: monthlyPrice } = useQuery({
    queryKey: ["/api/public/pricing"],
    queryFn: getPublicMonthlyPrice,
    retry: 1,
  });
  const formattedMonthlyPrice = formatMonthlyPrice(monthlyPrice ?? null);

  const { isAuthenticated, isGuardian } = useSupabaseAuth();
  // G4-01: a signed-in guardian's home is /guardian; /dashboard is the student's.
  const homeHref = isGuardian ? "/guardian" : "/dashboard";

  // @spec [F13; owner rulings 2026-10-05, Step 0 decisions 5 and 6] | @implemented [2026-10-05] |
  // plain English: the hero experiment's variant for THIS view, read once. Prerender and any
  // visitor without analytics consent get null, which is A. The inline script below has already
  // shown the same variant before paint, so this first render changes nothing on screen. The
  // exposure is recorded only when a stored variant is what the visitor sees.
  const [heroVariant] = useState(currentHeroVariant);
  useEffect(() => {
    if (heroVariant !== null) recordHeroExposure(heroVariant);
  }, [heroVariant]);
  const hero = HERO_COPY[heroVariant ?? "control"];

  const trackCtaClick = (ctaText: string) => {
    console.debug("hero_cta_click", { ctaText });
  };

  return (
    <PublicLayout
      className="home-palette"
      nav={<HomeNav isAuthenticated={isAuthenticated} homeHref={homeHref} />}
      footerTone="navy"
    >
      <section id="top" className="px-4 sm:px-6">
        <div className="mx-auto flex max-w-[820px] flex-col items-center gap-5 py-16 text-center sm:gap-6 sm:py-20 lg:py-24">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--home-eyebrow)]">
            SAT prep for families
          </p>
          <h1
            id={HERO_TITLE_ID}
            className="text-[2.5rem] font-extrabold leading-[1.08] tracking-[-0.02em] sm:text-5xl lg:text-[56px]"
          >
            {hero.title}
          </h1>
          <p
            id={HERO_SUB_ID}
            className="max-w-[640px] text-lg leading-[1.55] text-muted-foreground sm:text-[19px]"
          >
            {hero.sub}
          </p>
          {/* Shows a stored Variant B before first paint (hero-experiment.ts). Its sha256 is in
              vercel.json's page script-src; the built-page CSP gate checks the two agree. */}
          <script dangerouslySetInnerHTML={{ __html: HERO_SWAP_SCRIPT }} />
          <div className="flex w-full flex-col items-stretch justify-center gap-3.5 sm:w-auto sm:flex-row sm:items-center">
            <Link
              href={START_DIAGNOSTIC_HREF}
              className={PRIMARY_BUTTON}
              data-testid="button-start-diagnostic"
              {...ctaClickHandlers(() =>
                trackCtaClick("Start the free diagnostic"),
              )}
            >
              Start the free diagnostic
            </Link>
            <Link
              href={GUARDIAN_SIGNUP_HREF}
              className={OUTLINE_BUTTON}
              data-testid="button-guardian-signup"
            >
              I'm a parent or guardian
            </Link>
          </div>
          <p className="text-sm text-[var(--home-caption)]">
            No credit card required · We don't sell student data
          </p>
        </div>
      </section>

      <section aria-label="Highlights" className={SECTION}>
        <ul className="mx-auto grid max-w-[1180px] grid-cols-1 gap-x-6 gap-y-3 px-4 py-7 text-[15px] font-medium text-muted-foreground sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {TRUST_ITEMS.map((item) => (
            <li key={item} className="flex items-center justify-center gap-2.5">
              <Check
                className="h-[18px] w-[18px] flex-shrink-0 text-foreground"
                strokeWidth={2.2}
                aria-hidden="true"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="how-it-works" className={SECTION}>
        <div className="mx-auto flex max-w-[1180px] flex-col gap-9 px-4 py-16 sm:px-6 sm:py-[72px]">
          <div className="mx-auto flex max-w-[680px] flex-col gap-2.5 text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">See how it works</h2>
            <p className="text-lg leading-[1.55] text-muted-foreground">
              Practice, review and the parent view.
            </p>
          </div>
          <ProductVisual />
          <ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step, i) => (
              <li
                key={step.title}
                className={`${CARD} flex flex-col gap-2.5 p-6`}
              >
                <span className="text-sm font-bold text-[var(--home-eyebrow)]">
                  {i + 1}
                </span>
                <h3 className="text-[22px] font-semibold leading-snug">
                  {step.title}
                </h3>
                <p className="text-base leading-normal text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* @spec [docs/plans/seo/seo-marketing-vertical.md R16, Q3, F13] | @implemented [2026-10-05] |
          plain English: today's question, answerable without an account. It is fetched in the
          browser, so the prerendered homepage carries no question and no answer. After the
          reveal, one full-width button to signup. */}
      <section id="question-of-the-day" className={SECTION}>
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-start gap-10 px-4 py-16 sm:px-6 sm:py-[72px]">
          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
            <h2 className="text-3xl font-bold sm:text-4xl">
              SAT Question of the Day
            </h2>
            <p className="text-lg leading-[1.55] text-muted-foreground">
              A free SAT practice question every day — no account needed.
            </p>
            <Link
              href="/sat-question-of-the-day"
              className="font-semibold underline underline-offset-2 hover:opacity-80"
            >
              See past questions
            </Link>
          </div>
          <div className={`${CARD} min-w-0 flex-[999_1_560px] p-5 sm:p-7`}>
            <LazyQotdWidget
              showArchiveLink={false}
              afterReveal={
                <Link
                  href={START_DIAGNOSTIC_HREF}
                  className={`${PRIMARY_BUTTON} w-full`}
                  data-testid="qotd-try-more"
                >
                  Try {FREE_DAILY_PRACTICE_QUESTIONS} more questions free
                </Link>
              }
            />
          </div>
        </div>
      </section>

      <section id="for-parents" className={SECTION}>
        <div className="mx-auto flex max-w-[1180px] flex-col gap-7 px-4 py-16 sm:px-6 sm:py-[72px]">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            Who Lyceon is for
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className={`${CARD} flex flex-col gap-3 p-6 sm:p-7`}>
              <h3 className="text-[22px] font-semibold">
                For parents and guardians
              </h3>
              <p className="leading-[1.55] text-muted-foreground">
                Parents and guardians can link to a student's account and see a
                read-only progress summary while the student is on a paid plan.
              </p>
              <figure className={`${INSET} flex flex-col gap-3 p-4`}>
                {EXAMPLE_PROGRESS.map((row) => (
                  <div key={row.section} className="flex flex-col gap-2">
                    <span className="text-sm font-semibold">
                      {sectionDisplayLabel(row.section)}
                    </span>
                    <ExampleMeter level={row.level} />
                  </div>
                ))}
                <figcaption className="text-[13px] text-[var(--home-caption)]">
                  Example view. Real progress comes from the student's account.
                </figcaption>
              </figure>
              {/* No tutor-comparison link until that page exists (F13 brief, section 6). */}
            </div>
            <div className={`${CARD} flex flex-col gap-3 p-6 sm:p-7`}>
              <h3 className="text-[22px] font-semibold">For students</h3>
              <p className="leading-[1.55] text-muted-foreground">
                Build a daily SAT routine with practice, review and worked
                explanations. Upgrade for a study plan that adapts as you
                improve, full-length practice tests and an AI tutor.
              </p>
              <figure className={`${INSET} flex flex-col gap-2.5 p-4`}>
                <span className="text-sm font-semibold">Today</span>
                <ul className="flex flex-col gap-2.5 text-sm">
                  {EXAMPLE_DAY.map((item) => (
                    <li key={item} className="flex items-center gap-2.5">
                      <span
                        className="h-2 w-2 flex-none rounded-full bg-foreground"
                        aria-hidden="true"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
                <figcaption className="text-[13px] text-[var(--home-caption)]">
                  Example view. Your plan comes from your own practice.
                </figcaption>
              </figure>
              <Link
                href={START_DIAGNOSTIC_HREF}
                className="mt-auto font-semibold underline underline-offset-2 hover:opacity-80"
              >
                Start practicing free →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className={SECTION}>
        <div className="mx-auto flex max-w-[1180px] flex-col gap-7 px-4 py-16 sm:px-6 sm:py-[72px]">
          <div className="flex flex-col gap-2 text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">
              Start for free. Upgrade when ready.
            </h2>
            <p className="text-lg text-muted-foreground">
              No credit card required to get started.
            </p>
          </div>

          <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-6 md:grid-cols-2">
            <div className={`${CARD} flex flex-col gap-4 rounded-[20px] p-7`}>
              <h3 className="text-lg font-semibold">Free</h3>
              <div className="text-[40px] font-extrabold leading-none">
                $0
                <span className="text-base font-medium text-muted-foreground">
                  {" "}
                  /month
                </span>
              </div>
              {/*
                EVERY LINE HERE IS ENFORCED SOMEWHERE. Corrected 2026-09-03 on
                the owner's ruling after all four previous claims were checked
                against Doc 02B's "Entitlement Matrix" and against production:

                - "Up to 10 practice questions per day" understated the real
                  allowance by a factor of four.
                - "Up to 5 tutor chat messages per day" advertised a PREMIUM
                  feature as free. `server/routes/tutor-runtime.ts` denies every
                  non-entitled profile with `entitlement_required` — free gets
                  zero, not five.
                - "Full-length SAT exam mode" did the same:
                  `server/routes/full-length-exam-routes.ts` answers 402
                  `PREMIUM_REQUIRED`. It has moved to the paid card.
                - "Progress and dashboard tracking" was true only of the single
                  overall projection; the mastery breakdown is premium.
              */}
              <ul className="flex list-disc flex-col gap-2 pl-5 leading-[1.45]">
                <li>
                  {FREE_DAILY_PRACTICE_QUESTIONS} practice questions per day
                </li>
                <li>A worked explanation after every question you answer</li>
                <li>
                  A full diagnostic test and your diagnostic score estimate
                </li>
              </ul>
              <Link
                href="/login"
                className={`${OUTLINE_BUTTON} mt-auto w-full`}
                data-testid="button-get-started-free"
              >
                Get started free
              </Link>
            </div>

            <div className="flex flex-col gap-4 rounded-[20px] border-2 border-foreground bg-card p-7">
              <h3 className="text-lg font-semibold">
                Pro · personalized SAT prep
              </h3>
              {/*
                THE PRICE COMES FROM STRIPE OR IT DOES NOT APPEAR.
                Rendered only when `formattedMonthlyPrice` is a string, which
                `formatMonthlyPrice` returns only for an amount that survived
                `publicPricingSchema`. There is no fallback constant and no
                placeholder: an unconfigured price id or an unreachable Stripe
                drops this block entirely rather than quoting a number nobody
                can be charged.

                NOT THE `upgrade.tsx:92` SHAPE. That module spreads the API
                row over a fallback row, so a null amount from the API
                overwrites the fallback and reaches the formatter as `$NaN`.
                Nothing is merged here, so there is nothing to overwrite.
              */}
              {formattedMonthlyPrice !== null && (
                <div className="text-[40px] font-extrabold leading-none">
                  {formattedMonthlyPrice}
                  <span className="text-base font-medium text-muted-foreground">
                    {" "}
                    /month
                  </span>
                </div>
              )}
              <ul className="flex list-disc flex-col gap-2 pl-5 leading-[1.45]">
                <li>Everything in Free, plus:</li>
                {PRO_FEATURES.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {/*
                `/signup` redirects to `/login` (`App.tsx:71`), so this lands
                where the free card's CTA lands, with different copy. That is
                intended (owner ruling 2026-09-03): the destination is one auth
                page, and the two labels name which plan the visitor came for.
              */}
              <Link
                href="/signup"
                className={`${PRIMARY_BUTTON} mt-auto w-full`}
                data-testid="button-get-started-paid"
              >
                Get started
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className={SECTION}>
        <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-4 py-16 sm:px-6 sm:py-[72px]">
          <h2 className="mb-2 text-center text-3xl font-bold sm:text-4xl">
            Frequently asked questions
          </h2>
          {/* One copy of this FAQ: rendered here, and the homepage FAQPage JSON-LD is built
              from the same array (shared/seo/public-meta.ts, F1). */}
          {HOME_FAQS.map((faq) => (
            <details key={faq.question} className={`${CARD} px-5 py-4 sm:px-6`}>
              <summary className="min-h-11 cursor-pointer py-2 text-[17px] font-semibold">
                {faq.question}
              </summary>
              <div className="mt-2 space-y-2 leading-[1.55] text-muted-foreground">
                {faqParagraphs(faq.answer).map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section aria-label="Get started" className={SECTION}>
        <div className="mx-auto flex max-w-[1180px] flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
          {/* Slogan approved by Karl 2026-10-05 (F13; claim inventory X1). */}
          <h2 className="text-3xl font-extrabold sm:text-[38px]">
            Study Smarter, Score Higher.
          </h2>
          <p className="text-lg text-muted-foreground">
            Start with the free diagnostic. No credit card required.
          </p>
          <div className="flex w-full flex-col items-stretch justify-center gap-3.5 sm:w-auto sm:flex-row">
            <Link
              href={START_DIAGNOSTIC_HREF}
              className={PRIMARY_BUTTON}
              data-testid="button-footer-start"
            >
              Start the free diagnostic
            </Link>
            {isAuthenticated ? (
              <Link
                href={homeHref}
                className={OUTLINE_BUTTON}
                data-testid="button-footer-dashboard"
              >
                Go to dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                className={OUTLINE_BUTTON}
                data-testid="button-footer-signin"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
