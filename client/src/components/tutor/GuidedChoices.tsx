/**
 * @spec [owner brief "LISA guided choices in review, Phase A" (Karl, 2026-10-27) build 5 and
 *        rulings 1–2 of 2026-10-27; SCL-252/SCL-253; docs/plans/student-ui/design/DESIGN.md §5]
 *       | @implemented [2026-10-27]
 *
 * plain English: the review panel's guided choices: one outline button per choice the server
 * offered for this item (GET /api/tutor/guided-choices), in the server's order, labelled with the
 * shared fixed label. A tap sends exactly that label with the choice's intent through the panel's
 * one send path; typing stays available below. Which choices exist is the server's answer, never
 * decided here (the section and the Phase B flag are read on the server).
 *
 * DESIGN.md §5: each choice is an action (it sends), not a value picked from a list, so they are
 * outline buttons (no filled primary); at most four, wrapping on a narrow panel. While the
 * server's answer loads, a still skeleton row holds the space; if it fails, one muted line says
 * so and the composer is still there.
 */
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  REVIEW_INTENT_LABELS,
  type ReviewIntent,
} from "@lyceon/shared/tutor-guided-choices";

/** What the panel knows about this item's choices. */
export type GuidedChoicesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; intents: ReviewIntent[] };

export function GuidedChoiceButtons({
  choices,
  onChoose,
  disabled,
}: {
  choices: GuidedChoicesState;
  onChoose: (intent: ReviewIntent) => void;
  disabled: boolean;
}): JSX.Element | null {
  if (choices.status === "loading") {
    return (
      <div role="status" aria-label="Loading ways LISA can help">
        <Skeleton variant="lyc" className="h-11 w-full" />
      </div>
    );
  }
  if (choices.status === "error") {
    return (
      <p
        className="m-0 text-lyc-body text-lyc-muted"
        data-testid="tutor-guided-choices-error"
      >
        Quick choices aren&apos;t available right now. You can still type a
        question below.
      </p>
    );
  }
  if (choices.intents.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Ways LISA can help"
      data-testid="tutor-guided-choices"
    >
      {choices.intents.map((intent) => (
        <Button
          key={intent}
          type="button"
          variant="lyc-outline"
          disabled={disabled}
          onClick={() => onChoose(intent)}
          data-testid={`tutor-choice-${intent}`}
        >
          {REVIEW_INTENT_LABELS[intent]}
        </Button>
      ))}
    </div>
  );
}

/** True when there is at least one choice to show. */
export function hasGuidedChoices(choices: GuidedChoicesState | null): boolean {
  return (
    choices !== null && choices.status === "ready" && choices.intents.length > 0
  );
}
