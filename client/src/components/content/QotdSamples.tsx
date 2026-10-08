/**
 * Up to two past Questions of the Day from one SAT section or content domain.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R20a (the dated archive is the one public
 *       exposure of bank content); owner decision 1 on Wave 3 Step 0, 2026-10-05 ("Each domain
 *       page shows up to 2 archived QOTD questions from that domain and links to the archive");
 *       Coding Standards §5.2, §11.2] | @implemented [2026-10-05]
 *
 * plain English: reads the archive list (past days only; the server refuses today and later),
 * keeps the newest days that match the section or domain, and shows each question with its
 * lettered choices and a link to that day's archive page, where the answer and the explanation
 * live. This block marks no answer itself: the dated page is the one place a day's answer is
 * shown, so it stays the canonical home of that content. At build time the prerender puts the
 * same queries' data in the cache (client/src/prerender/entry-server.tsx), so the static HTML
 * carries the questions.
 *
 * edge cases: no matching past day renders one plain line, not an empty box; a failed archive
 * read renders nothing (the rest of the page stands on its own, and the archive link sits just
 * below this block).
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { StaticMath } from "@/components/qotd/StaticMath";
import {
  qotdArchiveDayQueryOptions,
  qotdArchiveIndexQueryOptions,
} from "@/lib/qotd";
import { formatQotdDate } from "@shared/seo/qotd-labels";
import {
  qotdSampleDates,
  type QotdSampleFilter,
} from "@shared/content/qotd-samples";

const LETTERS = ["A", "B", "C", "D"] as const;

function Sample({ date }: { date: string }): JSX.Element | null {
  const { data: day } = useQuery(qotdArchiveDayQueryOptions(date));
  if (!day) return null;
  const q = day.question;
  const label = formatQotdDate(day.qotd_date);
  return (
    <div
      className="rounded-2xl border border-border bg-card p-5 space-y-4"
      data-testid="qotd-sample"
    >
      <h3 className="font-semibold">SAT Question of the Day for {label}</h3>
      {q.passage ? (
        <div className="rounded-lg border border-border bg-secondary/50 p-4 whitespace-pre-wrap">
          <StaticMath content={q.passage} />
        </div>
      ) : null}
      <div className="whitespace-pre-wrap">
        <StaticMath content={q.stem} />
      </div>
      {q.options.length > 0 ? (
        <ol className="space-y-2">
          {q.options.map((option, index) => (
            <li
              key={option.id}
              className="flex items-start gap-3 rounded-xl border border-border px-4 py-2"
            >
              <span className="font-semibold">{LETTERS[index]}.</span>
              <StaticMath content={option.text} />
            </li>
          ))}
        </ol>
      ) : null}
      <Link
        href={`/sat-question-of-the-day/${day.qotd_date}`}
        className="inline-block font-medium underline underline-offset-2"
      >
        See the answer and explanation for {label}
      </Link>
    </div>
  );
}

export default function QotdSamples({
  filter,
  limit,
}: {
  filter: QotdSampleFilter;
  limit: number;
}): JSX.Element | null {
  const { data: index } = useQuery(qotdArchiveIndexQueryOptions());
  if (!index) return null;
  const dates = qotdSampleDates(index.days, filter, limit);
  if (dates.length === 0) {
    return (
      <p className="text-muted-foreground" data-testid="qotd-sample-empty">
        There are no past Questions of the Day from this area yet.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {dates.map((date) => (
        <Sample key={date} date={date} />
      ))}
    </div>
  );
}
