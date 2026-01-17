import { Link } from 'wouter';
import { SEO, JsonLd, createBreadcrumbJsonLd, createFaqJsonLd } from '@/components/SEO';
import { BookOpen, ArrowRight, CheckCircle2, Calculator } from 'lucide-react';
import PublicLayout from '@/components/layout/PublicLayout';
import { Container, Breadcrumb, Card, Section } from '@/components/layout/primitives';

const faqs = [
  {
    question: 'What is tested on SAT Reading and Writing?',
    answer: 'The SAT Reading and Writing section tests four main skill areas: Craft and Structure (vocabulary, text structure, purpose), Information and Ideas (main idea, details, inferences), Standard English Conventions (grammar, punctuation), and Expression of Ideas (transitions, sentence combining, rhetorical synthesis).',
  },
  {
    question: 'How is Digital SAT Reading different from the paper test?',
    answer: 'The Digital SAT uses shorter passages (25-150 words each) with one question per passage, unlike the paper SAT which had longer passages with multiple questions. This makes the digital version faster-paced but tests the same core reading skills.',
  },
  {
    question: 'How many Reading and Writing questions are on the Digital SAT?',
    answer: 'There are 54 questions total in the Reading and Writing section, split into two 27-question modules. You have 32 minutes for each module (64 minutes total).',
  },
  {
    question: 'What vocabulary should I study for the SAT?',
    answer: 'Focus on academic vocabulary and words in context rather than obscure vocabulary lists. The SAT tests your ability to understand how words are used in passages, not memorization of definitions.',
  },
  {
    question: 'How can I improve my SAT Reading speed?',
    answer: 'Practice active reading: identify the main point quickly, pay attention to transition words, and answer based on evidence in the text rather than outside knowledge. With short passages on the Digital SAT, you can often read the entire passage in 30-45 seconds.',
  },
];

const questionTypes = [
  { type: 'Words in Context', description: 'Choose the word that best fits the passage meaning', frequency: '~8-10 questions' },
  { type: 'Central Ideas', description: 'Identify the main point or purpose of a passage', frequency: '~6-8 questions' },
  { type: 'Command of Evidence', description: 'Select evidence that supports a claim', frequency: '~6-8 questions' },
  { type: 'Inferences', description: 'Draw logical conclusions from passage details', frequency: '~4-6 questions' },
  { type: 'Text Structure', description: 'Understand how ideas are organized', frequency: '~4-5 questions' },
  { type: 'Grammar & Punctuation', description: 'Fix sentence structure, punctuation, verb tense', frequency: '~11-13 questions' },
  { type: 'Transitions', description: 'Choose the best transition word or phrase', frequency: '~4-6 questions' },
  { type: 'Rhetorical Synthesis', description: 'Combine ideas from multiple sources', frequency: '~2-4 questions' },
];

export default function DigitalSATReadingWritingPage() {
  return (
    <PublicLayout>
      <SEO
        title="Digital SAT Reading & Writing Prep - Vocabulary, Grammar & Comprehension"
        description="Master SAT Reading and Writing with AI-powered practice. Cover vocabulary, grammar, comprehension, and rhetorical analysis with personalized feedback."
        canonical="https://lyceon.ai/digital-sat/reading-writing"
      />
      <JsonLd data={createBreadcrumbJsonLd([
        { name: 'Home', url: 'https://lyceon.ai' },
        { name: 'Digital SAT', url: 'https://lyceon.ai/digital-sat' },
        { name: 'Reading & Writing', url: 'https://lyceon.ai/digital-sat/reading-writing' },
      ])} />
      <JsonLd data={createFaqJsonLd(faqs)} />

      <Container>
        <Breadcrumb items={[
          { label: 'Home', href: '/' },
          { label: 'Digital SAT', href: '/digital-sat' },
          { label: 'Reading & Writing' },
        ]} className="pt-8" />

        <div className="flex items-center gap-4 pt-8 mb-6">
          <div className="p-3 bg-secondary rounded-xl">
            <BookOpen className="w-8 h-8 text-foreground" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">
            SAT Reading & Writing Prep
          </h1>
        </div>

        <p className="text-xl text-muted-foreground mb-12 leading-relaxed max-w-3xl">
          The Digital SAT Reading and Writing section combines what used to be two separate tests. You'll encounter short passages covering literature, history, science, and social studies—each with a single focused question testing vocabulary, comprehension, or grammar.
        </p>

        <Section title="Question Types on SAT Reading & Writing">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold">Question Type</th>
                  <th className="text-left py-3 px-4 font-semibold">What It Tests</th>
                  <th className="text-left py-3 px-4 font-semibold">Frequency</th>
                </tr>
              </thead>
              <tbody>
                {questionTypes.map((item, index) => (
                  <tr key={index} className="border-b border-border">
                    <td className="py-3 px-4 font-medium">{item.type}</td>
                    <td className="py-3 px-4 text-muted-foreground">{item.description}</td>
                    <td className="py-3 px-4 text-muted-foreground">{item.frequency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Strategies for SAT Reading Success">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p><strong>Read the passage first, then the question.</strong> On the Digital SAT, passages are short enough to read quickly. Understanding the context makes answering faster.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p><strong>Look for evidence in the text.</strong> Every correct answer can be supported by specific words or phrases in the passage. If you can't point to evidence, reconsider your choice.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p><strong>Pay attention to transition words.</strong> Words like "however," "therefore," "although," and "moreover" signal relationships between ideas and often point to correct answers.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p><strong>Eliminate wrong answers.</strong> Often easier than finding the right one. Look for answers that are too extreme, not supported by text, or only partially correct.</p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Common Grammar Rules Tested">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <h3 className="font-semibold mb-2">Subject-Verb Agreement</h3>
              <p className="text-sm text-muted-foreground">Singular subjects need singular verbs. Watch for phrases between subject and verb that might confuse you.</p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Pronoun Clarity</h3>
              <p className="text-sm text-muted-foreground">Pronouns must clearly refer to a specific noun. Ambiguous references are often tested.</p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Comma Usage</h3>
              <p className="text-sm text-muted-foreground">Know when commas are required (introductory phrases, lists, nonessential clauses) and when they're incorrect.</p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Verb Tense Consistency</h3>
              <p className="text-sm text-muted-foreground">Maintain consistent verb tense within a passage unless there's a clear reason for a shift.</p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Modifier Placement</h3>
              <p className="text-sm text-muted-foreground">Modifiers should be placed next to what they describe. Misplaced modifiers create confusing sentences.</p>
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Parallel Structure</h3>
              <p className="text-sm text-muted-foreground">Items in a list or comparison should follow the same grammatical pattern.</p>
            </Card>
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
              <Link href="/digital-sat/math">
                <a className="block">
                  <div className="flex items-center gap-3 mb-3">
                    <Calculator className="w-6 h-6" />
                    <h3 className="font-semibold">SAT Math</h3>
                  </div>
                  <p className="text-muted-foreground text-sm mb-3">
                    Master algebra, geometry, and data analysis for the Math section.
                  </p>
                  <span className="inline-flex items-center text-sm font-medium">
                    Explore Math Prep <ArrowRight className="w-4 h-4 ml-1" />
                  </span>
                </a>
              </Link>
            </Card>
            <Card className="text-center flex flex-col justify-center">
              <h3 className="font-semibold mb-3">Ready to Practice?</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Get personalized reading and writing practice with AI-powered feedback.
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
