import { Link } from "wouter";
import { BookOpen, ArrowRight, CheckCircle2, Calculator } from "lucide-react";
import PublicLayout from "@/components/layout/PublicLayout";
import {
  DIGITAL_SAT_READING_WRITING_FAQS,
  faqParagraphs,
} from "@shared/seo/public-meta";
import { CB_READING_WRITING } from "@shared/seo/sources";
import { SourceLinks } from "@/components/common/source-links";
import {
  Container,
  Breadcrumb,
  Card,
  Section,
} from "@/components/layout/primitives";

// One copy of this FAQ: the page renders it and its FAQPage JSON-LD is built from it (F1).
const faqs = DIGITAL_SAT_READING_WRITING_FAQS;

/**
 * The four Reading and Writing content domains, as the College Board names them
 * (CB_READING_WRITING).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 rule 3, §5 F6] | @implemented [2026-10-03]
 * | plain English: replaces a per-question-type table of estimated counts that the College
 * Board does not publish (several were wrong). Names only, no counts.
 */
const READING_WRITING_DOMAINS = [
  "Information and Ideas",
  "Craft and Structure",
  "Expression of Ideas",
  "Standard English Conventions",
] as const;

export default function DigitalSATReadingWritingPage() {
  return (
    <PublicLayout>
      <Container>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Digital SAT", href: "/digital-sat" },
            { label: "Reading & Writing" },
          ]}
          className="pt-8"
        />

        <div className="flex items-center gap-4 pt-8 mb-6">
          <div className="p-3 bg-secondary rounded-xl">
            <BookOpen className="w-8 h-8 text-foreground" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">
            SAT Reading & Writing Prep
          </h1>
        </div>

        <div className="mb-12 max-w-3xl">
          <p className="text-xl text-muted-foreground leading-relaxed">
            Each Reading and Writing question has its own short passage of 25 to
            150 words, across four content areas.
          </p>
          <SourceLinks sources={[CB_READING_WRITING]} />
        </div>

        <Section title="What's Tested on SAT Reading & Writing">
          <ul className="grid sm:grid-cols-2 gap-4">
            {READING_WRITING_DOMAINS.map((domain) => (
              <li
                key={domain}
                className="flex items-center gap-3 p-4 bg-secondary/50 rounded-xl"
              >
                <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0" />
                <span>{domain}</span>
              </li>
            ))}
          </ul>
          <SourceLinks sources={[CB_READING_WRITING]} />
        </Section>

        <Section title="Strategies for SAT Reading Success">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p>
                  <strong>Read passage first, then question.</strong> Short
                  passages are fast enough to scan for intent before evaluating
                  options.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p>
                  <strong>Anchor in evidence.</strong> Every correct answer
                  should map to explicit wording or logic in the passage.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p>
                  <strong>Use transitions as clues.</strong> Contrast and
                  cause-effect language often points to the strongest option.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p>
                  <strong>Eliminate aggressively.</strong> Remove unsupported,
                  extreme, or partially-correct answers first.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Grammar Rules Worth Reviewing">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <h3 className="font-semibold mb-2">Subject-Verb Agreement</h3>
              <p className="text-sm text-muted-foreground">
                Singular subjects require singular verbs, even when phrases
                separate them.
              </p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Pronoun Clarity</h3>
              <p className="text-sm text-muted-foreground">
                Pronouns must clearly point to a specific noun reference.
              </p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Comma Usage</h3>
              <p className="text-sm text-muted-foreground">
                Know required commas and avoid unnecessary punctuation
                insertions.
              </p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Verb Tense Consistency</h3>
              <p className="text-sm text-muted-foreground">
                Maintain tense coherence unless the context requires a
                deliberate shift.
              </p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Modifier Placement</h3>
              <p className="text-sm text-muted-foreground">
                Place modifiers close to what they describe to avoid ambiguity.
              </p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Parallel Structure</h3>
              <p className="text-sm text-muted-foreground">
                Lists and comparisons should follow consistent grammatical form.
              </p>
            </Card>
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
              <Link href="/digital-sat/math" className="block">
                <div className="flex items-center gap-3 mb-3">
                  <Calculator className="w-6 h-6" />
                  <h3 className="font-semibold">SAT Math</h3>
                </div>
                <p className="text-muted-foreground text-sm mb-3">
                  Algebra, Advanced Math, Problem-Solving and Data Analysis, and
                  Geometry and Trigonometry.
                </p>
                <span className="inline-flex items-center text-sm font-medium">
                  Explore Math Prep <ArrowRight className="w-4 h-4 ml-1" />
                </span>
              </Link>
            </Card>
            <Card className="text-center flex flex-col justify-center">
              <h3 className="font-semibold mb-3">Ready to Practice?</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Start reading and writing practice with worked explanations.
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
