// E7b harness stub (see ../hooks.mjs): the one student holds exam_full_length.
export const EntitlementService = {
  canAccessFeature: async (_profileId: string, featureKey: string): Promise<boolean> =>
    featureKey === "exam_full_length",
};
