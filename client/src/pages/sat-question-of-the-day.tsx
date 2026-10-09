/**
 * /sat-question-of-the-day — the Question of the Day hub.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16-R18, R20a, Q3; Public Disclosure Doctrine
 *       §0.2 (no selection or scheduling mechanism described), §0.3 (SAT facts cite College
 *       Board)] | @implemented [2026-10-05]
 *
 * plain English: static copy (prerendered), today's question (fetched in the browser, so the
 * HTML never holds it) and the list of past days, each linking to its archive page. At build
 * time the archive list is preloaded from the same archive the archive pages are built from,
 * so a crawler finds every past day from here as well as from sitemap.xml.
 *
 * Every statement about the SAT reuses copy already in docs/compliance/claim-inventory.md
 * (M5, M10, M15, M16) with its College Board source shown beside it.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PublicLayout from "@/components/layout/PublicLayout";
import {
  Breadcrumb,
  Card,
  Container,
  Section,
} from "@/components/layout/primitives";
import { SourceLinks } from "@/components/common/source-links";
import { QotdWidget } from "@/components/qotd/QotdWidget";
import { qotdArchiveIndexQueryOptions } from "@/lib/qotd";
import { formatQotdDate } from "@shared/seo/qotd-labels";
import { CB_MATH, CB_READING_WRITING, CB_STRUCTURE } from "@shared/seo/sources";

const SECTION_NAME: Record<"M" | "RW", string> = {
  M: "Math",
  RW: "Reading and Writing",
};

function ArchiveList(): JSX.Element {
  const archive = useQuery(qotdArchiveIndexQueryOptions());
  const days = archive.data?.days ?? [];
  if (days.length === 0) {
    return (
      <p className="text-muted-foreground">
        Past questions are listed here once each day ends.
      </p>
    );
  }
  return (
    <ul className="space-y-2" data-testid="qotd-archive-list">
      {days.map((day) => (
        <li key={day.qotd_date}>
          <Link
            href={`/sat-question-of-the-day/${day.qotd_date}`}
            className="underline underline-offset-2 hover:opacity-80"
          >
            SAT question for {formatQotdDate(day.qotd_date)}
          </Link>{" "}
          <span className="text-sm text-muted-foreground">
            ({SECTION_NAME[day.section_code]}: {day.domain})
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function SatQuestionOfTheDayPage(): JSX.Element {
  return (
    <PublicLayout>
      <Container size="narrow">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "SAT Question of the Day" },
          ]}
          className="pt-8"
        />
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
            SAT Question of the Day
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            A free SAT practice question every day — no account needed. Answer
            it, then see the correct answer and a worked explanation.
          </p>
        </header>

        <Section title="Today's question">
          <Card>
            <QotdWidget showArchiveLink={false} />
          </Card>
        </Section>

        <Section title="How it works">
          <div className="space-y-4 leading-relaxed">
            <p>
              A new question is posted every day. Read it, choose your answer,
              complete the short security check and select “Check my answer”.
              You will see whether you were right, which choice is correct, and
              an explanation that walks through the reasoning step by step.
            </p>
            <p>
              Once a day is over, its question moves to the archive below with
              the answer and explanation shown, so you can work through earlier
              days at your own pace. A good habit is to cover the explanation,
              commit to an answer first, and only then compare your reasoning
              with the worked solution.
            </p>
          </div>
        </Section>

        <Section title="About the SAT">
          <div className="space-y-4 leading-relaxed">
            <p>
              The SAT is shorter, it is taken on a computer, and each
              section adapts at the module level.
            </p>
            <SourceLinks sources={[CB_STRUCTURE]} />
            <p>
              The Math section covers four content domains: Algebra, Advanced
              Math, Problem-Solving and Data Analysis, and Geometry and
              Trigonometry.
            </p>
            <SourceLinks sources={[CB_MATH]} />
            <p>
              Each Reading and Writing question has its own short passage of 25
              to 150 words. The section covers Information and Ideas, Craft and
              Structure, Expression of Ideas, and Standard English Conventions.
            </p>
            <SourceLinks sources={[CB_READING_WRITING]} />
          </div>
        </Section>

        <Section title="Past questions">
          <ArchiveList />
        </Section>

        <Section className="border-t border-border">
          <Card className="text-center">
            <h2 className="text-xl font-semibold mb-3">Want more practice?</h2>
            <p className="text-muted-foreground mb-4">
              Practice SAT-style questions with worked explanations every day.
            </p>
            <Link
              href="/practice"
              className="inline-block px-5 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Start Free Practice
            </Link>
          </Card>
        </Section>
      </Container>
    </PublicLayout>
  );
}
