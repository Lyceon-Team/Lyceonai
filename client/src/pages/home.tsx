import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Brain,
  Target,
  TrendingUp,
  CheckCircle2,
  MessageSquare,
  BarChart3,
  Clock,
  Shield,
  Sparkles,
  ChevronDown,
  LogOut,
  LayoutDashboard,
} from "lucide-react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { HOME_FAQS, faqParagraphs } from "@shared/seo/public-meta";
import { useToast } from "@/hooks/use-toast";
import { resolveAuthErrorMessage } from "@/lib/auth-error-messages";
import PublicLayout from "@/components/layout/PublicLayout";
import { Container, Card, Section } from "@/components/layout/primitives";
import {
  getPublicMonthlyPrice,
  formatMonthlyPrice,
} from "@/lib/public-pricing";
import { ctaClickHandlers } from "@/lib/cta-click";
import { QotdWidget } from "@/components/qotd/QotdWidget";

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
 * free-tier endpoint would close it properly.
 *
 * Doc 01A Appendix A.3's example bucket map carries a THIRD number for this
 * ("practice_daily_free": 20) against a bucket that exists in neither
 * production nor Doc 02B. That divergence is reported, not resolved here.
 */
const FREE_DAILY_PRACTICE_QUESTIONS = 40;

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

  const { isAuthenticated, isGuardian, signOut } = useSupabaseAuth();
  // G4-01: a signed-in guardian's home is /guardian; /dashboard is the student's.
  const homeHref = isGuardian ? "/guardian" : "/dashboard";
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // @spec [contracts/auth-standard-flow.contract.md AS-3] | @implemented 2026-06-20
  // plain English: sign-out failures route through resolveAuthErrorMessage (the auth display
  // chokepoint) so the toast shows a human, recoverable message — never the raw error string.
  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      toast({ title: "Signed out successfully" });
      navigate("/login");
    } catch (error) {
      console.error("Sign out failed:", error);
      toast({
        title: "Sign out failed",
        description: resolveAuthErrorMessage(error),
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  // @spec [docs/plans/seo/seo-marketing-vertical.md R13, F7] | @implemented [2026-10-03] |
  // plain English: the hero A/B test is gone. It picked a random variant inside an
  // effect and stored it in localStorage, so the first render (and so the prerendered HTML)
  // showed "Loading..." instead of the headline, and every first visit wrote to storage.
  // Variant A's copy is the only hero now; A/B testing returns later via PostHog experiments.

  const trackCtaClick = (ctaText: string) => {
    console.debug("hero_cta_click", { ctaText });
  };

  return (
    <PublicLayout>
      <Container size="full">
        <section className="py-16 lg:py-24">
          {/* F6 (owner answer 11, 2026-10-03): the scripted tutor demo that sat beside the hero
              is removed; the hero is one column until the F13 homepage rebuild. */}
          <div className="max-w-3xl">
            {/* @spec [SEO plan F8] | @implemented [2026-10-05] | plain English: the hero's
                entrance is a CSS slide only, with no fade, so the prerendered headline is
                visible from first paint without JavaScript (it was `opacity:0` until hydration)
                and the entry bundle no longer carries framer-motion. Reduced motion: none. */}
            <div className="animate-in slide-in-from-bottom-5 duration-700 motion-reduce:animate-none">
              <span className="text-xs uppercase tracking-widest text-muted-foreground mb-4 block">
                Study smarter for the SAT
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                Digital SAT prep, one step at a time
              </h1>
              <p className="text-lg mb-4">
                Practice SAT-style questions, review step-by-step
                explanations, and track progress over time.
              </p>
              <p className="text-muted-foreground mb-8">
                Daily practice with worked explanations. Full-length practice
                tests, an AI tutor and a study plan on paid plans.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                {/* The hero CTA counts a middle-click and a ⌘-click as well as a plain
                    one. Before #829 the inner anchor had no href, so a ⌘-click did not
                    navigate but still fired onClick and was counted; with a real href,
                    wouter hands that click to the browser and skips onClick, which would
                    have dropped those conversions in silence. `ctaClickHandlers` covers
                    all three paths exactly once — see its module note. */}
                <Link
                  href="/practice"
                  className="px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center"
                  data-testid="button-start-demo"
                  {...ctaClickHandlers(() =>
                    trackCtaClick("Start free practice"),
                  )}
                >
                  Start free practice
                </Link>
                {isAuthenticated ? (
                  <>
                    <Link
                      href={homeHref}
                      className="px-6 py-3 bg-secondary border border-border rounded-lg font-medium transition-colors flex items-center justify-center gap-2 hover:bg-secondary/80"
                      data-testid="button-go-to-dashboard"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      Go to dashboard
                    </Link>
                    <button
                      onClick={handleSignOut}
                      disabled={isSigningOut}
                      className="px-6 py-3 bg-card border border-border rounded-lg font-medium transition-colors flex items-center justify-center gap-2 hover:bg-secondary disabled:opacity-50"
                      data-testid="button-sign-out"
                    >
                      <LogOut className="w-4 h-4" />
                      {isSigningOut ? "Signing out..." : "Sign out"}
                    </button>
                  </>
                ) : (
                  <Link
                    href="/login"
                    className="px-6 py-3 bg-secondary border border-border rounded-lg font-medium transition-colors flex items-center justify-center gap-2 hover:bg-secondary/80"
                    data-testid="button-sign-in-dashboard"
                  >
                    <Sparkles className="w-4 h-4" />
                    Sign in to your dashboard
                  </Link>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4 pt-6 border-t border-border">
                <div>
                  <div className="text-2xl font-bold">Study plan</div>
                  <div className="text-sm text-muted-foreground">
                    A study plan that focuses on your weak areas (paid plans)
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold">Practice tests</div>
                  <div className="text-sm text-muted-foreground">
                    Timed full-length practice tests (paid plans)
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold">Progress tracking</div>
                  <div className="text-sm text-muted-foreground">
                    Track your progress by section and skill
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </Container>

      <section className="bg-secondary/50 border-y border-border py-6">
        <Container size="wide">
          <div className="grid md:grid-cols-3 gap-6 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-3">
              <Shield className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">SAT-style practice questions</span>
            </div>
            <div className="flex items-center justify-center md:justify-start gap-3">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">We don't sell student data.</span>
            </div>
            <div className="flex items-center justify-center md:justify-start gap-3">
              <Brain className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">
                AI tutor for step-by-step help (paid plans)
              </span>
            </div>
          </div>
        </Container>
      </section>

      {/* @spec [docs/plans/seo/seo-marketing-vertical.md R16, Q3] | @implemented [2026-10-05] |
          plain English: today's question, answerable without an account. It is fetched in the
          browser, so the prerendered homepage carries no question and no answer. */}
      <Container size="narrow">
        <Section id="question-of-the-day" className="py-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              SAT Question of the Day
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              One free practice question every day. No account needed.
            </p>
          </div>
          <Card>
            <QotdWidget />
          </Card>
        </Section>
      </Container>

      <Container size="wide">
        <Section id="how-it-works" className="py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              How it works
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Three simple steps to smarter SAT prep
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="relative">
              <div className="absolute -top-4 left-6 w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center font-bold text-sm">
                1
              </div>
              <Target className="w-10 h-10 mb-4 mt-2" />
              <h3 className="text-xl font-semibold mb-3">
                Start with a diagnostic
              </h3>
              <p className="text-muted-foreground">
                Take a diagnostic test to see where you stand.
              </p>
            </Card>

            <Card className="relative">
              <div className="absolute -top-4 left-6 w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center font-bold text-sm">
                2
              </div>
              <MessageSquare className="w-10 h-10 mb-4 mt-2" />
              <h3 className="text-xl font-semibold mb-3">
                Practice and review
              </h3>
              <p className="text-muted-foreground">
                Answer SAT-style questions and review a worked explanation for
                each one.
              </p>
            </Card>

            <Card className="relative">
              <div className="absolute -top-4 left-6 w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center font-bold text-sm">
                3
              </div>
              <TrendingUp className="w-10 h-10 mb-4 mt-2" />
              <h3 className="text-xl font-semibold mb-3">Track your progress</h3>
              <p className="text-muted-foreground">
                See your progress by section, and take full-length practice
                tests on paid plans.
              </p>
            </Card>
          </div>
        </Section>
      </Container>

      <section className="bg-secondary py-16">
        <Container size="wide">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Built for the way you actually study
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Daily practice plus full-length test readiness
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card>
              <MessageSquare className="w-10 h-10 mb-4" />
              <h3 className="text-xl font-semibold mb-3">
                AI tutor (paid plans)
              </h3>
              <p className="text-muted-foreground mb-4">
                Ask follow-up questions and get step-by-step help.
              </p>
            </Card>

            <Card>
              <Clock className="w-10 h-10 mb-4" />
              <h3 className="text-xl font-semibold mb-3">
                Practice sessions that fit life
              </h3>
              <p className="text-muted-foreground mb-4">
                Practice for as long or as short as you like.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Section-specific practice
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Pause and pick up where you left off
                </li>
              </ul>
            </Card>

            <Card>
              <BarChart3 className="w-10 h-10 mb-4" />
              <h3 className="text-xl font-semibold mb-3">
                Progress for parents and guardians
              </h3>
              <p className="text-muted-foreground mb-4">
                Parents and guardians can link to a student's account and see a
                read-only progress summary while the student is on a paid plan.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Skill-level progress (paid plans)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Read-only progress view for a linked parent or guardian
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Study plan (paid plans)
                </li>
              </ul>
            </Card>
          </div>
        </Container>
      </section>

      <Container size="wide">
        <Section className="py-16">
          <div className="grid lg:grid-cols-2 gap-12">
            <div>
              <h2 className="text-3xl font-bold mb-8">
                What you can track today
              </h2>
              <div className="space-y-6">
                <Card className="bg-secondary">
                  <div className="font-medium mb-1">Practice consistency</div>
                  <div className="text-sm text-muted-foreground">
                    Your practice history and accuracy over time.
                  </div>
                </Card>

                <Card className="bg-secondary">
                  <div className="font-medium mb-1">Progress snapshot</div>
                  <div className="text-sm text-muted-foreground">
                    Skill-level detail on paid plans.
                  </div>
                </Card>

                <Card className="bg-secondary">
                  <div className="font-medium mb-1">
                    Full-length practice test results (paid plans)
                  </div>
                  <div className="text-sm text-muted-foreground">
                    A score report after each practice test.
                  </div>
                </Card>
              </div>
            </div>

            <div>
              <h2 className="text-3xl font-bold mb-8">Who Lyceon is for</h2>
              <div className="space-y-6">
                <Card className="bg-secondary">
                  <div className="font-semibold mb-2">Students</div>
                  <p>
                    Build a daily SAT routine with practice, review and worked
                    explanations. Upgrade for full-length practice tests, an AI
                    tutor and a study plan.
                  </p>
                </Card>

                <Card className="bg-secondary">
                  <div className="font-semibold mb-2">Guardians</div>
                  <p>
                    Parents and guardians can link to a student's account and
                    see a read-only progress summary while the student is on a
                    paid plan.
                  </p>
                </Card>
              </div>
            </div>
          </div>
        </Section>
      </Container>

      <section id="pricing" className="bg-secondary py-16">
        <Container>
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Start for free. Upgrade when ready.
            </h2>
            <p className="text-muted-foreground">
              No credit card required to get started
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <Card>
              <div className="mb-6">
                <h3 className="text-xl font-semibold mb-2">Free</h3>
                <div className="text-4xl font-bold mb-1">
                  $0
                  <span className="text-lg text-muted-foreground">/month</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Perfect to get started
                </p>
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
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  {FREE_DAILY_PRACTICE_QUESTIONS} practice questions per day
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />A worked
                  explanation after every question you answer
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  A full diagnostic test and your diagnostic score estimate
                </li>
              </ul>

              <Link
                href="/login"
                className="block w-full px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center"
                data-testid="button-get-started-free"
              >
                Get started free
              </Link>
            </Card>

            <Card className="bg-foreground text-background relative overflow-hidden">
              <div className="mb-6">
                <h3 className="text-xl font-semibold mb-2">
                  Pro · for serious prep
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
                  <div className="text-4xl font-bold mb-1">
                    {formattedMonthlyPrice}
                    <span className="text-lg opacity-70">/month</span>
                  </div>
                )}
                <p className="text-sm opacity-70">Everything in Free, plus:</p>
              </div>

              <ul className="space-y-3 mb-8 opacity-90">
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>No daily limit on practice questions</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>AI tutor for step-by-step help</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>Full-length practice tests with score reports</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>
                    Skill-level progress and a study plan that focuses on your
                    weak areas
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>
                    Read-only progress view for a linked parent or guardian
                  </span>
                </li>
              </ul>

              {/*
                `/signup` redirects to `/login` (`App.tsx:71`), so this lands
                where the free card's CTA lands, with different copy. That is
                intended (owner ruling 2026-09-03): the destination is one auth
                page, and the two labels name which plan the visitor came for.
              */}
              <Link
                href="/signup"
                className="block w-full px-6 py-3 bg-background text-foreground rounded-lg font-medium hover:opacity-90 transition-opacity text-center"
                data-testid="button-get-started-paid"
              >
                Get Started
              </Link>
            </Card>
          </div>
        </Container>
      </section>

      <Container size="narrow">
        <Section id="faq" className="py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Frequently asked questions
            </h2>
          </div>

          {/* One copy of this FAQ: rendered here, and the homepage FAQPage JSON-LD is built
              from the same array (shared/seo/public-meta.ts, F1). */}
          <div className="space-y-4">
            {HOME_FAQS.map((faq) => (
              <details
                key={faq.question}
                className="bg-secondary border border-border rounded-2xl p-6 group"
              >
                <summary className="font-semibold text-lg cursor-pointer flex items-center justify-between">
                  {faq.question}
                  <ChevronDown className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform" />
                </summary>
                <div className="mt-4 text-muted-foreground space-y-2">
                  {faqParagraphs(faq.answer).map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </Section>
      </Container>

      <section className="bg-secondary border-t border-border py-16">
        <Container>
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Study smarter for the SAT
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
              Start with free daily practice. Upgrade any time for full-length
              practice tests and an AI tutor.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/practice"
                className="px-8 py-4 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center text-lg"
                data-testid="button-footer-start"
              >
                Start a free SAT session
              </Link>
              {isAuthenticated ? (
                <>
                  <Link
                    href={homeHref}
                    className="px-8 py-4 bg-card border border-border rounded-lg font-medium hover:bg-secondary transition-colors text-center text-lg flex items-center justify-center gap-2"
                    data-testid="button-footer-dashboard"
                  >
                    <LayoutDashboard className="w-5 h-5" />
                    Go to dashboard
                  </Link>
                  <button
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className="px-8 py-4 bg-card border border-border rounded-lg font-medium hover:bg-secondary transition-colors text-center text-lg flex items-center justify-center gap-2 disabled:opacity-50"
                    data-testid="button-footer-signout"
                  >
                    <LogOut className="w-5 h-5" />
                    {isSigningOut ? "Signing out..." : "Sign out"}
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  className="px-8 py-4 bg-card border border-border rounded-lg font-medium hover:bg-secondary transition-colors text-center text-lg"
                  data-testid="button-footer-signin"
                >
                  Sign in to your dashboard
                </Link>
              )}
            </div>
          </div>
        </Container>
      </section>
    </PublicLayout>
  );
}
