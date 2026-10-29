/**
 * @spec [owner ruling on #1349 (Karl, 2026-10-27), ruling 3: "On phones, where the panel is closed
 *       by default, the 'Show LISA' bar carries the same choices. Tapping one opens the panel and
 *       sends that intent. Desktop is unchanged"; SCL-254 (§20.2's choices)] | @implemented
 *       [2026-10-27]
 *
 * plain English: the phone runner's LISA strip, shown under the question while the LISA panel is
 * closed. It carries exactly the choices the panel would show (the same server answer, GET
 * /api/tutor/guided-choices, read through the same query, so the two never disagree). A tap hands
 * the intent to the runner, which opens the panel; the panel sends the choice's exact label with
 * that intent through its one send path. Nothing is sent from here.
 *
 * States: while the server's answer loads, or if it fails, or when the item offers no choices,
 * the strip is not drawn: the "Show LISA" button in the bar still opens the panel, which has its
 * own loading and error states.
 */
import type { ReviewIntent } from "@lyceon/shared/tutor-guided-choices";
import { useGuidedChoices } from "@/hooks/tutor-client";
import { LisaAvatar } from "@/components/tutor/TutorThreadParts";
import { GuidedChoiceButtons } from "@/components/tutor/GuidedChoices";

export function GuidedChoicesBar({
  sessionItemId,
  onChoose,
}: {
  sessionItemId: string;
  onChoose: (intent: ReviewIntent) => void;
}): JSX.Element | null {
  const choices = useGuidedChoices(sessionItemId);
  if (choices.data === undefined || choices.data.length === 0) return null;
  return (
    <section
      className="mx-auto w-full max-w-[760px] px-4 pb-8"
      aria-label="Get help from LISA"
      data-testid="guided-choices-bar"
    >
      <div className="flex flex-col gap-3 rounded-lg border border-lyc-rule bg-lyc-paper p-4">
        <div className="flex items-center gap-2">
          <LisaAvatar />
          <p className="m-0 text-lyc-body font-semibold text-lyc-ink-strong">
            Need help with this question?
          </p>
        </div>
        <GuidedChoiceButtons
          choices={{ status: "ready", intents: choices.data }}
          disabled={false}
          onChoose={onChoose}
        />
      </div>
    </section>
  );
}
