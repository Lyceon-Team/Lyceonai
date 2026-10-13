/**
 * The question header: domain · skill · difficulty, above the question in the practice, review
 * and diagnostic runners.
 *
 * @spec [owner brief "Question metadata header" (Karl, 2026-10-13) §1 ("Header: domain · skill ·
 *        difficulty (Easy/Medium/Hard), using the existing domain-tag style. Desktop: one row.
 *        Phone (<1024px): row 1 = domain + difficulty, row 2 = skill, clamped to 2 lines with an
 *        ellipsis"; "NOT the timed full-length module"); DESIGN.md §5 UI standards (tokens only,
 *        nothing below 14px, long labels with `ClampedLabel`); DESIGN.md §2 Mobile (`lg`, 1024px,
 *        is the phone/desktop line)] | @implemented [2026-10-13]
 *
 * plain English: one line of muted text in the style Home's "Today's question" card already uses
 * for "Math · Algebra" (16px `--muted`, middle-dot separators). From `lg` (1024px) it is one row,
 * "Algebra · Linear equations in one variable · Easy". Below it, the skill drops to a second row
 * and the first row reads "Algebra · Easy". The order is set with CSS `order`, so the DOM (and a
 * screen reader) always reads domain, skill, difficulty; the dots are hidden from assistive tech
 * and the difficulty is announced as "Difficulty: Easy". The skill is a `ClampedLabel`: two lines
 * and an ellipsis at most, the full name in its `title`.
 * expected outcome: CanonicalPracticePage renders this once, so practice, review and the
 * diagnostic (all three run in that page) show the same header. The full-length module
 * (ExamModulePage) never renders it, and its payload carries no taxonomy (Doc 04A §10.2).
 * trade-offs: no element here is focusable, so the clamped skill's full text is on hover (title)
 * and to screen readers (the clamp is visual only), not on keyboard focus; adding a tab stop
 * before the choices for a label was judged worse. Raised as a question in the PR.
 * edge cases: a missing part is left out with its dot; with nothing to show the header renders
 * nothing. Difficulty is shown only when it maps to Easy/Medium/Hard (never a guessed word).
 */
import { ClampedLabel } from "@/components/student-ui";
import { cn } from "@/lib/utils";
import { questionDifficultyLabel } from "@lyceon/shared/question-difficulty";

const DOT = "·";

export function QuestionMetaHeader({
  domain,
  skill,
  difficulty,
}: {
  domain: string | null | undefined;
  skill: string | null | undefined;
  difficulty: string | number | null | undefined;
}): JSX.Element | null {
  const domainText = domain?.trim() || null;
  const skillText = skill?.trim() || null;
  const difficultyText = questionDifficultyLabel(difficulty);
  if (domainText === null && skillText === null && difficultyText === null) {
    return null;
  }

  // Desktop: domain · skill · difficulty. Phone: domain · difficulty, then the skill below.
  const dotDomainSkill = domainText !== null && skillText !== null;
  const dotBeforeDifficultyPhone =
    domainText !== null && difficultyText !== null;
  const dotBeforeDifficultyDesktop =
    (domainText !== null || skillText !== null) && difficultyText !== null;

  return (
    <div
      data-testid="question-meta"
      className="flex flex-wrap items-baseline gap-x-2 text-lyc-body text-lyc-muted lg:flex-nowrap"
    >
      {domainText !== null ? (
        <span
          data-testid="question-meta-domain"
          className="order-1 shrink-0 whitespace-nowrap"
        >
          {domainText}
        </span>
      ) : null}
      {dotDomainSkill ? (
        <span aria-hidden="true" className="hidden lg:order-2 lg:inline">
          {DOT}
        </span>
      ) : null}
      {skillText !== null ? (
        <ClampedLabel
          text={skillText}
          data-testid="question-meta-skill"
          className="order-4 min-w-0 basis-full lg:order-3 lg:basis-auto"
        />
      ) : null}
      {dotBeforeDifficultyPhone || dotBeforeDifficultyDesktop ? (
        <span
          aria-hidden="true"
          data-testid="question-meta-dot-difficulty"
          className={cn(
            "order-2 lg:order-4",
            dotBeforeDifficultyPhone ? "inline" : "hidden",
            dotBeforeDifficultyDesktop ? "lg:inline" : "lg:hidden",
          )}
        >
          {DOT}
        </span>
      ) : null}
      {difficultyText !== null ? (
        <span
          data-testid="question-meta-difficulty"
          className="order-3 shrink-0 whitespace-nowrap lg:order-5"
        >
          <span className="sr-only">Difficulty: </span>
          {difficultyText}
        </span>
      ) : null}
    </div>
  );
}
