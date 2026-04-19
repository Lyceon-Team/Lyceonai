import { Link } from 'wouter';
import { Calculator, ArrowRight, CheckCircle2, AlertTriangle, BookOpen } from 'lucide-react';
import PublicLayout from '@/components/layout/PublicLayout';
import { Container, Card, Breadcrumb, Section } from '@/components/layout/primitives';

const faqs = [
  {
    question: 'What math topics are on the Digital SAT?',
    answer: 'The Digital SAT Math section covers Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry/Trigonometry.',
  },
  {
    question: 'Can I use a calculator on SAT Math?',
    answer: 'Yes. The Digital SAT allows calculator use for the entire Math section, including Bluebook Desmos support.',
  },
  {
    question: 'How many math questions are on the Digital SAT?',
    answer: 'There are 44 total Math questions split into two 22-question modules, with 70 minutes total.',
  },
  {
    question: 'What are common SAT Math mistakes?',
    answer: 'Common misses include solving for the wrong expression, sign errors, rushing word-problem setup, and skipping answer checks.',
  },
  {
    question: 'How does Lyceon support math review?',
    answer: 'Lyceon provides adaptive practice plus step-by-step tutor guidance so students can identify patterns and correct repeat mistakes.',
  },
];

const topics = [
  { name: 'Linear Equations', difficulty: 'Foundation', coverage: '~13-15 questions' },
  { name: 'Systems of Equations', difficulty: 'Foundation', coverage: '~4-6 questions' },
  { name: 'Quadratic Equations', difficulty: 'Advanced', coverage: '~6-8 questions' },
  { name: 'Exponential Functions', difficulty: 'Advanced', coverage: '~3-4 questions' },
  { name: 'Ratios & Percentages', difficulty: 'Data Analysis', coverage: '~5-7 questions' },
  { name: 'Statistics & Probability', difficulty: 'Data Analysis', coverage: '~4-6 questions' },
  { name: 'Geometry (Area, Volume)', difficulty: 'Geometry', coverage: '~3-5 questions' },
  { name: 'Trigonometry', difficulty: 'Geometry', coverage: '~2-3 questions' },
];

export default function DigitalSATMathPage() {
  return (
    <PublicLayout>
      <Container>
        <Breadcrumb items={[
          { label: 'Home', href: '/' },
          { label: 'Digital SAT', href: '/digital-sat' },
          { label: 'Math' },
        ]} className="pt-8" />

        <div className="flex items-center gap-4 pt-8 mb-6">
          <div className="p-3 bg-secondary rounded-xl">
            <Calculator className="w-8 h-8 text-foreground" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">
            SAT Math Prep
          </h1>
        </div>

        <p className="text-xl text-muted-foreground mb-12 leading-relaxed max-w-3xl">
          The Digital SAT Math section tests algebra, advanced math, data analysis, and geometry. With calculator access on all questions, execution and review discipline matter as much as concept knowledge.
        </p>

        <Section title="What's Tested on SAT Math">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold">Topic</th>
                  <th className="text-left py-3 px-4 font-semibold">Category</th>
                  <th className="text-left py-3 px-4 font-semibold">Typical Coverage</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((topic, index) => (
                  <tr key={index} className="border-b border-border">
                    <td className="py-3 px-4">{topic.name}</td>
                    <td className="py-3 px-4 text-muted-foreground">{topic.difficulty}</td>
                    <td className="py-3 px-4 text-muted-foreground">{topic.coverage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Common SAT Math Mistakes to Avoid">
          <div className="space-y-4">
            <Card className="flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">Not reading the full question</h3>
                <p className="text-muted-foreground">Many students solve for x when the question asks for a transformed expression. Re-check the prompt before choosing.</p>
              </div>
            </Card>
            <Card className="flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">Sign errors in algebra</h3>
                <p className="text-muted-foreground">Distributing negatives incorrectly is a common point drop. Slow down through sign-sensitive steps.</p>
              </div>
            </Card>
            <Card className="flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold mb-1">Rushing through word problems</h3>
                <p className="text-muted-foreground">Translate text into equations deliberately. Define knowns and unknowns before solving.</p>
              </div>
            </Card>
          </div>
          <div className="mt-4">
            <Link href="/blog/common-sat-math-algebra-mistakes">
              <a className="text-sm font-medium underline underline-offset-2">
                Read more: Common SAT Math Algebra Mistakes
              </a>
            </Link>
          </div>
        </Section>

        <Section title="Effective SAT Math Practice Strategies">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <p><strong>Practice adaptively</strong> so question difficulty stays close to your current level.</p>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <p><strong>Review every miss</strong> and identify the exact reasoning step that failed.</p>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <p><strong>Use calculator intentionally</strong> for graphing, checking, and reducing arithmetic slips.</p>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <p><strong>Time selected sets</strong> to build pacing confidence for module constraints.</p>
            </div>
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
          <div className="grid md:grid-cols-2 gap-6">
            <Card hover>
              <Link href="/digital-sat/reading-writing">
                <a className="block">
                  <div className="flex items-center gap-3 mb-3">
                    <BookOpen className="w-6 h-6" />
                    <h3 className="font-semibold">SAT Reading & Writing</h3>
                  </div>
                  <p className="text-muted-foreground text-sm mb-3">
                    Build vocabulary, grammar, and comprehension fluency for the other half of the SAT.
                  </p>
                  <span className="inline-flex items-center text-sm font-medium">
                    Explore Reading & Writing <ArrowRight className="w-4 h-4 ml-1" />
                  </span>
                </a>
              </Link>
            </Card>
            <Card className="text-center flex flex-col justify-center">
              <h3 className="font-semibold mb-3">Ready to Practice?</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Start math practice with adaptive flow and guided review.
              </p>
              <Link href="/signup">
                <a className="inline-block px-5 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90">
                  Start Free Practice
                </a>
              </Link>
            </Card>
          </div>
        </Section>
      </Container>
    </PublicLayout>
  );
}
