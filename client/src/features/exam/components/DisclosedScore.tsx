/**
 * A scaled score and its disclosure — never one without the other.
 *
 * @spec [Doc-04C_V1.0, §15.1 ("Clients MUST NOT render a scaled score without
 *        rendering the summary adjacent to it"; full_text_url as a "Learn more"
 *        link), §15.2 (the disclosure is bound to the score run's scoring version,
 *        read from the payload — never hard-coded)]
 *       [E7b plant "the completion screen refuses to render a score without its
 *        disclosure"; owner ruling 4: render the link as the payload gives it]
 * @implemented [2026-09-25]
 *
 * plain English: every scaled score on the report is drawn inside this gate. It
 * re-validates the disclosure block it is given; if it is missing or empty NO score
 * is drawn and the student sees that the score can't be shown. The strict report schema already
 * requires the block — this is the second lock, at the point of rendering.
 */
import type { ReactNode } from "react";
import { examDisclosureSchema } from "@lyceon/shared/exam-report-schema";

export function DisclosureNote({ disclosure }: { disclosure: unknown }) {
  const parsed = examDisclosureSchema.safeParse(disclosure);
  if (!parsed.success) return null;
  return (
    <p className="m-0 text-[13px] leading-relaxed text-[var(--exam-muted)]" data-testid="exam-disclosure">
      {parsed.data.summary}{" "}
      <a href={parsed.data.full_text_url} className="font-medium text-[var(--exam-accent)] underline underline-offset-2">
        Learn more
      </a>
    </p>
  );
}

/**
 * The gate. Children are drawn only when the disclosure is valid; the caller places
 * one <DisclosureNote> directly beside the score inside them.
 */
export function DisclosedScore({ disclosure, children }: { disclosure: unknown; children: ReactNode }) {
  if (!examDisclosureSchema.safeParse(disclosure).success) {
    return (
      <div role="alert" data-testid="exam-score-withheld" className="rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] p-5 text-[15px]">
        Your score can't be shown right now. Please check back soon.
      </div>
    );
  }
  return <>{children}</>;
}
