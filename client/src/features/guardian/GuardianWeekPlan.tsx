/**
 * The guardian Dashboard's "This week's plan" card (G5-02).
 *
 * @spec [Guardian_Closure_Plan G5-02; ruling R13 (Karl, 2026-10-02); the canvas boards "Wave 5 —
 *       BUILD TARGET"; Doc 05F §14 / R-08-28 (facts are counts)] | @implemented [2026-10-02]
 *
 * plain English: "X of Y sessions done" for the week the Calendar tab shows, with one bar
 * segment per planned session and the completed ones filled navy.
 *
 * WHERE X AND Y COME FROM (established for this row). The current week's calendar payload
 * carries `facts.blocks_completed` and `facts.blocks_total`, which the read model's `factsOf`
 * counts from the very day blocks the calendar draws; the Calendar footer's "N blocks
 * complete" is that same `blocks_completed`. Reading the facts — never re-counting blocks
 * here — is what keeps this card and the footer in step (`week-plan.test.tsx` holds them to
 * one number).
 *
 * MORE THAN 20 PLANNED SESSIONS draws one continuous bar instead of segments: past twenty a
 * segment is narrower than it is tall, and the row stops reading as a count. The bar's fill
 * is drawn, not printed — the card's words stay counts, never a percentage (R-08-28).
 * No session planned: a sentence, and no bar to fill.
 *
 * Tokens only: `primary` for done, the token layer's `--cream-300` for not yet, `card` behind.
 */
const SEGMENT_LIMIT = 20;

export function GuardianWeekPlan({
  completed,
  total,
}: {
  completed: number;
  total: number;
}): JSX.Element {
  const done = Math.min(completed, total);
  const summary =
    total === 0
      ? "No sessions planned this week"
      : `${done} of ${total} sessions done`;
  return (
    <section
      className="flex flex-col items-center gap-2.5 rounded-[20px] border border-[color:var(--cream-300)] bg-card px-6 py-[18px] text-center sm:flex-row sm:gap-6 sm:text-left"
      data-testid="week-plan"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-medium text-muted-foreground">
          {"This week's plan"}
        </span>
        <span className="text-xl font-bold">{summary}</span>
      </div>
      {total === 0 ? null : total > SEGMENT_LIMIT ? (
        <div
          role="img"
          aria-label={summary}
          className="h-3.5 w-full grow overflow-hidden rounded-[7px] bg-[color:var(--cream-300)]"
          data-testid="week-plan-bar"
        >
          <div
            className="h-full rounded-[7px] bg-primary"
            style={{ width: `${(done / total) * 100}%` }}
            data-testid="week-plan-bar-fill"
          />
        </div>
      ) : (
        <div
          role="img"
          aria-label={summary}
          className="flex w-full grow gap-[5px]"
        >
          {Array.from({ length: total }, (_unused, index) => {
            const on = index < done;
            return (
              <div
                key={index}
                aria-hidden="true"
                data-testid="week-plan-segment"
                data-done={on ? "true" : "false"}
                className={`h-3.5 flex-1 rounded-[7px] ${on ? "bg-primary" : "bg-[color:var(--cream-300)]"}`}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
