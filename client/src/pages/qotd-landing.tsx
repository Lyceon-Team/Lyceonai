/**
 * `/qotd`: today's Question of the Day on its own, then "5 more?" (the `qotd_then_more` landing).
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26), Landings: "Today's QOTD, then '5 more?'
 *        set"; Karl's ruling D on Step 0 the same day ("full-screen QOTD route as mocked (straight
 *        to '5 more?' if already answered)"); DESIGN.md §2 Focus shell, §5 UI standards (one filled
 *        primary, tokens only, 14px floor, empty/loading/error states)] | @implemented [2026-10-26]
 *
 * plain English: the Focus shell (its back link reads "Home" and goes Home, since the landing
 * replaced Home), the same QOTD card Home shows, and once today's question is answered a "5 more?"
 * card: "Start 5 more" (the screen's one filled button) asks the server, which checks that today's
 * landing is this one and starts a 5-question set whose first two questions are easy or medium;
 * "Not now" goes Home. When the server starts nothing (no quota left, no questions), a notice
 * says so with a way Home.
 */
import { useLocation } from "wouter";
import { HomeQotdSection } from "@/components/home/qotd/HomeQotdSection";
import { Notice } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { useHomeQotd } from "@/hooks/useHomeQotd";
import { useLandingMore } from "@/hooks/useSmartLanding";

function noStreakCelebration(): void {
  // Home celebrates a streak in its own header; this page has no such header to update.
}

function FiveMoreCard(): JSX.Element {
  const [, navigate] = useLocation();
  const more = useLandingMore();
  const startedNothing = more.isSuccess && more.data.path === null;

  if (more.isError || startedNothing) {
    return (
      <Notice
        title="No more questions right now."
        message="You can keep practising from Home."
        actionLabel="Go to Home"
        onAction={() => navigate("/dashboard")}
        data-testid="qotd-more-unavailable"
      />
    );
  }

  return (
    <section
      aria-labelledby="qotd-more-title"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-lyc-rule-strong bg-lyc-sheet p-5"
      data-testid="qotd-more"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          id="qotd-more-title"
          className="m-0 font-serif text-[22px] font-semibold text-lyc-ink-strong"
        >
          5 more?
        </h2>
        <p className="m-0 text-base text-lyc-muted">
          A short set while you&rsquo;re warmed up.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="lyc-quiet"
          onClick={() => navigate("/dashboard")}
          data-testid="qotd-more-not-now"
        >
          Not now
        </Button>
        <Button
          type="button"
          variant="lyc-primary"
          size="lyc-lg"
          pending={more.isPending}
          disabled={more.isPending}
          onClick={() =>
            more.mutate(undefined, {
              onSuccess: (result) => {
                if (result.path !== null)
                  navigate(result.path, { replace: true });
              },
            })
          }
          data-testid="qotd-more-start"
        >
          Start 5 more
        </Button>
      </div>
    </section>
  );
}

export default function QotdLanding(): JSX.Element {
  const today = useHomeQotd();
  const answered = today.data?.state === "answered";
  return (
    <div className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-4 py-8 lg:px-8">
      <HomeQotdSection onStreakExtended={noStreakCelebration} />
      {answered ? <FiveMoreCard /> : null}
    </div>
  );
}
