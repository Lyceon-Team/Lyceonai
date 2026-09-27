/**
 * @spec [Doc_05F_Study_Calendar, §17.2 day editor, §17.6 why-this-block, §12.2, §12.4, §12.6]
 * @implemented [2026-09-23]
 *
 * plain English: the side sheet for one block — what it covers, why it is there, and the one
 * or two things the student can do with it. Expected outcome: every change is a §12.4 day
 * edit carrying the whole day, and a started block shows why it cannot be changed.
 *
 * ENGINE-SPECIFIC FORMS, AS §17.2 REQUIRES. Practice gets domain and count rows; review gets
 * an items count; full-length gets the test and the timing (SCL-167, E9b), through the same
 * `FullLengthFields` the create sheet renders. The three are separate branches rather than one form with hidden fields:
 * a field that is present-but-hidden is a field someone will later un-hide for the wrong
 * block type.
 *
 * THE GUARDIAN CASE IS NOT A BRANCH HERE. This component renders controls only when it is
 * given handlers, and the guardian page passes none — `actions` is undefined and the footer
 * is a sentence instead. There is no `readOnly` flag to get wrong, and the guardian's own
 * data has `plan: null`, so the editor could not build a member list even if it tried.
 *
 * trade-offs: every edit saves IMMEDIATELY rather than behind a Save button. §12.4 writes are
 * idempotent and the optimistic layer rolls back cleanly, so a Save button would add a state
 * to lose work in without adding safety.
 *
 * edge cases: "Move to…" exists alongside drag-and-drop because a date picker is the keyboard
 * and screen-reader path to the same mutation. Dragging is an enhancement; this is the
 * control.
 */
import { useState } from "react";
import { prefetchEngineChunk } from "../api/launch";
import { FullLengthFields } from "./FullLengthFields";
import type {
  CanonicalDomain,
  FullLengthScope,
  PlanBlock,
} from "@lyceon/shared/calendar";
import { longDate } from "../lib/dates";
import { reviewCountChoices } from "../lib/members";
import { MixRows, type MixEntry } from "./MixRows";
import { TONE_LABEL } from "../lib/blocks";
import type { ViewBlock, ViewDay } from "../lib/view-model";

export type BlockSheetActions = {
  onEditMix: (
    mix: readonly { domain: CanonicalDomain; count: number }[],
  ) => void;
  onEditReviewCount: (count: number) => void;
  /** SCL-167: the test and the timing of a full-length block. */
  onEditFullLength: (scope: FullLengthScope) => void;
  onRemove: () => void;
  onLaunch: () => void;
  onDoItNow: () => void;
  onMove: (toDate: string) => void;
  launchPending: boolean;
};

export type BlockSheetProps = {
  block: ViewBlock;
  day: ViewDay;
  today: string;
  open: boolean;
  onClose: () => void;
  /** Undefined on the guardian surface — see the module note. */
  actions?: BlockSheetActions;
};

/**
 * The editing path's wrapper over the shared rows: it pulls the mix out of the stored block
 * and hands the control what it needs. The rows themselves live in `MixRows` so §17.2's
 * create form renders exactly the same editor — see that file's note.
 */
function MixEditor({
  block,
  disabled,
  onChange,
}: {
  block: PlanBlock & { block_type: "practice" };
  disabled: boolean;
  onChange: (mix: readonly MixEntry[]) => void;
}): JSX.Element {
  const mix =
    block.scope.level === "domain"
      ? block.scope.mix.map((entry) => ({
          domain: entry.domain,
          count: entry.count,
        }))
      : [];
  return (
    <MixRows
      section={block.section}
      mix={mix}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function BlockSheet({
  block,
  day,
  today,
  open,
  onClose,
  actions,
}: BlockSheetProps): JSX.Element {
  const [moveDate, setMoveDate] = useState("");

  const isPast = day.date < today;
  const complete = block.target > 0 && block.actual >= block.target;
  // §12.2: a started block is protected state; a past day is never edited.
  const locked = actions === undefined || block.started || isPast;
  const plan = block.plan;

  return (
    <>
      <div
        className={`scrim${open ? " on" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`sheet${open ? " on" : ""}`}
        aria-hidden={!open}
        aria-label="Block details"
        data-testid="calendar-block-sheet"
      >
        <header>
          <span className={`kind kind-${block.tone}`}>
            {TONE_LABEL[block.tone]}
          </span>
          <h3>{block.title}</h3>
          <div className="when">
            {longDate(day.date)}
            {block.minutes === null
              ? ""
              : ` · about ${block.minutes.replace("~", "").replace(" min", "")} minutes`}
          </div>
        </header>

        <div className="body">
          {plan !== null &&
          plan.block_type === "practice" &&
          actions !== undefined ? (
            <MixEditor
              block={plan}
              disabled={locked}
              onChange={actions.onEditMix}
            />
          ) : null}

          {plan !== null &&
          plan.block_type === "review" &&
          actions !== undefined ? (
            <div className="field">
              <label>Items to clear</label>
              <select
                disabled={locked}
                value={block.target}
                aria-label="Items to clear"
                onChange={(event) =>
                  actions.onEditReviewCount(Number(event.target.value))
                }
              >
                {reviewCountChoices().map((count) => (
                  <option key={count} value={count}>
                    {count} items
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {plan !== null &&
          plan.block_type === "full_length" &&
          actions !== undefined ? (
            <FullLengthFields
              idPrefix="calendar-block"
              scope={plan.scope}
              disabled={locked}
              onChange={actions.onEditFullLength}
            />
          ) : null}

          {block.explanations.length > 0 ? (
            <div className="why" data-testid="calendar-block-why">
              <b>Why this is here</b>
              {block.explanations.join(" ")}
            </div>
          ) : null}

          {block.started && !complete ? (
            <div className="why">
              <b>In progress</b>
              You&apos;ve done {block.actual} of {block.target}. This block
              stays put until it&apos;s finished — the rest of the day is still
              yours to change.
            </div>
          ) : null}

          {actions !== undefined && !locked ? (
            <div className="field">
              <label htmlFor="calendar-move-to">Move to…</label>
              <input
                id="calendar-move-to"
                type="date"
                min={today}
                value={moveDate}
                onChange={(event) => {
                  const next = event.target.value;
                  setMoveDate(next);
                  if (next !== "" && next !== day.date) actions.onMove(next);
                }}
              />
            </div>
          ) : null}
        </div>

        <footer>
          {actions === undefined ? (
            <div className="hint" style={{ padding: 0 }}>
              You&apos;re viewing this plan. Only the student can change it.
            </div>
          ) : isPast && !complete ? (
            <button
              type="button"
              className="btn primary"
              onClick={actions.onDoItNow}
            >
              Do it now
            </button>
          ) : (
            <>
              {block.launchable ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={complete || actions.launchPending || isPast}
                  // §17.7: warm the resume chunk on reach, not on mount — prefetching
                  // every Start on a 14-day grid would download both engines' bundles
                  // for a student who is only looking at their week.
                  onMouseEnter={() =>
                    block.plan === null
                      ? undefined
                      : prefetchEngineChunk(block.plan.block_type)
                  }
                  onFocus={() =>
                    block.plan === null
                      ? undefined
                      : prefetchEngineChunk(block.plan.block_type)
                  }
                  onClick={actions.onLaunch}
                >
                  {complete ? "Done" : block.started ? "Resume" : "Start"}
                </button>
              ) : (
                // Formula sheet item 12: an engine whose adapter is still a fail-open stub
                // answers `engine_unavailable`, so the control says so and never calls
                // launch. Review left this branch on 2026-09-22 and full-length in E9b;
                // none is here today, and the branch stays for the next one.
                <button
                  type="button"
                  className="btn"
                  disabled
                  aria-disabled="true"
                >
                  Coming soon
                </button>
              )}
              {!locked ? (
                <button
                  type="button"
                  className="btn"
                  onClick={actions.onRemove}
                >
                  <span className="del">Remove</span>
                </button>
              ) : null}
            </>
          )}
        </footer>
      </aside>
    </>
  );
}
