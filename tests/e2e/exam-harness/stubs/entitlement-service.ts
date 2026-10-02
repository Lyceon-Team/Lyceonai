// E7b harness stub (see ../hooks.mjs): the one student holds exam_full_length, and
// (E9b) calendar_access, so the real calendar router serves the same student.
import { harnessSupabase } from "../pg";

export const EntitlementService = {
  canAccessFeature: async (_profileId: string, featureKey: string): Promise<boolean> =>
    featureKey === "exam_full_length" || featureKey === "calendar_access",
  // Guardian final purge, item 9: the real /api/guardian roster asks this for each linked
  // student. Not a fixed answer: the same `entitlement_active` RPC the real service calls, over
  // the harness's real entitlements row (db.ts seeds premium/active), failing closed on an error
  // exactly as the real one does.
  isEntitlementActiveForProfile: async (profileId: string): Promise<boolean> => {
    const { data, error } = await harnessSupabase().rpc("entitlement_active", {
      p_profile_id: profileId,
    });
    return !error && data === true;
  },
};
