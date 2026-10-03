/**
 * @spec [student-UI register OQ-29 (owner ruling 2026-10-02: a feature-access map on
 *        GET /api/profile, reason plan | age); §2 Free versus paid (rail locks with no call to the
 *        gated endpoint); UI-41] | @implemented [2026-10-03]
 *
 * plain English: the student's feature-access map, read from the one cached profile query and
 * parsed with the shared schema. The rail draws its locks from this and nothing else: never from
 * the role or plan, never from calling the gated endpoint.
 *
 * Edge cases: signed out, still loading, a non-student (the server sends null) or a body the
 * schema rejects all give null, which draws no lock. That is a display choice only: the server
 * refuses the gated request regardless, and its `entitlement_required` answer opens the upgrade
 * modal through the provider's denial listener (UI-44).
 */
import {
  featureAccessMapSchema,
  type FeatureAccessMap,
} from "@lyceon/shared/feature-access";
import { useProfileQuery } from "./useProfileQuery";

export function useFeatureAccess(): FeatureAccessMap | null {
  const { data } = useProfileQuery();
  if (data === undefined || data.authenticated === false) return null;
  const parsed = featureAccessMapSchema.safeParse(data.featureAccess);
  return parsed.success ? parsed.data : null;
}
