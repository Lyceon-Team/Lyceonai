/**
 * Student-facing words for exam states and modes.
 *
 * @spec [Doc-04C_V1.0, §5.1 (ReportState); §2.3 (no routing language)]
 *       [E7b owner ruling 2: the card shows state words only, never a score (§15.1)]
 * @implemented [2026-09-25]
 *
 * plain English: the student's words, not the enum's. "Module 2 of 2" is the only
 * way Module 2 is ever named — no path, no difficulty (04C §2.3).
 */
import type { ExamReportState } from "@lyceon/shared/exam-report-schema";
import type { ExamMode, ExamModule } from "@lyceon/shared/exam-runtime-schema";

type SessionState =
  | "created"
  | "active"
  | "section_break"
  | "completed"
  | "abandoned_final"
  | "partial_scored_abandoned";

export function formCardStateLabel(
  latest: { state: SessionState; report_state: ExamReportState } | null,
): string {
  if (latest === null) return "Not started";
  switch (latest.report_state) {
    case "scored":
      return "Scored";
    case "scoring_pending":
      return "Scoring";
    case "partial_scored":
      return "Partial score";
    case "failed_requires_review":
      return "Needs review";
    case "unavailable":
      return "Unavailable";
    case "voided":
      return "Unavailable";
    case "not_completed":
      // abandoned_final is past its window with nothing scoreable (04A §14.3).
      return latest.state === "abandoned_final" ? "Not finished" : "In progress";
  }
}

export const MODE_LABEL: Record<ExamMode, string> = {
  strict: "Test-day timing",
  lenient: "Practice timing",
};

export const MODE_SHORT_LABEL: Record<ExamMode, string> = {
  strict: "Test-day",
  lenient: "Practice",
};

/** "Module 1 of 2" / "Module 2 of 2" — and nothing more (04C §2.3). */
export function moduleLabel(module: ExamModule): string {
  return `Module ${module} of 2`;
}

export function minutesLabel(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
