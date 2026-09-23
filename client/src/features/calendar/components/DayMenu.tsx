/**
 * @spec [Doc_05F_Study_Calendar, §17.2 day controls, §12.1 day_regenerate / day_reset,
 *        §12.4 day edit, §16 guardian read]
 * @implemented [2026-09-22]
 *
 * plain English: the ⋯ menu on a day header. One component for Week and Month, because the
 * two grids must offer the same four things on the same dates — two copies would drift, and
 * the first thing to drift would be which dates are safe to offer them on.
 *
 * GUARDIAN: THERE IS NO MENU. The caller passes no `actions`, so nothing renders — the same
 * absent-prop rule the rest of this surface uses. There is no disabled state to get wrong
 * and no handler to build a control from.
 *
 * WHY "Regenerate day" REFUSES ON A BLOCKED DAY RATHER THAN HIDING. Regenerating a day the
 * student cleared would silently undo their day off — the plan would come back. Hiding the
 * item would leave them wondering where it went. Saying "Undo the day off first" names the
 * one step that makes it available, which is what the prototype does.
 */
import { useEffect, useRef, useState } from "react";

export type DayActions = {
  onBlockOut: (date: string) => void;
  onUndoBlockOut: (date: string) => void;
  onRegenerateDay: (date: string) => void;
  onResetDay: (date: string) => void;
};

export function DayMenu({
  date,
  blockedOut,
  isOverride,
  actions,
}: {
  date: string;
  blockedOut: boolean;
  isOverride: boolean;
  /** Absent for a guardian — §16 gives them no write path, so there is no menu at all. */
  actions?: DayActions;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  // A click anywhere else closes the menu. This is a real subscription to a real event,
  // not derived state, which is the case §17.7's no-useEffect-for-derived-state rule
  // leaves to useEffect.
  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent): void => {
      if (
        root.current !== null &&
        !root.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [open]);

  if (actions === undefined) return null;

  const close = (): void => {
    setOpen(false);
    setNotice(null);
  };

  return (
    <div className="dmenu-root" ref={root}>
      <button
        type="button"
        className="dmenu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Day options for ${date}`}
        data-testid={`day-menu-${date}`}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {!open ? null : (
        <div className="menu" role="menu" data-testid={`day-menu-open-${date}`}>
          {blockedOut ? (
            <button
              type="button"
              role="menuitem"
              data-testid={`day-undo-${date}`}
              onClick={() => {
                actions.onUndoBlockOut(date);
                close();
              }}
            >
              ↺ Undo day off
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="danger"
              data-testid={`day-block-${date}`}
              onClick={() => {
                actions.onBlockOut(date);
                close();
              }}
            >
              ⊘ Block out this day
            </button>
          )}
          <hr />
          <button
            type="button"
            role="menuitem"
            data-testid={`day-regenerate-${date}`}
            onClick={() => {
              if (blockedOut) {
                setNotice("Undo the day off first");
                return;
              }
              actions.onRegenerateDay(date);
              close();
            }}
          >
            ⟳ Regenerate day
          </button>
          {isOverride ? (
            <button
              type="button"
              role="menuitem"
              data-testid={`day-reset-${date}`}
              onClick={() => {
                // A blocked-out day IS an overridden day, and reset is exactly how its
                // override clears — so on one this item and Undo do the same thing.
                actions.onResetDay(date);
                close();
              }}
            >
              ⤺ Reset to auto
            </button>
          ) : null}
          {notice === null ? null : (
            <p
              className="note"
              role="status"
              data-testid={`day-menu-notice-${date}`}
            >
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * §17.2's cleared day. Rendered instead of the block stack, with the Undo the menu also
 * offers — a student who cleared a day by accident should not have to find a menu to
 * put it back.
 */
export function DayOffCard({
  date,
  onUndo,
}: {
  date: string;
  onUndo?: (date: string) => void;
}): JSX.Element {
  return (
    <div className="offcard" data-testid={`day-off-${date}`}>
      <b>Day off</b>
      Nothing is planned here, and the weekly refresh will leave it alone.
      {onUndo === undefined ? null : (
        <button
          type="button"
          data-testid={`day-off-undo-${date}`}
          onClick={() => onUndo(date)}
        >
          Undo day off
        </button>
      )}
    </div>
  );
}
