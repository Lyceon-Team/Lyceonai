/**
 * The question header: domain, skill and difficulty pills above the question in the practice,
 * review and diagnostic runners.
 *
 * @spec [owner brief "Question metadata header" (Karl, 2026-10-13) §1 ("Header: domain · skill ·
 *        difficulty (Easy/Medium/Hard) ... Desktop: one row. Phone (<1024px): row 1 = domain +
 *        difficulty, row 2 = skill, clamped to 2 lines with an ellipsis"; "NOT the timed
 *        full-length module"); owner rulings (Karl) 2026-10-13 on #1225: (1) the three parts are
 *        small pills on the existing pill primitive, difficulty in a NEUTRAL colour (no
 *        green/amber/red coding); (2) the skill is one keyboard focus stop, so its full text shows
 *        on focus as well as hover; DESIGN.md §4 Question runner (the header), §5 UI standards
 *        (tokens only, nothing below 14px, long labels with `ClampedLabel`, full text on hover
 *        and focus); DESIGN.md §2 Mobile (`lg`, 1024px, is the phone/desktop line)]
 *        | @implemented [2026-10-13]
 *
 * plain English: three `Pill`s (the student UI's one neutral pill: `--chip` fill, `--rule`
 * border, 14px semibold `--ink`), all the same colour: the difficulty is a word, never a traffic
 * light. From `lg` (1024px) they sit in one row, domain, skill, difficulty. Below it the first row
 * is domain and difficulty and the skill takes the second row on its own. The order is set with
 * CSS `order`, so the DOM (and a screen reader) always reads domain, skill, difficulty; the
 * difficulty is announced as "Difficulty: Easy". The skill is a `ClampedLabel` inside its pill:
 * two lines and an ellipsis at most, the full name in its `title` (hover). The skill pill is the
 * header's only focus stop (`tabIndex=0`, the student focus ring): focusing it un-clamps the
 * label (`group` + ClampedLabel's `group-focus-within:line-clamp-none`). It has no role, so a
 * screen reader reads its text as it did before; the tab stop adds nothing else.
 * expected outcome: CanonicalPracticePage renders this once, so practice, review and the
 * diagnostic show the same header. The full-length module (ExamModulePage) never renders it, and
 * its payload carries no taxonomy (Doc 04A §10.2).
 * edge cases: a missing part is left out; with nothing to show the header renders nothing.
 * Difficulty is shown only when it maps to Easy/Medium/Hard (never a guessed word).
 */
import { ClampedLabel, Pill } from "@/components/student-ui";
import { LYC_FOCUS } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { questionDifficultyLabel } from "@lyceon/shared/question-difficulty";

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

  // Desktop: domain, skill, difficulty. Phone: domain, difficulty, then the skill on its own row.
  return (
    <div
      data-testid="question-meta"
      className="flex flex-wrap items-start gap-2 lg:flex-nowrap"
    >
      {domainText !== null ? (
        <Pill data-testid="question-meta-domain" className="order-1 shrink-0">
          {domainText}
        </Pill>
      ) : null}
      {skillText !== null ? (
        <div
          data-testid="question-meta-skill-row"
          className="order-3 flex min-w-0 basis-full lg:order-2 lg:basis-auto"
        >
          <Pill
            tabIndex={0}
            data-testid="question-meta-skill-pill"
            className={cn("group min-w-0 max-w-full rounded-xl", LYC_FOCUS)}
          >
            <ClampedLabel text={skillText} data-testid="question-meta-skill" />
          </Pill>
        </div>
      ) : null}
      {difficultyText !== null ? (
        <Pill
          data-testid="question-meta-difficulty"
          className="order-2 shrink-0 lg:order-3"
        >
          <span className="sr-only">Difficulty: </span>
          {difficultyText}
        </Pill>
      ) : null}
    </div>
  );
}
