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
 *
 * @updated 2026-10-22 — owner brief "LISA chat dock" (Karl): the LISA bubble (`ChatDock`, general
 * mode) on both Homes, at tablet and desktop widths.
 */
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { FreeHome } from "@/components/home/FreeHome";
import { HomeLoading } from "@/components/home/HomeLoading";
import { PaidHome } from "@/components/home/PaidHome";
import { ChatDock, type ChatDockScope } from "@/components/tutor/ChatDock";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { browserLocalToday } from "@/features/calendar/lib/dates";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useProfileQuery } from "@/hooks/useProfileQuery";

/**
 * The LISA launcher on Home opens LISA in general mode (owner brief, 2026-10-22), with Home's
 * opening line (owner brief "LISA launcher", Karl, 2026-10-23).
 */
const GENERAL_DOCK: ChatDockScope = { kind: "general", surface: "home" };

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

  // QA2-F: the same placeholder the paid and free Home show until their own reads answer.
  if (user === null || profile.isLoading) return <HomeLoading />;

  const name = user.display_name ?? null;
  const mastery = access?.mastery_detail;
  return (
    <>
      {isPaidHome(access) ? (
        <PaidHome
          studentId={user.id}
          name={name}
          today={browserLocalToday()}
          hour={new Date().getHours()}
          examGranted={access?.exam_full_length.access === "granted"}
        />
      ) : (
        <FreeHome
          studentId={user.id}
          name={name}
          masteryLock={mastery?.access === "locked" ? mastery.reason : "plan"}
        />
      )}
      {/* Owner brief "LISA chat dock" (Karl, 2026-10-22): the LISA bubble, general mode, at
          tablet and desktop widths (ChatDock draws nothing on a phone). Locked for a free
          student by the rail's own check (the upgrade modal; no tutor request). */}
      <ChatDock scope={GENERAL_DOCK} />
    </>
  );
}
