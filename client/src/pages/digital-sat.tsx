import { Link } from "wouter";
import {
  BookOpen,
  Calculator,
  ArrowRight,
  Brain,
  Target,
  Clock,
  CheckCircle2,
} from "lucide-react";
import PublicLayout from "@/components/layout/PublicLayout";
import { DIGITAL_SAT_FAQS, faqParagraphs } from "@shared/seo/public-meta";
import { SourceLinks } from "@/components/common/source-links";
import {
  Container,
  Hero,
  Card,
  Breadcrumb,
  Section,
} from "@/components/layout/primitives";

// One copy of this FAQ: the page renders it and its FAQPage JSON-LD is built from it (F1).
const faqs = DIGITAL_SAT_FAQS;

export default function DigitalSATPage() {
  return (
    <PublicLayout>
      <Container>
        <Breadcrumb
          items={[{ label: "Home", href: "/" }, { label: "Digital SAT" }]}
          className="pt-8"
        />

        <Hero
          title="Digital SAT Prep: Study Smarter, Score Higher"
          subtitle="Build a steady routine with SAT-style practice and progress tracking. Full-length practice tests on paid plans."
        />

        <Section title="Choose Your Focus Area">
          <div className="grid md:grid-cols-2 gap-6">
            <Link href="/digital-sat/math" className="block">
              <Card hover className="h-full">
                <Calculator className="w-10 h-10 text-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">SAT Math</h3>
                <p className="text-muted-foreground mb-4">
                  Algebra, Advanced Math, Problem-Solving and Data Analysis, and
                  Geometry and Trigonometry.
                </p>
                <span className="inline-flex items-center text-sm font-medium text-foreground">
                  Explore Math Prep <ArrowRight className="w-4 h-4 ml-1" />
                </span>
              </Card>
            </Link>
            <Link href="/digital-sat/reading-writing" className="block">
              <Card hover className="h-full">
                <BookOpen className="w-10 h-10 text-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">
                  SAT Reading & Writing
                </h3>
                <p className="text-muted-foreground mb-4">
                  Reading comprehension, grammar, and rhetorical analysis with
                  targeted practice.
                </p>
                <span className="inline-flex items-center text-sm font-medium text-foreground">
                  Explore Reading & Writing{" "}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </span>
              </Card>
            </Link>
          </div>
        </Section>

        <Section title="What Lyceon Supports Today">
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                <Target className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Study Plan</h3>
                <p className="text-muted-foreground">
                  A study plan that focuses on your weak areas (paid plans).
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                <Clock className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">
                  Full-Length Practice Tests (paid plans)
                </h3>
                <p className="text-muted-foreground">
                  Take timed practice tests in the same structure as the Digital
                  SAT.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                <Brain className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">AI Tutor (paid plans)</h3>
                <p className="text-muted-foreground">
                  AI tutor for step-by-step help.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Progress and Planning">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              "Progress by section (skill-level detail on paid plans)",
              "Read-only progress view for a linked parent or guardian (paid plans)",
              "A study plan that focuses on your weak areas (paid plans)",
              "Free daily practice, with no daily limit on paid plans",
            ].map((topic) => (
              <div
                key={topic}
                className="flex items-center gap-3 p-4 bg-secondary/50 rounded-xl"
              >
                <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0" />
                <span>{topic}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Frequently Asked Questions">
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <Card key={index}>
                <h3 className="font-semibold mb-2">{faq.question}</h3>
                <div className="text-muted-foreground space-y-2">
                  {faqParagraphs(faq.answer).map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
                <SourceLinks sources={faq.sources} />
              </Card>
            ))}
          </div>
        </Section>

        <Section>
          <Card className="text-center">
            <h2 className="text-2xl font-semibold mb-4">
              Ready to Start Practicing?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
              Start free. Upgrade for full-length practice tests, the AI tutor
              and a study plan.
            </p>
            <Link
              href="/signup"
              className="inline-block px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Get Started Free
            </Link>
          </Card>
        </Section>
      </Container>
    </PublicLayout>
  );
}
