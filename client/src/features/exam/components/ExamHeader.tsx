/**
 * The exam header: section, "Module N of 2", timer, Math tools.
 *
 * @spec [Doc-04C_V1.0 §2.3 (no routing language: "Module 2 of 2" and nothing more);
 *        SCL-132] | @implemented [2026-09-25]
 *
 * design defect logged (E7b D8): the mockup's Math header read "Module 2 of 2 ·
 * harder". That names the routed path; it is not built.
 */
import type { ReactNode } from "react";
import type { ExamModule, ExamSection } from "@lyceon/shared/exam-runtime-schema";
import { EXAM_SECTION_LABEL } from "@lyceon/shared/exam-report-schema";
import { moduleLabel } from "../lib/labels";

type Props = {
  section: ExamSection;
  module: ExamModule;
  timer: ReactNode;
  tools?: ReactNode;
};

export function ExamHeader({ section, module, timer, tools }: Props) {
  return (
    <header className="flex min-h-[74px] shrink-0 items-center justify-between gap-4 border-b border-[var(--exam-line)] bg-[var(--exam-surface)] px-4 md:px-7">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="m-0 text-base font-semibold">{EXAM_SECTION_LABEL[section]}</h1>
        <p className="m-0 text-[13px] text-[var(--exam-muted)]" data-testid="exam-module-label">
          {moduleLabel(module)}
        </p>
      </div>
      <div className="shrink-0">{timer}</div>
      <div className="flex min-w-0 flex-1 justify-end gap-2">{tools}</div>
    </header>
  );
}
