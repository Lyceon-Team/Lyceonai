/**
 * §17.2's "+ Add block" — the side sheet in CREATE mode.
 *
 * @spec [Doc_05F_V1.0 §17.2 day editor, §12.4 day edit, §21; Brief 11 Step 2; SCL-137]
 * | @implemented [2026-09-24]
 *
 * plain English: pick the engine, fill in that engine's fields, confirm. Only then is
 * anything written.
 *
 * WHAT THIS REPLACES. "+ Add block" used to call `editDay` on the click, with a block
 * nobody chose: practice, section M, the first two Math domains, five questions each. The
 * student was never asked, and the day they got was the one this file happened to name.
 * When the server refused that invented day the answer was a 500 with no reason in it —
 * the `PUT /api/calendar/days/… 500 plan_rejected` run of 2026-09-24.
 *
 * expected outcome: clicking Add writes NOTHING. It opens this. One confirm sends one
 * §12.4 day edit carrying the whole day, exactly as every other edit on this surface does.
 *
 * ENGINE FIRST, THEN THAT ENGINE'S FIELDS, as §17.2 requires — and as `BlockSheet` already
 * does for editing. The branches are separate for the reason that file gives: a field that
 * is present-but-hidden is a field someone later un-hides for the wrong block type. The
 * domain rows are not a copy of the editing path's — both render `MixRows`.
 *
 * trade-offs: this sheet DOES have a confirm button, where editing an existing block saves
 * immediately. The asymmetry is deliberate and is the whole point of the step: an edit
 * changes something that already exists and is idempotent to repeat, while a create makes
 * a new block every time it fires. "Nothing is written until the student confirms" is the
 * requirement.
 *
 * edge cases: only engines in `enabled_block_types` are offered, so full-length is absent
 * until it ships — the same list `calendar_validate_plan` checks a created block against
 * (V-03), served on the payload rather than restated here.
 */
import { useEffect, useState } from "react";
import type { CalendarBlockType } from "@lyceon/shared/calendar";
import { sectionName } from "../lib/blocks";
import { longDate } from "../lib/dates";
import {
  MIX_GRANULARITY,
  isValidMix,
  reviewCountChoices,
  type NewBlockDraft,
} from "../lib/members";
import { MixRows, type MixEntry } from "./MixRows";

/** The label each engine wears in the picker. Full words; the wire's names are not copy. */
const ENGINE_LABEL: Readonly<Record<CalendarBlockType, string>> = {
  practice: "Practice",
  review: "Review",
  full_length: "Full-length test",
};

const ENGINE_BLURB: Readonly<Record<CalendarBlockType, string>> = {
  practice: "Questions in the domains you choose.",
  review: "Work back through what you have already seen.",
  full_length: "A timed test, start to finish.",
};

/** The opening mix: one domain, one granularity step. The student changes it or doesn't. */
function openingMix(): MixEntry[] {
  return [{ domain: "Algebra", count: MIX_GRANULARITY }];
}

export type CreateBlockSheetProps = {
  open: boolean;
  date: string;
  /** From the payload — §17.2 offers exactly what V-03 accepts. */
  enabledBlockTypes: readonly CalendarBlockType[];
  onClose: () => void;
  onCreate: (draft: NewBlockDraft) => void;
  pending: boolean;
};

export function CreateBlockSheet({
  open,
  date,
  enabledBlockTypes,
  onClose,
  onCreate,
  pending,
}: CreateBlockSheetProps): JSX.Element {
  const [engine, setEngine] = useState<CalendarBlockType | null>(null);
  const [section, setSection] = useState<"M" | "RW">("M");
  const [mix, setMix] = useState<MixEntry[]>(openingMix);
  const [reviewCount, setReviewCount] = useState<number>(10);

  // Reopening on another day must not inherit the last day's half-filled form. This is not
  // derived state — it is a reset on an external event, which is what an effect is for.
  useEffect(() => {
    if (!open) return;
    setEngine(null);
    setSection("M");
    setMix(openingMix());
    setReviewCount(10);
  }, [open, date]);

  // Switching section invalidates the domains: they belong to the section that was chosen
  // when they were picked, and a Math domain on a Reading & Writing block is a scope the
  // database refuses.
  function chooseSection(next: "M" | "RW"): void {
    setSection(next);
    setMix(
      next === "M"
        ? [{ domain: "Algebra", count: MIX_GRANULARITY }]
        : [{ domain: "Information and Ideas", count: MIX_GRANULARITY }],
    );
  }

  const draft: NewBlockDraft | null =
    engine === null
      ? null
      : engine === "practice"
        ? isValidMix(mix)
          ? { block_type: "practice", section, mix }
          : null
        : engine === "review"
          ? { block_type: "review", count: reviewCount }
          : { block_type: "full_length" };

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
        aria-label="Add a block"
        data-testid="calendar-create-sheet"
      >
        <header>
          <span className="kind kind-new">New</span>
          <h3>Add a block</h3>
          <div className="when">{longDate(date)}</div>
        </header>

        <div className="body">
          <div className="field" data-testid="calendar-create-engines">
            <label>What kind of work?</label>
            {enabledBlockTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={`btn${engine === type ? " primary" : ""}`}
                style={{ width: "100%" }}
                aria-pressed={engine === type}
                data-testid={`calendar-create-engine-${type}`}
                onClick={() => setEngine(type)}
              >
                {ENGINE_LABEL[type]}
                <span className="hint" style={{ display: "block", padding: 0 }}>
                  {ENGINE_BLURB[type]}
                </span>
              </button>
            ))}
          </div>

          {engine === "practice" ? (
            <>
              <div className="field" data-testid="calendar-create-sections">
                <label>Which section?</label>
                {(["M", "RW"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`btn${section === value ? " primary" : ""}`}
                    style={{ width: "100%" }}
                    aria-pressed={section === value}
                    data-testid={`calendar-create-section-${value}`}
                    onClick={() => chooseSection(value)}
                  >
                    {sectionName(value)}
                  </button>
                ))}
              </div>
              <MixRows
                section={section}
                mix={mix}
                disabled={pending}
                onChange={(next) => setMix([...next])}
              />
            </>
          ) : null}

          {engine === "review" ? (
            <div className="field">
              <label htmlFor="calendar-create-review-count">How many items?</label>
              <select
                id="calendar-create-review-count"
                data-testid="calendar-create-review-count"
                disabled={pending}
                value={reviewCount}
                onChange={(event) => setReviewCount(Number(event.target.value))}
              >
                {reviewCountChoices().map((count) => (
                  <option key={count} value={count}>
                    {count} items
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {engine === "full_length" ? (
            <div className="hint" data-testid="calendar-create-fl-note">
              Doc 04 picks the form when the test starts. There is nothing to set here.
            </div>
          ) : null}
        </div>

        <footer>
          <button
            type="button"
            className="btn primary"
            data-testid="calendar-create-confirm"
            // Disabled ONLY because there is nothing to send yet — no engine chosen, or a
            // mix that `calendar_scope_is_valid` would refuse. It is never a validation
            // message the student has to decode.
            disabled={draft === null || pending}
            onClick={() => {
              if (draft === null) return;
              onCreate(draft);
            }}
          >
            {engine === null ? "Choose a kind" : "Add to this day"}
          </button>
          <button
            type="button"
            className="btn"
            data-testid="calendar-create-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
        </footer>
      </aside>
    </>
  );
}
