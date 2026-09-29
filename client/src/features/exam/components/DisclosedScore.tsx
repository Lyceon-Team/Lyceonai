/**
 * A scaled score and its disclosure — never one without the other.
 *
 * @spec [Doc-04C_V1.0, §15.1 ("Clients MUST NOT render a scaled score without
 *        rendering the summary adjacent to it") as amended by SCL-182 (no link: the
 *        disclosure is the summary alone), §15.2 (the disclosure is bound to the score
 *        run's scoring version, read from the payload — never hard-coded)]
 *       [E7b plant "the completion screen refuses to render a score without its
 *        disclosure"]
 * @implemented [2026-09-25; link removed 2026-09-27, G2]
 *
 * plain English: every scaled score on the report is drawn inside this gate. It
 * re-validates the disclosure block it is given; if it is missing or empty NO score
 * is drawn and the student sees that the score can't be shown. The strict report schema already
 * requires the block — this is the second lock, at the point of rendering.
 *
 * NO "LEARN MORE" (G2, SCL-182). The summary stands alone: it already says what a
 * Lyceon score is and is not, and there is no separate disclosure document. The
 * payload still carries `full_text_url` (04C §15.1's block is unchanged, NOT NULL in
 * `score_disclosure_versions`); this component deliberately never renders it, for
 * students and guardians alike, since both reach it through this one component.
 */
import type { ReactNode } from "react";
import { examDisclosureSchema } from "@lyceon/shared/exam-report-schema";

export function DisclosureNote({ disclosure }: { disclosure: unknown }) {
  const parsed = examDisclosureSchema.safeParse(disclosure);
  if (!parsed.success) return null;
  return (
    <p className="m-0 text-[13px] leading-relaxed text-[var(--exam-muted)]" data-testid="exam-disclosure">
      {parsed.data.summary}
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
