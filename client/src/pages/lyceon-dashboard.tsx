/**
 * Home (`/dashboard`): the student's first page.
 *
 * @spec [student-UI register UI-50; DESIGN.md §1 (tokens only, 14px floor, one primary action),
 *        §2 (App shell: right panel, slim legal footer), §4 Home; prototype Main.dc.html (paid
 *        and free); evidence/wiring-table.md §3 Home; register §2 Free versus paid, OQ-29 (the
 *        feature-access map decides what is locked, never a call to the gated route), OQ-36,
 *        OQ-39(c), OQ-49 (this route comes off the light lock: route-shells.ts)]
 *        | @implemented [2026-10-03]
 *
 * plain English: picks the paid or the free Home from the student's feature-access map (the
 * OQ-29 map on GET /api/profile, the same one the rail's locks read) and renders it. Paid means
 * the calendar AND mastery are granted: the paid Home reads both, so anything less is the free
 * Home, which calls no paid route. With no map (loading, a parse failure, a non-student) the
 * page waits for the profile and then shows the free Home: the server refuses a gated read
 * regardless, and showing less is the safe direction.
 *
 * Replaces the pre-redesign dashboard (weekly summary card, "Score Estimate" card, Practice and
 * Review tiles, "Score Trend Analysis", the "Alpha" recommendations card, the diagnostic prompt
 * modal and CTA card): the new Home's diagnostic card and right panel carry what they showed
 * that is still allowed, from the routes the wiring table names.
 */
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { FreeHome } from "@/components/home/FreeHome";
import { PaidHome } from "@/components/home/PaidHome";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { browserLocalToday } from "@/features/calendar/lib/dates";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useProfileQuery } from "@/hooks/useProfileQuery";

/** The paid Home needs both of the paid features it reads. */
function isPaidHome(access: FeatureAccessMap | null): boolean {
  return (
    access !== null &&
    access.calendar_access.access === "granted" &&
    access.mastery_detail.access === "granted"
  );
}

export default function LyceonDashboard(): JSX.Element {
  const { user } = useSupabaseAuth();
  const profile = useProfileQuery();
  const access = useFeatureAccess();

  if (user === null || profile.isLoading) {
    return (
      <div className="flex flex-col gap-4" data-testid="home-loading">
        <Skeleton variant="lyc" className="h-12 w-2/3" />
        <Skeleton variant="lyc" className="h-6 w-1/2" />
      </div>
    );
  }

  const name = user.display_name ?? null;
  if (isPaidHome(access)) {
    return (
      <PaidHome
        studentId={user.id}
        name={name}
        today={browserLocalToday()}
        hour={new Date().getHours()}
        examGranted={access?.exam_full_length.access === "granted"}
      />
    );
  }
  const mastery = access?.mastery_detail;
  return (
    <FreeHome
      studentId={user.id}
      name={name}
      masteryLock={mastery?.access === "locked" ? mastery.reason : "plan"}
    />
  );
}
