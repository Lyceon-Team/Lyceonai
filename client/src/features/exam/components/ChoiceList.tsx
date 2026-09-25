/**
 * Multiple-choice options — no letters, anywhere.
 *
 * @spec [SCL-133 (options are opaque per-session tokens, order shuffled per
 *        student); Doc-04A_V2.2 §10.2; Coding Standards §5.2]
 *       [E7b brief: "No A/B/C/D labels on options" — the one deliberate break from
 *        Bluebook; owner ruling 5 ("Cross out choice 2" names the POSITION)]
 * @implemented [2026-09-25]
 *
 * plain English: a selection ring marks the chosen option. Selecting sends the
 * option's TOKEN; crossing out stores the TOKEN. The only number a student or a
 * screen reader ever meets is the on-screen position ("choice 2"), which is this
 * student's shuffle and says nothing about the canonical letter. Selecting a
 * crossed-out option un-crosses it (Bluebook behaviour).
 */
import type { ExamQuestionPayload } from "@lyceon/shared/exam-runtime-schema";
import MathRenderer from "@/components/MathRenderer";

type Props = {
  options: ExamQuestionPayload["options"];
  selected: string | null;
  eliminated: ReadonlyArray<string>;
  onSelect: (token: string) => void;
  onToggleEliminate: (token: string) => void;
};

export function ChoiceList({ options, selected, eliminated, onSelect, onToggleEliminate }: Props) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">Answer choices</legend>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {options.map((option, index) => {
          const isSelected = selected === option.id;
          const isOut = eliminated.includes(option.id);
          const position = index + 1;
          return (
            <li key={option.id} className="flex items-stretch gap-2" data-testid="exam-choice">
              <button
                type="button"
                aria-pressed={isSelected}
                data-choice-token={option.id}
                onClick={() => onSelect(option.id)}
                className={[
                  "flex min-h-[44px] w-full items-start gap-3.5 rounded-[10px] border-[1.5px] px-4 py-3.5 text-left text-[15px] leading-normal",
                  isSelected
                    ? "border-[var(--exam-accent)] bg-[var(--exam-accent-soft)]"
                    : "border-[var(--exam-line)] bg-[var(--exam-surface)] hover:border-[var(--exam-line-strong)]",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 bg-white",
                    isSelected ? "border-[var(--exam-accent)]" : "border-[var(--exam-line-strong)]",
                  ].join(" ")}
                >
                  <span className={["h-2.5 w-2.5 rounded-full", isSelected ? "bg-[var(--exam-accent)]" : "bg-transparent"].join(" ")} />
                </span>
                <span className={isOut ? "text-[var(--exam-muted)] line-through" : undefined}>
                  <MathRenderer content={option.text} />
                </span>
                {isOut && <span className="sr-only">(crossed out)</span>}
              </button>
              <button
                type="button"
                aria-pressed={isOut}
                aria-label={`Cross out choice ${position}`}
                data-testid="exam-cross-out"
                onClick={() => onToggleEliminate(option.id)}
                className={[
                  "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[10px] border",
                  isOut
                    ? "border-[var(--exam-ink)] bg-[var(--exam-ink)] text-white"
                    : "border-[var(--exam-line)] bg-[var(--exam-surface)] text-[var(--exam-muted)]",
                ].join(" ")}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="7" />
                  <path d="M4 20L20 4" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
