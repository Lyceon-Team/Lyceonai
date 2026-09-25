/**
 * Exam countdown — pure arithmetic over a MONOTONIC clock.
 *
 * @spec [Doc-04A_V2.2, §4 #7 (server is the source of time), §8.2 (remaining_ms is
 *        the server's), §8.3 (every heartbeat returns it); Coding Standards §4.3]
 *       [E7b decision log D2 (monotonic display, resync on every response)]
 * @implemented [2026-09-25]
 *
 * plain English: the display counts down from the server's last `remaining_ms`,
 * measured against `performance.now()` — never `Date.now()` — so moving the system
 * clock forward or back does not move the timer. Every server response re-anchors it,
 * so drift is bounded by the heartbeat interval. The client never decides a module
 * has ended: at zero it asks the server, which applies the timeout (§8.4).
 *
 * edge cases: a monotonic reading earlier than the anchor (it cannot happen, but a
 * test clock can do it) counts as zero elapsed, never as time added back.
 */

export type ClockAnchor = {
  /** The server's remaining_ms at the moment of the anchor. */
  remainingMs: number;
  /** The monotonic reading (performance.now()) when that value arrived. */
  at: number;
};

export const FIVE_MINUTES_MS = 5 * 60 * 1000;
export const ONE_MINUTE_MS = 60 * 1000;

export function anchorClock(remainingMs: number, monotonicNow: number): ClockAnchor {
  return { remainingMs: Math.max(0, remainingMs), at: monotonicNow };
}

export function remainingAt(anchor: ClockAnchor, monotonicNow: number): number {
  const elapsed = Math.max(0, monotonicNow - anchor.at);
  return Math.max(0, anchor.remainingMs - elapsed);
}

/** "31:42"; an hour or more (never on this surface) reads "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${String(m).padStart(2, "0")}:${ss}`;
}

/** Words for a screen reader: "4 minutes 18 seconds". */
export function spokenClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (s > 0 || m === 0) parts.push(`${s} second${s === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/**
 * Bluebook behaviour (owner ruling, E7b): a hidden timer comes back at five minutes
 * and cannot be hidden again. Hide/Show is display only; it never touches timing.
 */
export function timerForcedVisible(remainingMs: number): boolean {
  return remainingMs <= FIVE_MINUTES_MS;
}

/**
 * The polite announcements: once when five minutes remain and once at one minute.
 * Returns the threshold crossed between two readings, or null. Never per tick.
 */
export function crossedAnnouncement(
  previousMs: number,
  currentMs: number,
): "five_minutes" | "one_minute" | null {
  if (previousMs > ONE_MINUTE_MS && currentMs <= ONE_MINUTE_MS) return "one_minute";
  if (previousMs > FIVE_MINUTES_MS && currentMs <= FIVE_MINUTES_MS) return "five_minutes";
  return null;
}
