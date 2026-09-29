// E7b harness stub (see ../hooks.mjs): the one student holds exam_full_length, and
// (E9b) calendar_access, so the real calendar router serves the same student.
export const EntitlementService = {
  canAccessFeature: async (_profileId: string, featureKey: string): Promise<boolean> =>
    featureKey === "exam_full_length" || featureKey === "calendar_access",
};
