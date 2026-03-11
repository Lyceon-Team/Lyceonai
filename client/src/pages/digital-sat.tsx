import { Link } from 'wouter';
import { SEO, JsonLd, createBreadcrumbJsonLd, createFaqJsonLd, organizationJsonLd, websiteJsonLd } from '@/components/SEO';
import { BookOpen, Calculator, ArrowRight, Brain, Target, Clock, CheckCircle2 } from 'lucide-react';
import PublicLayout from '@/components/layout/PublicLayout';
import { Container, Hero, Card, Breadcrumb, Section } from '@/components/layout/primitives';

const faqs = [
  {
    question: 'What is the Digital SAT?',
    answer: 'The Digital SAT is the computer-adaptive SAT format. It is about 2 hours long with two sections: Reading and Writing, and Math.',
  },
  {
    question: 'How is the Digital SAT different from the paper SAT?',
    answer: 'It is shorter, adaptive by module, calculator-allowed across all Math questions, and built for digital delivery.',
  },
  {
    question: 'Does Lyceon include full-length exams?',
    answer: 'Yes. Lyceon includes full-length timed SAT exam sessions alongside daily adaptive practice and review.',
  },
  {
    question: 'How does mastery tracking work in Lyceon?',
    answer: 'Lyceon tracks skill and domain performance so students can see weak areas, improving areas, and proficiency progression over time.',
  },
  {
    question: 'How does tutor chat work?',
    answer: 'Tutor chat provides step-by-step guidance tied to SAT-style question context. It is designed to support reasoning and review, not to bypass learning.',
  },
  {
    question: 'What is free vs paid?',
    answer: 'Free includes daily limits (10 practice questions and 5 tutor chat messages). Paid plans remove those limits and expand guardian visibility features.',
  },
];

export default function DigitalSATPage() {
  return (
    <PublicLayout>
      <SEO
        title="Digital SAT Prep - Study Smarter, Score Higher"
        description="Prepare for the Digital SAT with adaptive practice, full-length exams, mastery tracking, and tutor chat."
        canonical="https://lyceon.ai/digital-sat"
      />
      <JsonLd data={organizationJsonLd} />
      <JsonLd data={websiteJsonLd} />
      <JsonLd data={createBreadcrumbJsonLd([
        { name: 'Home', url: 'https://lyceon.ai' },
        { name: 'Digital SAT', url: 'https://lyceon.ai/digital-sat' },
      ])} />
      <JsonLd data={createFaqJsonLd(faqs)} />

      <Container>
        <Breadcrumb items={[
          { label: 'Home', href: '/' },
          { label: 'Digital SAT' },
        ]} className="pt-8" />

        <Hero
          title="Digital SAT Prep: Study Smarter, Score Higher"
          subtitle="Build consistency with adaptive SAT-style practice, full-length test simulation, and clear mastery tracking."
        />

        <Section title="Choose Your Focus Area">
          <div className="grid md:grid-cols-2 gap-6">
            <Link href="/digital-sat/math">
              <a className="block">
                <Card hover className="h-full">
                  <Calculator className="w-10 h-10 text-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">SAT Math</h3>
                  <p className="text-muted-foreground mb-4">
                    Algebra, geometry, data analysis, and advanced math with adaptive difficulty.
                  </p>
                  <span className="inline-flex items-center text-sm font-medium text-foreground">
                    Explore Math Prep <ArrowRight className="w-4 h-4 ml-1" />
                  </span>
                </Card>
              </a>
            </Link>
            <Link href="/digital-sat/reading-writing">
              <a className="block">
                <Card hover className="h-full">
                  <BookOpen className="w-10 h-10 text-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">SAT Reading & Writing</h3>
                  <p className="text-muted-foreground mb-4">
                    Reading comprehension, grammar, and rhetorical analysis with targeted practice.
                  </p>
                  <span className="inline-flex items-center text-sm font-medium text-foreground">
                    Explore Reading & Writing <ArrowRight className="w-4 h-4 ml-1" />
                  </span>
                </Card>
              </a>
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
                <h3 className="font-semibold mb-1">Adaptive Practice</h3>
                <p className="text-muted-foreground">
                  Question selection adjusts by performance so students can work at the right challenge level.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                <Clock className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Full-Length Exam Simulation</h3>
                <p className="text-muted-foreground">
                  Students can run complete timed SAT sessions to validate pacing and readiness.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                <Brain className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Tutor Chat Guidance</h3>
                <p className="text-muted-foreground">
                  Tutor chat gives step-by-step explanations tied to SAT-style question context.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Scoring, Mastery, and Planning Clarity">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              'Digital SAT scoring explanation and adaptive module behavior',
              'Skill and domain mastery status tracking',
              'Guardian-linked visibility for student summaries',
              'Calendar and planning views for ongoing prep',
              'Daily limits on free plan with paid unlimited usage',
              'Trust and policy pages with implementation-backed language',
            ].map((topic) => (
              <div key={topic} className="flex items-center gap-3 p-4 bg-secondary/50 rounded-xl">
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
                <p className="text-muted-foreground">{faq.answer}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section>
          <Card className="text-center">
            <h2 className="text-2xl font-semibold mb-4">Ready to Start Practicing?</h2>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
              Start free, track progress, and upgrade only when you need unlimited usage.
            </p>
            <Link href="/signup">
              <a className="inline-block px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity">
                Get Started Free
              </a>
            </Link>
          </Card>
        </Section>
      </Container>
    </PublicLayout>
  );
}
