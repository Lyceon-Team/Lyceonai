import { Link } from "wouter";
import {
  Calculator,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
} from "lucide-react";
import PublicLayout from "@/components/layout/PublicLayout";
import { DIGITAL_SAT_MATH_FAQS, faqParagraphs } from "@shared/seo/public-meta";
import { CB_MATH } from "@shared/seo/sources";
import { SourceLinks } from "@/components/common/source-links";
import {
  Container,
  Card,
  Breadcrumb,
  Section,
} from "@/components/layout/primitives";

// One copy of this FAQ: the page renders it and its FAQPage JSON-LD is built from it (F1).
const faqs = DIGITAL_SAT_MATH_FAQS;

/**
 * The four Math content domains, as the College Board names them (CB_MATH).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 rule 3, §5 F6] | @implemented [2026-10-03]
 * | plain English: replaces a per-topic table of estimated question counts that the College
 * Board does not publish (several were wrong). Names only, no counts.
 */
const MATH_DOMAINS = [
  "Algebra",
  "Advanced Math",
  "Problem-Solving and Data Analysis",
  "Geometry and Trigonometry",
] as const;

export default function DigitalSATMathPage() {
  return (
    <PublicLayout>
      <Container>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Digital SAT", href: "/digital-sat" },
            { label: "Math" },
          ]}
          className="pt-8"
        />

        <div className="flex items-center gap-4 pt-8 mb-6">
          <div className="p-3 bg-secondary rounded-xl">
            <Calculator className="w-8 h-8 text-foreground" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">
            SAT Math Prep
          </h1>
        </div>

        <div className="mb-12 max-w-3xl">
          <p className="text-xl text-muted-foreground leading-relaxed">
            The Digital SAT Math section covers Algebra, Advanced Math,
            Problem-Solving and Data Analysis, and Geometry and Trigonometry.
          </p>
          <SourceLinks sources={[CB_MATH]} />
        </div>

        <Section title="What's Tested on SAT Math">
          <ul className="grid sm:grid-cols-2 gap-4">
            {MATH_DOMAINS.map((domain) => (
              <li
                key={domain}
                className="flex items-center gap-3 p-4 bg-secondary/50 rounded-xl"
              >
                <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0" />
                <span>{domain}</span>
              </li>
            ))}
          </ul>
          <SourceLinks sources={[CB_MATH]} />
        </Section>

        <Section title="Common SAT Math Mistakes to Avoid">
          <div className="space-y-4">
            <Card className="flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">
                  Not reading the full question
                </h3>
                <p className="text-muted-foreground">
                  It's easy to solve for x when the question asks for a
                  transformed expression. Re-check the prompt before choosing.
                </p>
              </div>
            </Card>
            <Card className="flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">Sign errors in algebra</h3>
                <p className="text-muted-foreground">
                  Distributing negatives incorrectly is a common point drop.
                  Slow down through sign-sensitive steps.
                </p>
              </div>
            </Card>
            <Card className="flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">
                  Rushing through word problems
                </h3>
                <p className="text-muted-foreground">
                  Translate text into equations deliberately. Define knowns and
                  unknowns before solving.
                </p>
              </div>
            </Card>
          </div>
          <div className="mt-4">
            <Link
              href="/blog/common-sat-math-algebra-mistakes"
              className="text-sm font-medium underline underline-offset-2"
            >
              Read more: Common Digital SAT Algebra Mistakes
            </Link>
          </div>
        </Section>

        <Section title="Effective SAT Math Practice Strategies">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <p>
                <strong>Practise at the right level:</strong> questions that
                challenge you without overwhelming you.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <p>
                <strong>Review every miss</strong> and identify the exact
                reasoning step that failed.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <p>
                <strong>Use calculator intentionally</strong> for graphing,
                checking, and reducing arithmetic slips.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <p>
                <strong>Time selected sets</strong> to build pacing confidence
                for module constraints.
              </p>
            </div>
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
          <div className="grid md:grid-cols-2 gap-6">
            <Card hover>
              <Link href="/digital-sat/reading-writing" className="block">
                <div className="flex items-center gap-3 mb-3">
                  <BookOpen className="w-6 h-6" />
                  <h3 className="font-semibold">SAT Reading & Writing</h3>
                </div>
                <p className="text-muted-foreground text-sm mb-3">
                  Build vocabulary, grammar, and comprehension fluency for the
                  other half of the SAT.
                </p>
                <span className="inline-flex items-center text-sm font-medium">
                  Explore Reading & Writing{" "}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </span>
              </Link>
            </Card>
            <Card className="text-center flex flex-col justify-center">
              <h3 className="font-semibold mb-3">Ready to Practice?</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Start math practice with worked explanations.
              </p>
              <Link
                href="/signup"
                className="inline-block px-5 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90"
              >
                Start Free Practice
              </Link>
            </Card>
          </div>
        </Section>
      </Container>
    </PublicLayout>
  );
}
