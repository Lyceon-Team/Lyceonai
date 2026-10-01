/**
 * `/guardian/:studentId/exams[/:sessionId]` — the student's full-length results, list and
 * detail, inside the guardian shell under the Dashboard tab (G4-05 finishes it).
 *
 * @spec [Guardian_Closure_Plan G4-01, G4-05; SCL-180/181/189/192] | @implemented [2026-09-30]
 */
import GuardianExamResultsPage from "@/features/exam/pages/GuardianExamResultsPage";
import { GuardianStudentLayout } from "./GuardianStudentLayout";

export default function GuardianExamsPage(): JSX.Element {
  return (
    <GuardianStudentLayout>
      <GuardianExamResultsPage />
    </GuardianStudentLayout>
  );
}
