/**
 * /sat-question-of-the-day/:date — one past Question of the Day, with its answer.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R20a (the dated archive is the public
 *       exposure of bank content), Q3 (prerendered archive pages, unique meta, in the sitemap);
 *       owner Step 0 decisions 2026-10-05 (server-side KaTeX; Quiz JSON-LD on archive pages
 *       only; canonical option order)] | @implemented [2026-10-05]
 *
 * plain English: shows a day that has ended — passage, question, the four choices with the
 * correct one marked (or the keyed answer for a student-produced response), and the worked
 * explanation. At build time the day's payload is preloaded into the query cache, so the static
 * HTML carries the whole page; in the browser it is fetched from GET /api/public/qotd/:date,
 * which refuses today and every later date. Maths is typeset during render (StaticMath), not in
 * an effect, so the prerendered HTML holds it too.
 */
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import PublicLayout from "@/components/layout/PublicLayout";
import {
  Breadcrumb,
  Card,
  Container,
  Section,
} from "@/components/layout/primitives";
import { StaticMath } from "@/components/qotd/StaticMath";
import { QotdStatLine } from "@/components/qotd/QotdWidget";
import { qotdArchiveDayQueryOptions } from "@/lib/qotd";
import { formatQotdDate, qotdTopic } from "@shared/seo/qotd-labels";
import type { QotdArchiveResponse } from "../../../packages/shared/src/qotd-schema";

const LETTERS = ["A", "B", "C", "D"] as const;

function ArchiveDay({ day }: { day: QotdArchiveResponse }): JSX.Element {
  const q = day.question;
  const label = formatQotdDate(day.qotd_date);
  return (
    <article className="pb-12" data-testid="qotd-archive-day">
      <header className="mb-8">
        <p className="text-sm text-muted-foreground mb-2">{qotdTopic(day)}</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
          SAT Question of the Day for {label}
        </h1>
      </header>

      <Card className="space-y-5">
        {q.passage ? (
          <div className="rounded-lg border border-border bg-secondary/50 p-4 whitespace-pre-wrap">
            <StaticMath content={q.passage} />
          </div>
        ) : null}
        <div className="text-lg font-semibold whitespace-pre-wrap">
          <StaticMath content={q.stem} />
        </div>
        {q.options.length > 0 ? (
          <ol className="space-y-3">
            {q.options.map((option, index) => {
              const correct = option.id === q.correct_option_id;
              return (
                <li
                  key={option.id}
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                    correct
                      ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950"
                      : "border-border"
                  }`}
                >
                  <span className="font-semibold">{LETTERS[index]}.</span>
                  <StaticMath content={option.text} />
                  {correct ? (
                    <span className="ml-auto flex items-center gap-1 text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      Correct answer
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p>
            <span className="font-semibold">Correct answer: </span>
            {q.correct_answer ?? ""}
          </p>
        )}
        <QotdStatLine stat={day.stats} />
      </Card>

      <Section title="Explanation">
        <div className="leading-relaxed whitespace-pre-wrap">
          <StaticMath content={q.explanation} />
        </div>
      </Section>

      <Section title="How to use this question">
        <div className="space-y-4 leading-relaxed">
          <p>
            Try the question before you read the explanation: cover it, commit
            to an answer, and then compare your reasoning with the worked
            solution. If you missed it, note the step where your approach went
            wrong rather than only the correct letter, and look for that same
            step the next time you see a similar question.
          </p>
          <p>
            Every past question stays here with its answer and explanation, and
            a new question is posted every day.
          </p>
        </div>
      </Section>
    </article>
  );
}

export default function SatQuestionOfTheDayArchivePage(): JSX.Element {
  const [, params] = useRoute("/sat-question-of-the-day/:date");
  const date = params?.date ?? "";
  const day = useQuery({
    ...qotdArchiveDayQueryOptions(date),
    enabled: date.length > 0,
  });

  return (
    <PublicLayout>
      <Container size="narrow">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            {
              label: "SAT Question of the Day",
              href: "/sat-question-of-the-day",
            },
            { label: date ? formatQotdDate(date) : "Past question" },
          ]}
          className="pt-8"
        />
        {day.data ? (
          <ArchiveDay day={day.data} />
        ) : day.isError ? (
          <div className="py-16 text-center">
            <h1 className="text-2xl font-bold mb-4">
              This question is not available
            </h1>
            <Link href="/sat-question-of-the-day" className="underline">
              Go to today&apos;s question
            </Link>
          </div>
        ) : (
          <p className="py-16 text-muted-foreground">Loading…</p>
        )}

        <Section className="border-t border-border">
          <Card className="text-center">
            <h2 className="text-xl font-semibold mb-3">
              Try today&apos;s question
            </h2>
            <p className="text-muted-foreground mb-4">
              A new SAT practice question is posted every day, free and with no
              account needed.
            </p>
            <Link
              href="/sat-question-of-the-day"
              className="inline-block px-5 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Answer today&apos;s question
            </Link>
          </Card>
        </Section>
      </Container>
    </PublicLayout>
  );
}
