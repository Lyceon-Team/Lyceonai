/**
 * `/guardian/:studentId` — the Dashboard tab. Filled by G4-03 (Q-L1 contents).
 *
 * @spec [Guardian_Closure_Plan G4-01 (the route), G4-03 (the contents)] | @implemented [2026-09-30]
 */
import { GuardianStudentLayout } from "./GuardianStudentLayout";

export default function GuardianDashboardTab(): JSX.Element {
  return (
    <GuardianStudentLayout>
      <div data-testid="guardian-dashboard-tab" />
    </GuardianStudentLayout>
  );
}
