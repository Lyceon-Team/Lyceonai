/**
 * Home's loading state: one placeholder for the whole page until every read the page draws from
 * has answered.
 *
 * @spec [production QA 2026-10-08 item F (Karl: "Full-Length cards: no layout shift on load");
 *       DESIGN.md §1 (tokens only), §4 Home] | @implemented [2026-10-08]
 *
 * plain English: Home is a stack of sections (today's plan or the diagnostic card, the
 * Full-Length card, mastery, pick up; the panel's projection, week and recent sessions), and
 * each used to appear as its own read landed. Every landing pushed what was already drawn under
 * it, the Full-Length card most of all: a measured layout shift of 0.12 to 0.62 (paid, 390
 * worst). Now the page shows this placeholder (the shared page skeleton, the right panel's
 * block) until all of its reads have answered or failed, and then the whole page at once, so
 * nothing on screen moves. It reserves the screen's height, so the legal footer under it starts
 * below the screen and is never pulled up into view and pushed back.
 *
 * trade-offs: the page waits for its slowest read instead of drawing section by section. A read
 * that fails ends the wait like one that answers (the page then shows its "couldn't load part of
 * your dashboard" notice), so a slow read delays the page but never holds it.
 */
import { AppShellPanel } from "@/components/layout/app-shell";
import { PageSkeleton } from "@/components/layout/RouteSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export function HomeLoading(): JSX.Element {
  return (
    <div className="min-h-[100dvh]" data-testid="home-loading">
      <PageSkeleton />
      <AppShellPanel>
        <Skeleton
          variant="lyc"
          className="h-[320px] w-full"
          data-testid="home-panel-loading"
        />
      </AppShellPanel>
    </div>
  );
}
