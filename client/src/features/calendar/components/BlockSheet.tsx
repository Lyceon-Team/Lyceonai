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
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  buildEscapeKeymap,
  useKeyboardShortcuts,
} from "@/hooks/useKeyboardShortcuts";
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

type BlockSheetProps = {
  block: ViewBlock;
  day: ViewDay;
  today: string;
  open: boolean;
  onClose: () => void;
  /** Undefined on the guardian surface — see the module note. */
  actions?: BlockSheetActions;
  /**
   * @spec [student-UI register §2 Keyboard ("Esc closes the open modal or sheet"); production
   *        QA 2026-10-07 item 11(b)] | @implemented [2026-10-07]
   * | plain English: the STUDENT's sheet is a modal dialog — `role="dialog"`, `aria-modal`,
   * named by the block's title, a Close button, Esc closes it, focus moves into it on open
   * (to Close), Tab stays inside it, and focus goes back to the block that opened it on close.
   * The guardian calendar does not pass it and keeps its sheet as it was (guardian vertical:
   * reported, not changed here).
   */
  modal?: boolean;
};

/** What Tab can reach inside the sheet, in document order. */
const TABBABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

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
  modal = false,
}: BlockSheetProps): JSX.Element {
  const [moveDate, setMoveDate] = useState("");
  const titleId = useId();
  const lockedNoteId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Esc closes the modal sheet. Not a Radix overlay, so nothing else closes it on Esc; an open
  // Radix dialog above it (the phone pre-start check) takes its own Esc first and marks it
  // handled, which this listener then leaves alone.
  useKeyboardShortcuts(buildEscapeKeymap(onClose), { enabled: modal && open });

  // Focus in on open, back to the opener on close (the sheet unmounts when it closes). A DOM
  // side effect, not derived state. An opener that is gone by then (a removed block) is skipped.
  useEffect(() => {
    if (!modal || !open) return undefined;
    const active = document.activeElement;
    const opener =
      active instanceof HTMLElement && active !== document.body ? active : null;
    closeRef.current?.focus();
    return () => {
      if (opener !== null && opener.isConnected) opener.focus();
    };
  }, [modal, open]);

  /** Tab and Shift+Tab wrap inside the modal sheet (`aria-modal` promises nothing behind it). */
  const keepTabInside = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Tab" || sheetRef.current === null) return;
    const items = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>(TABBABLE),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const isPast = day.date < today;
  const complete = block.target > 0 && block.actual >= block.target;
  // §12.2: a started block is protected state; a past day is never edited. EDITING only —
  // R-08-34 separated the two, and `locked` is deliberately untouched by it. A past block can
  // now be WORKED where it sits while its scope stays frozen, which is the distinction §12.2
  // was always making and the date gate blurred: protecting a plan from edits is not the same
  // as forbidding the student to do the work.
  const locked = actions === undefined || block.started || isPast;
  // Started and not finished: the state the "In progress" note below and the Items to clear
  // note (QA2-G) both describe.
  const inProgress = block.started && !complete;
  const plan = block.plan;

  return (
    <>
      <div
        className={`scrim${open ? " on" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={sheetRef}
        className={`sheet${open ? " on" : ""}`}
        aria-hidden={!open}
        {...(modal
          ? {
              role: "dialog",
              "aria-modal": true,
              "aria-labelledby": titleId,
              onKeyDown: keepTabInside,
            }
          : { "aria-label": "Block details" })}
        data-testid="calendar-block-sheet"
      >
        <header>
          {modal ? (
            <button
              ref={closeRef}
              type="button"
              className="sheet-close"
              aria-label="Close"
              onClick={onClose}
              data-testid="calendar-block-sheet-close"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
          <span className={`kind kind-${block.tone}`}>
            {TONE_LABEL[block.tone]}
          </span>
          <h3 id={modal ? titleId : undefined}>{block.title}</h3>
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
              {/*
                @spec [Doc 05F §12.2 protected state; production re-test (Karl, 2026-10-08)
                       item G: "Calendar block panel: disable 'Items to clear' while the block
                       is in progress."] | @implemented [2026-10-08]
                plain English: an in-progress block (`block.started`, from the server's §13
                status, and not yet finished) cannot have its count changed, so the control
                is disabled AND says so (`aria-disabled`, and a note it is described by); a
                block not yet started keeps it enabled. A past or finished block stays
                disabled too (§12.2, `locked`), without the in-progress note, which would not
                be true of it.
              */}
              <select
                disabled={locked}
                aria-disabled={locked ? "true" : undefined}
                aria-describedby={inProgress ? lockedNoteId : undefined}
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
              {inProgress ? (
                <p
                  id={lockedNoteId}
                  className="field-note"
                  data-testid="calendar-items-locked-note"
                >
                  You can&apos;t change this while the block is in progress.
                </p>
              ) : null}
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

          {inProgress ? (
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
          ) : (
            <>
              {block.launchable ? (
                <button
                  type="button"
                  className="btn primary"
                  // `isPast` IS GONE from this list (R-08-34). It used to disable Start on a
                  // past block AND swap the whole control for "Do it now" — so a student who
                  // missed Tuesday could not work Tuesday's block, only copy it to today. The
                  // remaining two conditions are the real ones: a finished block has nothing
                  // to launch, and a launch already in flight must not be fired twice.
                  disabled={complete || actions.launchPending}
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
              {/* "Do it now" SURVIVES, beside Start rather than instead of it (§12.6). The
                  two do different things and a student may want either: Start works the
                  block where it sits, and this copies it onto today, which is what somebody
                  rebuilding a routine after a missed week actually wants. Still only on an
                  unfinished past block — there is nothing to bring forward from a finished
                  one, and a future block is already ahead of today. */}
              {isPast && !complete ? (
                <button
                  type="button"
                  className="btn"
                  onClick={actions.onDoItNow}
                >
                  Do it now
                </button>
              ) : null}
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
