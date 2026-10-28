/**
 * `/start`: the one landing page every social post links to. Sign-up first, today's question as a
 * small "try one" card.
 *
 * @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
 *       (Karl, 2026-10-28) item 1; Karl's answer the same day: "Reword to what's free" (copy in
 *       shared/social/funnel.ts, the free-plan sentence from client/src/lib/plan-copy.ts);
 *       Public Disclosure Doctrine 3 (the test date shown with its College Board source) and 8
 *       (noindex: a page for our own links, not for search); SEO Wave 3 decision 5 (the standard
 *       "Start the free diagnostic" CTA)] | @implemented [2026-10-28]
 *
 * plain English: a headline for people taking the SAT on the cohort date (Dec 5, 2026), what the free
 * plan includes (shared/social/funnel.ts START_SUBHEAD), one filled button to sign up (which then starts the diagnostic), and
 * today's Question of the Day to try, with the same sign-up button once it is answered. The day
 * after the cohort date the headline turns evergreen by itself (America/Chicago). The sign-up link
 * carries the visit's channel and campaign tags (`utm_source`, `utm_campaign`, allowlisted by the
 * shared derivation), so the sign-up records them as signup_channel / signup_campaign whether the
 * visitor answers the cookie banner or not; they are also captured at landing (first-touch.ts).
 *
 * Prerendered: the HTML is built with the phase of the build day and says so in
 * `data-funnel-phase`; hydration reads that back, then the page shows today's phase, so a page
 * built before Dec 6 and read after it switches without a hydration mismatch. The question is
 * fetched in the browser, so the HTML never holds it.
 */
import { useSyncExternalStore } from "react";
import { Link } from "wouter";
import PublicLayout from "@/components/layout/PublicLayout";
import { Card, Container, Section } from "@/components/layout/primitives";
import { SourceLinks } from "@/components/common/source-links";
import { LazyQotdWidget } from "@/components/qotd/LazyQotdWidget";
import { Button } from "@/components/ui/button";
import { firstTouchTags } from "@/lib/analytics/first-touch";
import { START_DIAGNOSTIC_HREF } from "@/lib/marketing-links";
import { chicagoToday } from "@shared/sat-test-dates";
import { CB_SAT_DATES } from "@shared/seo/sources";
import {
  cohortDateLabel,
  funnelPhase,
  START_SUBHEAD,
  START_TRY_ONE,
  startHeadline,
  type FunnelPhase,
} from "@shared/social/funnel";
import type { SignupTags } from "@lyceon/shared/analytics-consent-schema";

const PHASE_ATTR = "data-funnel-phase";

function noSubscription(): () => void {
  // The phase changes once, at midnight Chicago; a page left open across it updates on its next
  // load. Nothing to subscribe to.
  return () => undefined;
}

function currentPhase(): FunnelPhase {
  return funnelPhase(chicagoToday());
}

/** On the server, today's phase; while hydrating, the phase the prerendered HTML was built with. */
function renderedPhase(): FunnelPhase {
  if (typeof document === "undefined") return currentPhase();
  const value = document
    .querySelector(`[${PHASE_ATTR}]`)
    ?.getAttribute(PHASE_ATTR);
  return value === "cohort" || value === "evergreen" ? value : currentPhase();
}

/** The sign-up link with the visit's allowlisted channel and campaign tags. */
export function signupHrefWithTags(href: string, tags: SignupTags): string {
  const url = new URL(href, "https://lyceon.ai");
  if (tags.channel !== null) url.searchParams.set("utm_source", tags.channel);
  if (tags.campaign !== null)
    url.searchParams.set("utm_campaign", tags.campaign);
  return `${url.pathname}${url.search}`;
}

function taggedSignupHref(): string {
  return signupHrefWithTags(START_DIAGNOSTIC_HREF, firstTouchTags());
}

function untaggedSignupHref(): string {
  return START_DIAGNOSTIC_HREF;
}

function SignupButton({ href }: { href: string }): JSX.Element {
  return (
    <Button asChild size="lg" className="w-full sm:w-auto">
      <Link href={href} data-testid="start-signup">
        Start the free diagnostic
      </Link>
    </Button>
  );
}

export default function StartPage(): JSX.Element {
  const phase = useSyncExternalStore(
    noSubscription,
    currentPhase,
    renderedPhase,
  );
  const signupHref = useSyncExternalStore(
    noSubscription,
    taggedSignupHref,
    untaggedSignupHref,
  );

  return (
    <PublicLayout>
      <Container size="narrow">
        <header
          className="pt-10 mb-8 flex flex-col gap-4"
          {...{ [PHASE_ATTR]: phase }}
        >
          <h1
            className="text-3xl md:text-4xl font-bold leading-tight"
            data-testid="start-headline"
          >
            {startHeadline(phase)}
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {START_SUBHEAD}
          </p>
          <div>
            <SignupButton href={signupHref} />
          </div>
          {phase === "cohort" ? (
            <div className="text-sm text-muted-foreground">
              <p>The SAT is offered on {cohortDateLabel()}.</p>
              <SourceLinks sources={[CB_SAT_DATES]} />
            </div>
          ) : null}
        </header>

        <Section title="Try one">
          <p className="mb-4 text-muted-foreground leading-relaxed">
            {START_TRY_ONE}
          </p>
          <Card>
            <LazyQotdWidget
              showArchiveLink={false}
              afterReveal={<SignupButton href={signupHref} />}
            />
          </Card>
        </Section>
      </Container>
    </PublicLayout>
  );
}
