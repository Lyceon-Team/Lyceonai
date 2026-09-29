/**
 * The module timer display.
 *
 * @spec [Doc-04A_V2.2 §8.2 (server time); E7b brief: Hide/Show is display only;
 *        announced politely, not per tick; owner: reappears at five minutes]
 * @implemented [2026-09-25]
 *
 * plain English: shows mm:ss from the hook's monotonic countdown. Hide/Show changes
 * nothing but what is drawn. At five minutes the timer comes back and the toggle
 * goes away. The only live region speaks at five minutes and at one minute — the
 * digits themselves are never live, so a screen reader is not read a number a second.
 */
import { useState } from "react";
import {
  crossedAnnouncement,
  formatClock,
  spokenClock,
  timerForcedVisible,
} from "../lib/countdown";

export function ExamTimer({ remainingMs }: { remainingMs: number }) {
  const [hidden, setHidden] = useState(false);
  const [previousMs, setPreviousMs] = useState(remainingMs);
  const [announcement, setAnnouncement] = useState("");

  // React's "state from the previous render" pattern: the crossing is detected
  // during render, from the last value this component drew.
  if (previousMs !== remainingMs) {
    setPreviousMs(remainingMs);
    const crossed = crossedAnnouncement(previousMs, remainingMs);
    if (crossed !== null) {
      setAnnouncement(
        crossed === "five_minutes"
          ? "5 minutes remaining in this module."
          : "1 minute remaining in this module.",
      );
    }
  }

  const forced = timerForcedVisible(remainingMs);
  const showDigits = forced || !hidden;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className="font-mono text-[30px] font-medium tracking-[1px] tabular-nums"
        data-testid="exam-timer"
        aria-label={showDigits ? `Time remaining: ${spokenClock(remainingMs)}` : "Timer hidden"}
        role="timer"
      >
        {showDigits ? formatClock(remainingMs) : <span aria-hidden="true">— : —</span>}
      </div>
      {!forced && (
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          aria-pressed={hidden}
          className="min-h-[44px] rounded-full px-4 text-xs text-[var(--exam-muted)] underline-offset-2 hover:underline"
        >
          {hidden ? "Show" : "Hide"}
        </button>
      )}
      <div aria-live="polite" className="sr-only" data-testid="exam-timer-announcement">
        {announcement}
      </div>
    </div>
  );
}
