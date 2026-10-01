/**
 * The student switcher in the centre of the guardian top bar.
 *
 * @spec [Guardian_Closure_Plan Wave 4 layout ("centre: the selected student's name, as a
 *       dropdown for switching students"), G4-02] | @implemented [2026-09-30]
 *
 * plain English: the SELECTED student is the one in the URL, never component state; choosing
 * another is a navigation to the same tab for that student, so every per-student query (all
 * keyed by the student id) reads the new student and nothing from the previous one survives
 * on screen. A lapsed student is marked "Subscription ended" in the list, from the roster's
 * server-derived `entitlement_lapsed` — shown, never used to hide or gate anything.
 */
import { useLocation, useParams } from "wouter";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { studentLabel, useGuardianStudents } from "@/hooks/useGuardianStudents";
import { guardianPaths } from "./paths";
import { tabForLocation } from "./GuardianStudentLayout";

export function StudentSwitcher(): JSX.Element | null {
  const { studentId } = useParams<{ studentId: string }>();
  const [location, navigate] = useLocation();
  const { data } = useGuardianStudents();
  const students = data?.students ?? [];
  const current = students.find((s) => s.id === studentId);
  if (students.length === 0) return null;

  const tab = tabForLocation(location);
  const hrefFor = (id: string): string =>
    tab === "calendar"
      ? guardianPaths.calendar(id)
      : guardianPaths.dashboard(id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-h-[44px] max-w-full rounded-full px-4 text-base font-semibold"
          data-testid="student-switcher"
          aria-label={
            current
              ? `Viewing ${studentLabel(current)}. Switch student`
              : "Switch student"
          }
        >
          <span className="truncate">
            {current ? studentLabel(current) : "Choose a student"}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-[260px]">
        {students.map((s) => (
          <DropdownMenuItem
            key={s.id}
            className="min-h-[48px] gap-2 text-base"
            onSelect={() => navigate(hrefFor(s.id))}
            data-testid={`student-switcher-item-${s.id}`}
            aria-current={s.id === studentId ? "true" : undefined}
          >
            <span className="flex-1 truncate">{studentLabel(s)}</span>
            {s.entitlement_lapsed && (
              <span
                className="rounded-full bg-secondary px-2 py-0.5 text-base"
                data-testid="student-switcher-lapsed"
              >
                Subscription ended
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
