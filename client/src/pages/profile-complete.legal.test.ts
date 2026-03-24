import { describe, expect, it, vi } from "vitest";
import { persistRequiredLegalAcceptances } from "./profile-complete";

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

