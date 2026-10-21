/**
 * The review ask's place on the student's Home.
 *
 * @spec [Karl's Step 0 decision 7 on the review ask (2026-10-20): "the desktop card sits below
 *        the Getting started checklist and today's question, and never shows while the checklist
 *        is active; the phone bottom sheet likewise never shows while the checklist is active, or
 *        during practice, review or a test"; owner brief "Review ask" (Karl, 2026-10-20)]
 *        | @implemented [2026-10-20]
 *
 * plain English: Home renders this right after today's question. It asks for the `home` moment,
 * or `email_return` when the student arrived from the review email (`?review=email`), and only
 * once the Getting started checklist has no open step — a finished card still waiting for its
 * Dismiss does not hold it back. The server checks the same thing itself (and the usage trigger
 * and cadence), so this only saves a request; it never decides. Home is the only student page
 * that mounts it, so it can never appear during practice, review or a test.
 */
import { useSearch } from "wouter";
import { ReviewPrompt } from "@/components/product-feedback/ReviewPrompt";
import { cameFromReviewEmail } from "@/lib/product-feedback-api";
import type { GettingStartedResponse } from "../../../../packages/shared/src/getting-started-schema";

export function HomeReviewAsk({
  checklist,
}: {
  /** Home's checklist (null once dismissed or when its read failed). */
  checklist: GettingStartedResponse | null;
}): JSX.Element {
  const moment = cameFromReviewEmail(useSearch()) ? "email_return" : "home";
  const checklistActive = checklist !== null && !checklist.complete;
  return (
    <ReviewPrompt
      query={{ moment }}
      enabled={moment === "email_return" || !checklistActive}
      variant="lyc"
    />
  );
}
