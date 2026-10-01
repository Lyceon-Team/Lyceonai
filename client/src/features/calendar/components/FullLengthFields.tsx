/**
 * §17.2's full-length fields — the one editor for a full-length block's scope.
 *
 * @spec [Doc_05F §7.4 as widened by SCL-167, §9.4, §17.2 day editor; SCL-168 "the next test"]
 * | @implemented [2026-09-25]
 *
 * plain English: two choices, the same two wherever a full-length block is made or changed —
 * WHICH test, and WHICH timing. They are block-scope keys (`form_id`, `exam_mode`), edited here
 * the way practice's section and domains are edited in `MixRows`, and saved as a §12.4 day
 * edit. Nothing is collected at launch: the calendar starts what the block says (owner ruling,
 * E9b — "precedent decides, and the precedent is scope keys").
 *
 * expected outcome: a new block offers "Next unused test" and test-day timing, which is what a
 * generated block carries; the student can name a specific test or switch to practice timing,
 * and the block starts exactly that when they press Start.
 *
 * WHY ITS OWN FILE: the same reason `MixRows` is. `CreateBlockSheet` and `BlockSheet` both need
 * this control, and a second copy would be two places to change which forms are offered.
 *
 * trade-offs: the form list is the exam surface's own `GET /api/tests/forms`, through its own
 * query key and fetcher — one read of "which tests exist", not a calendar copy of it. Only
 * SELECTABLE forms are offered, because `exam_create_session` refuses the others; offering one
 * would lead to a server error, which is worse than never offering it.
 *
 * edge cases: while the list loads, or if it cannot be read, "Next unused test" is still
 * offered — it needs no list. A block already naming a form that has since stopped being
 * selectable keeps that choice visible (labelled as no longer offered) rather than silently
 * showing a different selection than the one stored.
 */
import { useQuery } from "@tanstack/react-query";
import type { ExamMode } from "@lyceon/shared/exam-runtime-schema";
import type { FullLengthScope } from "@lyceon/shared/calendar";
import { fetchExamForms } from "../../exam/api/exam-api";
import { examKeys } from "../../exam/api/keys";
import { MODE_LABEL } from "../../exam/lib/labels";

/** The select's value for `form_id: null`. Not a UUID, so it cannot collide with a form id. */
const NEXT_TEST = "next";

const MODES: readonly ExamMode[] = ["strict", "lenient"];

export function FullLengthFields({
  scope,
  disabled,
  onChange,
  idPrefix,
}: {
  scope: FullLengthScope;
  disabled: boolean;
  onChange: (scope: FullLengthScope) => void;
  /** Distinguishes the create and edit sheets' control ids when both are mounted. */
  idPrefix: string;
}): JSX.Element {
  const forms = useQuery({
    queryKey: examKeys.forms(),
    queryFn: fetchExamForms,
    staleTime: 60_000,
  });
  const selectable = (forms.data?.forms ?? []).filter((f) => f.is_selectable);
  const storedMissing =
    scope.form_id !== null &&
    forms.data !== undefined &&
    !selectable.some((f) => f.test_form_id === scope.form_id);

  return (
    <>
      <div className="field" data-testid={`${idPrefix}-fl-form`}>
        <label htmlFor={`${idPrefix}-fl-form-select`}>Which test?</label>
        <select
          id={`${idPrefix}-fl-form-select`}
          disabled={disabled}
          value={scope.form_id ?? NEXT_TEST}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ ...scope, form_id: value === NEXT_TEST ? null : value });
          }}
        >
          <option value={NEXT_TEST}>Next unused test</option>
          {selectable.map((form) => (
            <option key={form.test_form_id} value={form.test_form_id}>
              {form.name}
            </option>
          ))}
          {storedMissing && scope.form_id !== null ? (
            <option value={scope.form_id}>
              A test that is no longer offered
            </option>
          ) : null}
        </select>
      </div>

      <div className="field" data-testid={`${idPrefix}-fl-mode`}>
        <label>Timing</label>
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`btn${scope.exam_mode === mode ? " primary" : ""}`}
            aria-pressed={scope.exam_mode === mode}
            disabled={disabled}
            data-testid={`${idPrefix}-fl-mode-${mode}`}
            onClick={() => onChange({ ...scope, exam_mode: mode })}
          >
            {MODE_LABEL[mode]}
          </button>
        ))}
      </div>
    </>
  );
}
