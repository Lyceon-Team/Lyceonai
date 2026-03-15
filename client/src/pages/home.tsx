import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
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
  ChevronDown
} from "lucide-react";
import { SEO, JsonLd, organizationJsonLd, websiteJsonLd } from "@/components/SEO";
import PublicLayout from "@/components/layout/PublicLayout";
import { Container, Card, Section } from "@/components/layout/primitives";

type DemoState = "idle" | "thinking" | "answered";
type HeroVariant = "A" | "B";

export default function HomePage() {
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [variant, setVariant] = useState<HeroVariant | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("landing_hero_variant");
      if (saved === "A" || saved === "B") {
        setVariant(saved);
        return;
      }
      const chosen: HeroVariant = Math.random() < 0.5 ? "A" : "B";
      window.localStorage.setItem("landing_hero_variant", chosen);
      setVariant(chosen);
    } catch {
      setVariant("A");
    }
  }, []);

  const triggerDemo = () => {
    setDemoState("thinking");
    setTimeout(() => {
      setDemoState("answered");
      setTimeout(() => setDemoState("idle"), 7000);
    }, 1600);
  };

  const trackCtaClick = (ctaText: string) => {
    console.debug("hero_cta_click", { variant, ctaText });
<<<<<<< HEAD
=======
    console.debug("[A/B Test] Current localStorage:", window.localStorage.getItem("landing_hero_variant"));
    if (typeof window !== 'undefined' && (window as any).analytics) {
      (window as any).analytics.track("hero_cta_click", {
        variant,
        ctaText,
      });
    }
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
  };

  return (
    <PublicLayout>
      <SEO
        title="Lyceon | Study Smarter, Score Higher"
        description="Digital SAT prep with adaptive practice, full-length exams, mastery tracking, Lisa chat, and guardian visibility. Free plan available with daily limits."
        canonical="https://lyceon.ai"
      />
      <JsonLd data={organizationJsonLd} />
      <JsonLd data={websiteJsonLd} />

      <Container size="full">
        <section className="py-16 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {!variant ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="text-muted-foreground">Loading...</div>
                </div>
              ) : variant === "A" ? (
                <>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground mb-4 block">
                    Study Smarter, Score Higher
                  </span>
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                    Digital SAT prep built for <span className="text-foreground">real progress</span>
                  </h1>
                  <p className="text-lg mb-4">
                    Practice SAT-style questions, review step-by-step explanations, and track mastery over time.
                  </p>
                  <p className="text-muted-foreground mb-8">
                    Use quick daily sessions, full-length exams, and Lisa in one place.
                  </p>
                </>
              ) : (
                <>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground mb-4 block">
                    Study Smarter, Score Higher
                  </span>
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                    Study Smarter, Score Higher on the <span className="text-foreground">Digital SAT</span>
                  </h1>
                  <p className="text-lg mb-4">
                    Build consistency with adaptive practice, full-length tests, and focused review.
                  </p>
                  <p className="text-muted-foreground mb-8">
                    Students track growth. Guardians can monitor linked progress and planning.
                  </p>
                </>
              )}

              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <Link href="/practice">
                  <a
                    className="px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center"
                    data-testid="button-start-demo"
                    onClick={() => trackCtaClick(variant === "A" ? "Start free practice" : "See how Lyceon works")}
                  >
                    {variant === "A" ? "Start free practice" : "See how Lyceon works"}
                  </a>
                </Link>
                <Link href="/login">
                  <a
                    className="px-6 py-3 bg-secondary border border-border rounded-lg font-medium transition-colors flex items-center justify-center gap-2 hover:bg-secondary/80"
                    data-testid="button-sign-in-dashboard"
                  >
                    <Sparkles className="w-4 h-4" />
                    Sign in to your dashboard
                  </a>
                </Link>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-6 border-t border-border">
                <div>
                  <div className="text-2xl font-bold">Adaptive practice</div>
                  <div className="text-sm text-muted-foreground">Question difficulty adjusts as you improve</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">Full-length exams</div>
                  <div className="text-sm text-muted-foreground">Timed 98-question SAT simulation</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">Mastery tracking</div>
                  <div className="text-sm text-muted-foreground">Topic and skill-level progress visibility</div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Card className="shadow-lg">
                <div className="flex gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                    <span className="text-sm">👤</span>
                  </div>
                  <div className="flex-1">
                    <div className="bg-foreground text-background rounded-lg p-3 text-sm">
                      "I don't understand why the answer is B. Can you explain?"
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                    <Brain className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    {demoState === "idle" && (
                      <div className="text-sm text-muted-foreground italic">
                        Sign in to start practicing with Lisa
                      </div>
                    )}

                    {demoState === "thinking" && (
                      <div className="bg-secondary border border-border rounded-lg p-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="flex gap-1">
                            <span className="animate-bounce">●</span>
                            <span className="animate-bounce delay-100">●</span>
                            <span className="animate-bounce delay-200">●</span>
                          </div>
                          Analyzing question...
                        </div>
                      </div>
                    )}

                    {demoState === "answered" && (
                      <div className="bg-secondary border border-border rounded-lg p-4 text-sm space-y-3">
                        <p>Let me break this down step by step:</p>
                        <ol className="space-y-2">
                          <li className="flex gap-2">
                            <span className="font-medium">1.</span>
                            <span>Identify what the question asks about passage structure.</span>
                          </li>
                          <li className="flex gap-2">
                            <span className="font-medium">2.</span>
                            <span>Find transition language that signals contrast.</span>
                          </li>
                          <li className="flex gap-2">
                            <span className="font-medium">3.</span>
                            <span>Choose the option that matches that shift in logic.</span>
                          </li>
                        </ol>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={triggerDemo}
                    className="text-sm px-3 py-2 bg-secondary border border-border rounded-lg hover:bg-secondary/80 transition-colors"
                  >
                    Preview explanation
                  </button>
                </div>

                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Lisa support
                  </span>
                  <span>Grounded in SAT-style questions</span>
                </div>
              </Card>
            </motion.div>
          </div>
        </section>
      </Container>

      <section className="bg-secondary/50 border-y border-border py-6">
        <Container size="wide">
          <div className="grid md:grid-cols-3 gap-6 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-3">
              <Shield className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">Grounded in SAT-style practice content</span>
            </div>
            <div className="flex items-center justify-center md:justify-start gap-3">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">Privacy first - no data selling</span>
            </div>
            <div className="flex items-center justify-center md:justify-start gap-3">
              <Brain className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">Tutor chat with step-by-step SAT-focused explanations</span>
            </div>
          </div>
        </Container>
      </section>

      <Container size="wide">
        <Section id="how-it-works" className="py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">How it works</h2>
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
              <h3 className="text-xl font-semibold mb-3">Diagnose in minutes</h3>
              <p className="text-muted-foreground">
                Take a quick diagnostic to identify strengths and weak spots.
              </p>
            </Card>

            <Card className="relative">
              <div className="absolute -top-4 left-6 w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center font-bold text-sm">
                2
              </div>
              <MessageSquare className="w-10 h-10 mb-4 mt-2" />
              <h3 className="text-xl font-semibold mb-3">Practice and review</h3>
              <p className="text-muted-foreground">
                Use adaptive question flow and Lisa to understand mistakes and next steps.
              </p>
            </Card>

            <Card className="relative">
              <div className="absolute -top-4 left-6 w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center font-bold text-sm">
                3
              </div>
              <TrendingUp className="w-10 h-10 mb-4 mt-2" />
              <h3 className="text-xl font-semibold mb-3">Track and improve</h3>
              <p className="text-muted-foreground">
                Monitor mastery and validate readiness with full-length SAT exam sessions.
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
              <h3 className="text-xl font-semibold mb-3">Lisa, grounded in context</h3>
              <p className="text-muted-foreground mb-4">
                Explanations stay focused on SAT-style question patterns and reasoning.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  References current question context
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Step-by-step reasoning support
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Clear follow-up guidance
                </li>
              </ul>
            </Card>

            <Card>
              <Clock className="w-10 h-10 mb-4" />
              <h3 className="text-xl font-semibold mb-3">Practice sessions that fit life</h3>
              <p className="text-muted-foreground mb-4">
                15-60 minute sessions that adapt to your schedule.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Quick 15-min drills
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Section-specific practice
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Pause and resume anytime
                </li>
              </ul>
            </Card>

            <Card>
              <BarChart3 className="w-10 h-10 mb-4" />
              <h3 className="text-xl font-semibold mb-3">Progress visibility for families</h3>
              <p className="text-muted-foreground mb-4">
                Clear progress snapshots and next-step priorities without overwhelming dashboards.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Topic and skill breakdowns
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Linked guardian summary view
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Calendar planning access
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
              <h2 className="text-3xl font-bold mb-8">What you can track today</h2>
              <div className="space-y-6">
                <Card className="bg-secondary">
                  <div className="font-medium mb-1">Practice consistency</div>
                  <div className="text-sm text-muted-foreground">Session count, time spent, and recent accuracy trends.</div>
                </Card>

                <Card className="bg-secondary">
                  <div className="font-medium mb-1">Mastery progression</div>
                  <div className="text-sm text-muted-foreground">Skill and domain status across Math and Reading & Writing.</div>
                </Card>

                <Card className="bg-secondary">
                  <div className="font-medium mb-1">Full-length exam outcomes</div>
                  <div className="text-sm text-muted-foreground">Module-level results and score projection data after completion.</div>
                </Card>
              </div>
            </div>

            <div>
              <h2 className="text-3xl font-bold mb-8">Who Lyceon is for</h2>
              <div className="space-y-6">
                <Card className="bg-secondary">
                  <div className="font-semibold mb-2">Students</div>
                  <p>
                    Build a daily SAT routine with adaptive question flow, tutor chat, review cycles, and full-length test readiness.
                  </p>
                </Card>

                <Card className="bg-secondary">
                  <div className="font-semibold mb-2">Guardians</div>
                  <p>
                    Link student accounts to monitor progress summaries and planning signals, with expanded visibility on paid plans.
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
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Start for free. Upgrade when ready.</h2>
            <p className="text-muted-foreground">
              No credit card required to get started
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <Card>
              <div className="mb-6">
                <h3 className="text-xl font-semibold mb-2">Free</h3>
                <div className="text-4xl font-bold mb-1">$0<span className="text-lg text-muted-foreground">/month</span></div>
                <p className="text-sm text-muted-foreground">Perfect to get started</p>
              </div>

              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  Up to 10 practice questions per day
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  Up to 5 tutor chat messages per day
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  Full-length SAT exam mode
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  Mastery and dashboard tracking
                </li>
              </ul>

              <Link href="/login">
                <a className="block w-full px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center" data-testid="button-get-started-free">
                  Get started free
                </a>
              </Link>
            </Card>

            <Card className="bg-foreground text-background relative overflow-hidden">
              <div className="absolute top-4 right-4 bg-secondary text-foreground text-xs px-3 py-1 rounded-full font-medium">
                Coming soon
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold mb-2">Pro · for serious prep</h3>
                <div className="text-4xl font-bold mb-1">TBD</div>
                <p className="text-sm opacity-70">Unlock everything</p>
              </div>

              <ul className="space-y-3 mb-8 opacity-90">
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span><strong>Unlimited</strong> practice questions</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span><strong>Unlimited</strong> tutor chat messages</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>Expanded guardian summary and calendar visibility</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>Priority feature access as plans roll out</span>
                </li>
              </ul>

              <a
                href="mailto:hello@lyceon.ai?subject=Pro%20Early%20Access"
                className="block w-full px-6 py-3 bg-background text-foreground rounded-lg font-medium hover:opacity-90 transition-opacity text-center"
                data-testid="button-join-waitlist"
              >
                Join early access list
              </a>
            </Card>
          </div>
        </Container>
      </section>

      <Container size="narrow">
        <Section id="faq" className="py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Frequently asked questions</h2>
          </div>

          <div className="space-y-4">
            <details className="bg-secondary border border-border rounded-2xl p-6 group">
              <summary className="font-semibold text-lg cursor-pointer flex items-center justify-between">
                How is tutor chat different from a generic chatbot?
                <ChevronDown className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-4 text-muted-foreground space-y-2">
                <p>
                  Tutor chat is built around SAT-style practice context, not open-ended generic chat.
                </p>
                <p>
                  Explanations focus on reasoning steps, common errors, and what to do next.
                </p>
              </div>
            </details>

            <details className="bg-secondary border border-border rounded-2xl p-6 group">
              <summary className="font-semibold text-lg cursor-pointer flex items-center justify-between">
                Do I need to add a credit card to start?
                <ChevronDown className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-4 text-muted-foreground">
                <p>
                  No. The free tier is available without entering card details.
                </p>
              </div>
            </details>

            <details className="bg-secondary border border-border rounded-2xl p-6 group">
              <summary className="font-semibold text-lg cursor-pointer flex items-center justify-between">
                What can guardians see?
                <ChevronDown className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-4 text-muted-foreground">
                <p>
                  Guardians can link student accounts and view progress summaries.
                  Student summary and calendar views are entitlement-gated for paid guardian access.
                </p>
              </div>
            </details>

            <details className="bg-secondary border border-border rounded-2xl p-6 group">
              <summary className="font-semibold text-lg cursor-pointer flex items-center justify-between">
                Do you include full-length exams and daily practice?
                <ChevronDown className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-4 text-muted-foreground">
                <p>
                  Yes. Lyceon supports both: daily adaptive practice and full-length timed SAT exams.
                </p>
                <p className="mt-2">
                  Use daily sessions to improve weak areas, then validate progress with full-length exam runs.
                </p>
              </div>
            </details>
          </div>
        </Section>
      </Container>

      <section className="bg-secondary border-t border-border py-16">
        <Container>
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Study Smarter, Score Higher
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
              Build momentum with adaptive practice, tutor chat, and full-length SAT simulations.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/practice">
                <a className="px-8 py-4 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center text-lg" data-testid="button-footer-start">
                  Start a free SAT session
                </a>
              </Link>
              <Link href="/login">
                <a className="px-8 py-4 bg-card border border-border rounded-lg font-medium hover:bg-secondary transition-colors text-center text-lg" data-testid="button-footer-signin">
                  Sign in to your dashboard
                </a>
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </PublicLayout>
  );
}
