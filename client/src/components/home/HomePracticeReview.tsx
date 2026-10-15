/**
 * Practice and Review on Home, free and Pro: two outlined buttons straight to the pages.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §4 "Practice and Review: on Home for free and Pro, as
 *       outlined buttons going straight to /practice and /review"] | @implemented [2026-10-13]
 */
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export function HomePracticeReview(): JSX.Element {
  return (
    <nav
      aria-label="Practice and Review"
      className="flex flex-wrap items-center gap-3"
      data-testid="home-practice-review"
    >
      <Button asChild variant="lyc-outline" size="lyc-lg">
        <Link href="/practice" data-testid="home-go-practice">
          Go to Practice
        </Link>
      </Button>
      <Button asChild variant="lyc-outline" size="lyc-lg">
        <Link href="/review" data-testid="home-go-review">
          Go to Review
        </Link>
      </Button>
    </nav>
  );
}
