/**
 * The streak chip, top right of Home's centre column.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09) "Home" 2: "Start your
 *       streak" at 0; "🔥 N · Today ✓" once today is done; "🔥 N · keep it going today" otherwise;
 *       after a break, "Start a new streak today". No guilt copy; reduced motion respected;
 *       SCL-226 (the streak is the server's `student_streak`)] | @implemented [2026-10-09]
 *
 * plain English: the words come from the shared `streakChipText` (the same function the tests
 * use). When the streak has just been extended the chip zooms in once; `motion-safe:` keeps that
 * off for anyone who asked for reduced motion (and the global reduced-motion rule backs it up).
 * A polite live region announces the new text.
 */
import { streakChipText, type Streak } from "@lyceon/shared/home-qotd-schema";
import { useHomeQotd } from "@/hooks/useHomeQotd";
import { cn } from "@/lib/utils";

export function StreakChip({
  streak,
  celebrate = false,
}: {
  streak: Streak;
  /** True right after this visit extended the streak: one zoom-in. */
  celebrate?: boolean;
}): JSX.Element {
  const text = streakChipText(streak);
  const lit = streak.current > 0;
  return (
    <span
      key={celebrate ? `lit-${streak.current}` : "still"}
      role="status"
      aria-live="polite"
      data-testid="home-streak-chip"
      data-today-done={streak.today_done ? "true" : "false"}
      className={cn(
        "inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full border px-4 py-1.5 text-lyc-meta-lg font-semibold",
        lit
          ? "border-lyc-lv2-bd bg-lyc-lv2-bg text-lyc-lv2-ink"
          : "border-lyc-rule bg-lyc-sheet text-lyc-ink",
        celebrate &&
          "motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-500",
      )}
    >
      {text}
    </span>
  );
}

/**
 * The chip as Home draws it: the streak from the one QOTD read (GET /api/qotd/today). Nothing
 * while that read is loading or failed — the chip never shows a number it could not read.
 */
export function HomeStreakChip({
  celebrate,
}: {
  celebrate: boolean;
}): JSX.Element | null {
  const today = useHomeQotd();
  if (today.data === undefined) return null;
  return <StreakChip streak={today.data.streak} celebrate={celebrate} />;
}
