/**
 * `/guardian` — where a guardian lands.
 *
 * @spec [Guardian_Closure_Plan Wave 4 routing table: "`/guardian` redirects to the first
 *       linked student, or shows the no-student state"; G4-01] | @implemented [2026-09-30]
 *
 * plain English: with a linked student, go straight to the first one's Dashboard (the roster
 * order is the server's). With none, the page says so and offers the one thing to do — add a
 * student. The list is read from `GET /api/guardian/students`; nothing here decides access.
 */
import { Redirect } from "wouter";
import { GuardianShell } from "@/components/layout/GuardianShell";
import { useGuardianStudents } from "@/hooks/useGuardianStudents";
import { guardianPaths } from "./paths";

export function GuardianNoStudents(): JSX.Element {
  return (
    <section
      className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-16 text-center"
      data-testid="guardian-no-students"
    >
      <h1 className="text-2xl font-semibold">Add your first student</h1>
      <p className="text-base text-muted-foreground">
        Ask your student for the 6-character link code on their Profile page,
        under Settings. Once linked, you&rsquo;ll see their progress, study
        calendar and test results here.
      </p>
    </section>
  );
}

export default function GuardianHome(): JSX.Element {
  const { data, isLoading } = useGuardianStudents();
  const first = data?.students[0];
  if (first !== undefined) {
    return <Redirect to={guardianPaths.dashboard(first.id)} replace />;
  }
  return (
    <GuardianShell>
      {isLoading ? (
        <div
          className="py-16 text-center text-base"
          data-testid="guardian-loading"
        >
          Loading your students…
        </div>
      ) : (
        <GuardianNoStudents />
      )}
    </GuardianShell>
  );
}
