/**
 * The runner routes' full-screen states: a session that will not load, is closed, or cannot be
 * resumed. Shared by the practice and review runner pages.
 *
 * @spec [DESIGN.md §2 Focus shell (the page under the bar), §1 (one primary action); student-UI
 *        register UI-53; ruling 17 (a closed session is never playable)] | @implemented [2026-10-03]
 *
 * plain English: a centred column inside the Focus shell's body: a serif title, one line of
 * text, the one primary action (back to the section, client-side) and, where there is one, a
 * second outline action (Retry). Drawn on the student tokens. The wording is each page's
 * shipped copy; this component adds none.
 */
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Action = { label: string; onClick: () => void };

type RunnerStateCardProps = {
  tone: "neutral" | "danger";
  title: string;
  message: string;
  primary: Action;
  secondary: Action | null;
  "data-testid"?: string;
};

export function RunnerStateCard({
  tone,
  title,
  message,
  primary,
  secondary,
  "data-testid": testId,
}: RunnerStateCardProps): JSX.Element {
  return (
    <div
      data-testid={testId}
      className="flex h-full flex-col items-center justify-center gap-4 bg-lyc-paper px-4 py-12 text-center"
    >
      <h1
        className={cn(
          "m-0 font-lyc-serif text-lyc-section font-semibold",
          tone === "danger" ? "text-lyc-danger" : "text-lyc-ink-strong",
        )}
      >
        {title}
      </h1>
      <p className="m-0 max-w-md text-lyc-body-lg text-lyc-ink">{message}</p>
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        {secondary ? (
          <Button variant="lyc-outline" size="lyc" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        ) : null}
        <Button variant="lyc-primary" size="lyc" onClick={primary.onClick}>
          {primary.label}
        </Button>
      </div>
    </div>
  );
}
