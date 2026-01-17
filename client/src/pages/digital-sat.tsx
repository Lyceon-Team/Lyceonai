import { Link } from 'wouter';
import { SEO, JsonLd, createBreadcrumbJsonLd, createFaqJsonLd, organizationJsonLd, websiteJsonLd } from '@/components/SEO';
import { BookOpen, Calculator, ArrowRight, Brain, Target, Clock, CheckCircle2 } from 'lucide-react';
import PublicLayout from '@/components/layout/PublicLayout';
import { Container, Hero, Card, Breadcrumb, Section } from '@/components/layout/primitives';

const faqs = [
  {
    question: 'What is the Digital SAT?',
    answer: 'The Digital SAT is the new computer-adaptive version of the SAT, replacing the paper-based test. It features shorter sections, adaptive difficulty, and results delivered faster. The test is approximately 2 hours long with two sections: Reading and Writing, and Math.',
  },
  {
    question: 'How is the Digital SAT different from the paper SAT?',
    answer: 'The Digital SAT is shorter (2 hours vs 3 hours), uses a computer-adaptive format where difficulty adjusts based on your performance, allows a calculator for the entire Math section, and delivers scores within days instead of weeks.',
  },
  {
    question: 'What is an AI SAT tutor?',
    answer: 'An AI SAT tutor is an intelligent tutoring system that provides personalized explanations, adapts to your learning style, and helps you understand not just the correct answer but the reasoning behind it. Unlike generic AI chatbots, a specialized AI SAT tutor is trained on actual SAT content and strategies.',
  },
  {
    question: 'How many questions are on the Digital SAT?',
    answer: 'The Digital SAT has 98 questions total: 54 questions in Reading and Writing (split into two 27-question modules) and 44 questions in Math (split into two 22-question modules). The test adapts based on your first-module performance.',
  },
  {
    question: 'Can I use a calculator on the Digital SAT?',
    answer: 'Yes! Unlike the paper SAT, you can use a calculator on the entire Math section of the Digital SAT. The Bluebook app also includes a built-in Desmos graphing calculator.',
  },
  {
    question: 'How does adaptive practice help SAT prep?',
    answer: 'Adaptive practice adjusts question difficulty based on your performance, ensuring you are always challenged at the right level. This leads to more efficient studying, faster score improvement, and better retention than practicing random questions.',
  },
];

export default function DigitalSATPage() {
  return (
    <PublicLayout>
      <SEO
        title="Digital SAT Prep - AI-Powered SAT Tutoring"
        description="Master the Digital SAT with personalized AI tutoring. Get unlimited practice questions, adaptive learning, and step-by-step explanations. Free to start."
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
          title="Digital SAT Prep: Master the Test with AI Tutoring"
          subtitle="The Digital SAT is here, and it requires a new approach to prep. Our AI-powered SAT tutor provides personalized practice, adaptive learning, and instant explanations—helping you improve faster than traditional methods."
        />

        <Section title="Choose Your Focus Area">
          <div className="grid md:grid-cols-2 gap-6">
            <Link href="/digital-sat/math">
              <a className="block">
                <Card hover className="h-full">
                  <Calculator className="w-10 h-10 text-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">SAT Math</h3>
                  <p className="text-muted-foreground mb-4">
                    Algebra, geometry, data analysis, and advanced math. Calculator allowed for all questions.
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
                    Reading comprehension, grammar, vocabulary in context, and rhetorical analysis.
                  </p>
                  <span className="inline-flex items-center text-sm font-medium text-foreground">
                    Explore Reading & Writing <ArrowRight className="w-4 h-4 ml-1" />
                  </span>
                </Card>
              </a>
            </Link>
          </div>
        </Section>

        <Section title="Why Use an AI SAT Tutor?">
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                <Brain className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Personalized Explanations</h3>
                <p className="text-muted-foreground">
                  Unlike answer keys that just show the correct answer, our AI tutor explains why your approach was wrong and guides you to understand the underlying concept.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                <Target className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Adaptive Difficulty</h3>
                <p className="text-muted-foreground">
                  Practice at just the right level. Our system adjusts question difficulty based on your performance, just like the real Digital SAT.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                <Clock className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">24/7 Availability</h3>
                <p className="text-muted-foreground">
                  Study whenever it fits your schedule. Get instant feedback and explanations without waiting for a human tutor.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="What You'll Practice">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              'Linear equations and systems',
              'Quadratic functions and equations',
              'Data analysis and statistics',
              'Geometry and trigonometry',
              'Reading comprehension',
              'Grammar and conventions',
              'Vocabulary in context',
              'Rhetorical analysis',
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
              Join thousands of students improving their SAT scores with AI-powered tutoring.
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
