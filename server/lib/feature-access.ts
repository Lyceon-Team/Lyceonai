/**
 * The student's feature-access map for GET /api/profile (OQ-29).
 *
 * @spec [student-UI register OQ-29, owner ruling (Karl) 2026-10-02; Doc 03 §12.5 / INV-03-07
 *        (LISA age gate); Doc 01 §26 (`canAccessFeature`); SCL-185] | @implemented [2026-10-02]
 *
 * plain English: one entry per locked surface, each computed by the predicate that surface's
 * route enforces, in the order the route applies it:
 *   - tutor_access: `requireStudentOnly`'s age test (`passesTutorAgeGate`) first, then the
 *     tutor's own `isEntitlementActiveForProfile` (`denyIfNotEntitled`). Under 13 is `age`.
 *   - exam_full_length: `canAccessFeature(id, "exam_full_length")` (`authorizeExamCaller`).
 *   - calendar_access: `canAccessFeature(id, "calendar_access")` (calendar `entitled()`).
 *   - mastery_detail: `canAccessFeature(id, "mastery_detail")` (`entitlementGate`).
 * The keys are literal here so this module does not import whole route files; the test checks
 * they equal the routes' own constants.
 *
 * trade-offs: four reads per profile load (three feature checks and the tutor predicate). The
 * route still decides on every request, so a stale map can only show the wrong lock, never open
 * a surface.
 * edge cases: the predicates fail closed (a failed read is "no access"), so a read failure shows
 * as `plan`. Non-students get no map (null): the locks are a student-shell concern.
 */
import type {
  FeatureAccessEntry,
  FeatureAccessMap,
} from "../../packages/shared/src/feature-access";
import type { SupabaseUser } from "../middleware/supabase-auth";
import { passesTutorAgeGate } from "../middleware/supabase-auth";
import { EntitlementService } from "../services/entitlement-service";

const GRANTED: FeatureAccessEntry = { access: "granted" };
const LOCKED_PLAN: FeatureAccessEntry = { access: "locked", reason: "plan" };
const LOCKED_AGE: FeatureAccessEntry = { access: "locked", reason: "age" };

async function byFeature(
  studentId: string,
  key: "exam_full_length" | "calendar_access" | "mastery_detail",
): Promise<FeatureAccessEntry> {
  return (await EntitlementService.canAccessFeature(studentId, key))
    ? GRANTED
    : LOCKED_PLAN;
}

async function tutorAccess(
  user: Pick<SupabaseUser, "id" | "is_under_13">,
): Promise<FeatureAccessEntry> {
  if (!passesTutorAgeGate(user)) return LOCKED_AGE;
  return (await EntitlementService.isEntitlementActiveForProfile(user.id))
    ? GRANTED
    : LOCKED_PLAN;
}

export async function resolveFeatureAccess(
  user: Pick<SupabaseUser, "id" | "role" | "is_under_13">,
): Promise<FeatureAccessMap | null> {
  if (user.role !== "student") return null;
  const [tutor_access, exam_full_length, calendar_access, mastery_detail] =
    await Promise.all([
      tutorAccess(user),
      byFeature(user.id, "exam_full_length"),
      byFeature(user.id, "calendar_access"),
      byFeature(user.id, "mastery_detail"),
    ]);
  return { tutor_access, exam_full_length, calendar_access, mastery_detail };
}
