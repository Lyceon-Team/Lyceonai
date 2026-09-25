/**
 * Submit confirmation.
 *
 * @spec [Doc-04A_V2.2 §12 (module submit); §9.3 + 04C §2.3 (no routing inference)]
 *       [E7 owner ruling 6: the dialog says only "You cannot return to this module."]
 * @implemented [2026-09-25]
 *
 * plain English: answered / unanswered / marked from the one summary, time left from
 * the live clock, and one sentence. No sentence about Module 2's difficulty: the
 * mockup's "the difficulty of Module 2 is set from this result" invites the routing
 * inference §9.3 exists to prevent, and is not built.
 */
import type { ExamModule } from "@lyceon/shared/exam-runtime-schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatClock } from "../lib/countdown";
import type { ModuleSummary } from "../lib/module-summary";
import { useReturnFocus } from "../hooks/useReturnFocus";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: ExamModule;
  summary: ModuleSummary;
  remainingMs: number;
  submitting: boolean;
  onConfirm: () => void;
};

export function SubmitModuleDialog(props: Props) {
  const { summary } = props;
  const focus = useReturnFocus();
  const rows: Array<[string, string]> = [
    ["Answered", `${summary.answered} of ${summary.total}`],
    ["Unanswered", String(summary.unanswered)],
    ["Marked for review", String(summary.marked)],
    ["Time remaining", formatClock(props.remainingMs)],
  ];
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent
        className="exam-root max-w-[520px] gap-[18px] rounded-2xl bg-[var(--exam-surface)] p-8"
        onOpenAutoFocus={focus.onOpenAutoFocus}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <AlertDialogTitle className="m-0 font-serif text-[26px] font-semibold">
          Submit Module {props.module}?
        </AlertDialogTitle>
        <dl className="m-0 flex flex-col gap-2.5" data-testid="exam-submit-counts">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between rounded-lg bg-[var(--exam-bg)] px-3.5 py-2.5 text-sm">
              <dt className="text-[var(--exam-muted)]">{label}</dt>
              <dd className="m-0 font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <AlertDialogDescription className="m-0 text-sm leading-relaxed text-[var(--exam-muted)]">
          You cannot return to this module.
        </AlertDialogDescription>
        <AlertDialogFooter className="mt-1 gap-3">
          <AlertDialogCancel className="min-h-[48px] rounded-full px-5 text-[15px]">Keep working</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              props.onConfirm();
            }}
            disabled={props.submitting}
            data-testid="exam-submit-confirm"
            className="min-h-[48px] rounded-full bg-[var(--exam-accent)] px-6 text-[15px] font-semibold text-white hover:bg-[var(--exam-accent-hover)]"
          >
            {props.submitting ? "Submitting…" : "Submit module"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
