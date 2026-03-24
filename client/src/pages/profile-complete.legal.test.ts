import { describe, expect, it, vi } from "vitest";
import { deriveLegalAcceptanceDefaults, persistRequiredLegalAcceptances } from "./profile-complete";

describe("persistRequiredLegalAcceptances", () => {
  it("records student and parent legal acceptances for minors", async () => {
    const recordAcceptanceFn = vi.fn().mockResolvedValue({ success: true });

    await persistRequiredLegalAcceptances({
      isMinor: true,
      parentGuardianAccepted: true,
      recordAcceptanceFn,
    });

    expect(recordAcceptanceFn).toHaveBeenCalledTimes(5);
    expect(recordAcceptanceFn).toHaveBeenCalledWith({
      docKey: "parent_guardian_terms",
      docVersion: "2024-12-22",
      actorType: "parent",
      minor: true,
    });
  });

  it("throws when persistence fails so profile completion cannot continue", async () => {
    const recordAcceptanceFn = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: "write failed" });

    await expect(
      persistRequiredLegalAcceptances({
        isMinor: false,
        parentGuardianAccepted: false,
        recordAcceptanceFn,
      }),
    ).rejects.toThrow("write failed");
  });
});

describe("deriveLegalAcceptanceDefaults", () => {
  it("maps current-version acceptances to checkbox defaults", () => {
    const defaults = deriveLegalAcceptanceDefaults({
      isMinor: true,
      acceptances: [
        { doc_key: "student_terms", doc_version: "2024-12-20" },
        { doc_key: "privacy_policy", doc_version: "2024-12-22" },
        { doc_key: "honor_code", doc_version: "2024-12-22" },
        { doc_key: "community_guidelines", doc_version: "2024-12-22" },
        { doc_key: "parent_guardian_terms", doc_version: "2024-12-22" },
      ],
    });

    expect(defaults).toEqual({
      studentTermsAccepted: true,
      privacyPolicyAccepted: true,
      honorCodeAccepted: true,
      communityGuidelinesAccepted: true,
      parentGuardianAccepted: true,
    });
  });

  it("requires exact doc version for acceptance defaults", () => {
    const defaults = deriveLegalAcceptanceDefaults({
      isMinor: true,
      acceptances: [{ doc_key: "student_terms", doc_version: "2023-01-01" }],
    });

    expect(defaults.studentTermsAccepted).toBe(false);
    expect(defaults.parentGuardianAccepted).toBe(false);
  });
});
