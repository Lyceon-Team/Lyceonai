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

type DemoState = 'idle' | 'thinking' | 'answered';
type HeroVariant = 'A' | 'B';

export default function HomePage() {
  const [demoState, setDemoState] = useState<DemoState>('idle');
  const [variant, setVariant] = useState<HeroVariant | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("landing_hero_variant");
      console.debug("[A/B Test] Retrieved from localStorage:", saved);
      if (saved === "A" || saved === "B") {
        console.debug("[A/B Test] Using saved variant:", saved);
        setVariant(saved);
        return;
      }
      const chosen: HeroVariant = Math.random() < 0.5 ? "A" : "B";
      console.debug("[A/B Test] Assigned new variant:", chosen);
      window.localStorage.setItem("landing_hero_variant", chosen);
      setVariant(chosen);
    } catch (err) {
      console.error("[A/B Test] localStorage error:", err);
      setVariant("A");
    }
  }, []);

  const triggerDemo = () => {
    setDemoState('thinking');
    setTimeout(() => {
      setDemoState('answered');
      setTimeout(() => setDemoState('idle'), 8000);
    }, 2000);
  };

  const trackCtaClick = (ctaText: string) => {
    // Debug logging for A/B test variant tracking
    console.debug("hero_cta_click", { variant, ctaText });
    console.debug("[A/B Test] Current localStorage:", window.localStorage.getItem("landing_hero_variant"));
  };

  return (
    <PublicLayout>
      <SEO
        title="Lyceon - AI SAT Tutor | Personalized Digital SAT Prep"
        description="Master the Digital SAT with AI-powered tutoring. Get unlimited practice questions, personalized explanations, and adaptive learning. Free to start."
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
              ) : variant === 'A' ? (
                <>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground mb-4 block">
                    Lyceon · AI SAT Tutor
                  </span>
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                    An AI SAT tutor that{" "}
                    <span className="text-foreground">actually knows the test</span>
                  </h1>
                  <p className="text-lg mb-4">
                    Real SAT-style questions. Step-by-step explanations. Gemini-powered reasoning.
                  </p>
                  <p className="text-muted-foreground mb-8">
                    Practice smarter with an AI tutor grounded in official SAT content—not generic advice.
                  </p>
                </>
              ) : (
                <>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground mb-4 block">
                    Lyceon · AI SAT Tutor
                  </span>
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
                    Meet your AI SAT tutor for the{" "}
                    <span className="text-foreground">digital SAT</span>
                  </h1>
                  <p className="text-lg mb-4">
                    Get step-by-step help with real SAT-style questions. Powered by Gemini for reasoning.
                  </p>
                  <p className="text-muted-foreground mb-8">
                    Master the digital SAT with an AI tutor that's grounded in official content.
                  </p>
                </>
              )}

              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <Link href="/practice">
                  <a 
                    className="px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center" 
                    data-testid="button-start-demo"
                    onClick={() => trackCtaClick(variant === 'A' ? "Start a free SAT session" : "Try the SAT copilot for free")}
                  >
                    {variant === 'A' ? "Start a free SAT session" : "Try the SAT copilot for free"}
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
                  <div className="text-2xl font-bold">2,500+</div>
                  <div className="text-sm text-muted-foreground">Questions mastered</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">+120</div>
                  <div className="text-sm text-muted-foreground">Avg. score gain</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">15k</div>
                  <div className="text-sm text-muted-foreground">Sessions this month</div>
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
                    {demoState === 'idle' && (
                      <div className="text-sm text-muted-foreground italic">
                        Sign in to start practicing with your AI tutor
                      </div>
                    )}
                    
                    {demoState === 'thinking' && (
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

                    {demoState === 'answered' && (
                      <div className="bg-secondary border border-border rounded-lg p-4 text-sm space-y-3">
                        <p>Let me break this down step by step:</p>
                        <ol className="space-y-2">
                          <li className="flex gap-2">
                            <span className="font-medium">1.</span>
                            <span>First, identify what the question is asking about the passage structure.</span>
                          </li>
                          <li className="flex gap-2">
                            <span className="font-medium">2.</span>
                            <span>Notice the transition word in line 12 that signals a contrast.</span>
                          </li>
                          <li className="flex gap-2">
                            <span className="font-medium">3.</span>
                            <span>Option B correctly identifies this rhetorical shift.</span>
                          </li>
                        </ol>
                        <div className="bg-background border border-border rounded p-2 mt-3">
                          <p className="text-xs font-medium">
                            Key takeaway: Look for transition words to understand passage structure.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Gemini powered
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
              <span className="text-sm">Grounded in official SAT-style practice content</span>
            </div>
            <div className="flex items-center justify-center md:justify-start gap-3">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">Privacy first—no data selling, ever</span>
            </div>
            <div className="flex items-center justify-center md:justify-start gap-3">
              <Brain className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">Backed by Gemini for reasoning, tuned for SAT prep</span>
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
                Take a quick diagnostic to identify your strengths and weak spots. No 3-hour commitment required.
              </p>
            </Card>

            <Card className="relative">
              <div className="absolute -top-4 left-6 w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center font-bold text-sm">
                2
              </div>
              <MessageSquare className="w-10 h-10 mb-4 mt-2" />
              <h3 className="text-xl font-semibold mb-3">Practice with a real tutor feel</h3>
              <p className="text-muted-foreground">
                Get instant, personalized explanations that adapt to your learning style—just like a $100/hr tutor.
              </p>
            </Card>

            <Card className="relative">
              <div className="absolute -top-4 left-6 w-8 h-8 bg-foreground text-background rounded-full flex items-center justify-center font-bold text-sm">
                3
              </div>
              <TrendingUp className="w-10 h-10 mb-4 mt-2" />
              <h3 className="text-xl font-semibold mb-3">See exactly where you're improving</h3>
              <p className="text-muted-foreground">
                Track progress by topic, difficulty, and time. Know what to focus on before test day.
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
              Somewhere between flashcards and full-length tests
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card>
              <MessageSquare className="w-10 h-10 mb-4" />
              <h3 className="text-xl font-semibold mb-3">Chat that's actually about the SAT</h3>
              <p className="text-muted-foreground mb-4">
                Not generic tutoring. Every explanation is grounded in real SAT question patterns and strategies.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Cites specific question IDs
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  No hallucinated examples
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Clear next steps after every answer
                </li>
              </ul>
            </Card>

            <Card>
              <Clock className="w-10 h-10 mb-4" />
              <h3 className="text-xl font-semibold mb-3">Practice sessions that fit life</h3>
              <p className="text-muted-foreground mb-4">
                15–60 minute sessions that adapt to your schedule. Study between classes, on the bus, or before bed.
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
              <h3 className="text-xl font-semibold mb-3">A dashboard parents actually understand</h3>
              <p className="text-muted-foreground mb-4">
                Clear insights into progress, strengths, and what to work on next—without a PhD in test prep.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Topic-level breakdowns
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Weekly progress reports
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Estimated score ranges
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
              <h2 className="text-3xl font-bold mb-8">Real results from real students</h2>
              <div className="space-y-6">
                <Card className="bg-secondary">
                  <div className="text-4xl font-bold mb-2">+120</div>
                  <div className="font-medium mb-1">Average score improvement</div>
                  <div className="text-sm text-muted-foreground">Based on students who practiced 3x/week for 6 weeks</div>
                </Card>

                <Card className="bg-secondary">
                  <div className="text-4xl font-bold mb-2">4.2x</div>
                  <div className="font-medium mb-1">More consistent practice</div>
                  <div className="text-sm text-muted-foreground">Students practice more often vs. traditional methods</div>
                </Card>

                <Card className="bg-secondary">
                  <div className="text-4xl font-bold mb-2">89%</div>
                  <div className="font-medium mb-1">Would recommend to a friend</div>
                  <div className="text-sm text-muted-foreground">From our post-session surveys</div>
                </Card>
              </div>
            </div>

            <div>
              <h2 className="text-3xl font-bold mb-8">What students and parents say</h2>
              <div className="space-y-6">
                <Card className="bg-secondary">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center flex-shrink-0">
                      <span className="text-xl">👨‍🎓</span>
                    </div>
                    <div>
                      <div className="font-semibold">Alex M., Junior</div>
                      <div className="text-sm text-muted-foreground">1480 → 1560</div>
                    </div>
                  </div>
                  <p>
                    "I actually get why I got questions wrong now. The explanations aren't just 'the answer is C because...' They break down my thinking and show me the pattern. Game changer."
                  </p>
                </Card>

                <Card className="bg-secondary">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center flex-shrink-0">
                      <span className="text-xl">👩</span>
                    </div>
                    <div>
                      <div className="font-semibold">Sarah K., Parent</div>
                      <div className="text-sm text-muted-foreground">Mother of two test-takers</div>
                    </div>
                  </div>
                  <p>
                    "Finally, a platform I can actually understand. I can see where my daughter is struggling and what she's working on—without having to decipher charts or pay for weekly tutor updates."
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
                  Daily tutor sessions (fair-use)
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  Core question bank access
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  Basic progress insights
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  Section-specific practice
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
                  <span><strong>Unlimited</strong> tutor sessions</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>Advanced analytics &amp; predictions</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>Parent/counselor dashboards</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 opacity-70" />
                  <span>Full question bank (2,500+ Qs)</span>
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
                Is this just ChatGPT with a different logo?
                <ChevronDown className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-4 text-muted-foreground space-y-2">
                <p>
                  Nope. While we use Gemini (not ChatGPT), the key difference is our tutor is <strong className="text-foreground">grounded in real SAT content</strong>. 
                  It won't make up examples or give generic study advice.
                </p>
                <p>
                  Every explanation references specific question types, patterns, and strategies that actually appear on the test. 
                  It's like having a tutor who's taken the SAT 100 times.
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
                  No. The free tier is truly free—no trial that auto-converts, no hidden charges. 
                  Just sign up with your email and start practicing.
                </p>
              </div>
            </details>

            <details className="bg-secondary border border-border rounded-2xl p-6 group">
              <summary className="font-semibold text-lg cursor-pointer flex items-center justify-between">
                Can parents and tutors see progress?
                <ChevronDown className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-4 text-muted-foreground">
                <p>
                  Yes. Students have a dashboard showing their progress, and parents can view the same data (with the student's permission). 
                  Our Pro plan (coming soon) will add more detailed parent/counselor views and weekly reports.
                </p>
              </div>
            </details>

            <details className="bg-secondary border border-border rounded-2xl p-6 group">
              <summary className="font-semibold text-lg cursor-pointer flex items-center justify-between">
                Does this replace full-length practice tests?
                <ChevronDown className="w-5 h-5 text-muted-foreground group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-4 text-muted-foreground">
                <p>
                  No, and it's not supposed to. We're designed for <strong className="text-foreground">daily practice and concept reinforcement</strong>—the stuff 
                  you do between full-length tests.
                </p>
                <p className="mt-2">
                  Think of us as the training sessions. Official practice tests are the scrimmages. Both matter.
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
              Ready to make your next practice session actually count?
            </h2>
            <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
              Join thousands of students who are studying smarter with AI-powered SAT prep.
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
