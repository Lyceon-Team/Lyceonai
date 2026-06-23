import { describe, it, expect, vi } from "vitest";

// Pure-function test: stub the supabase-admin import side of the module.
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { mapMasteryStatusFromLevel } from "../../apps/api/src/services/mastery-read";

describe("MA-06 — mastery status derives from canonical level only", () => {
  it("maps canonical mastery_level 0-4 to status groups", () => {
    expect(mapMasteryStatusFromLevel(0, 5)).toBe("weak");
    expect(mapMasteryStatusFromLevel(1, 5)).toBe("weak");
    expect(mapMasteryStatusFromLevel(2, 5)).toBe("improving");
    expect(mapMasteryStatusFromLevel(3, 5)).toBe("proficient");
    expect(mapMasteryStatusFromLevel(4, 5)).toBe("proficient");
  });

  it("returns not_started when there are no attempts", () => {
    expect(mapMasteryStatusFromLevel(4, 0)).toBe("not_started");
    expect(mapMasteryStatusFromLevel(2, 0.001)).toBe("not_started");
  });

  it("returns not_started when the canonical level is absent — no 40/70 score fallback", () => {
    // Pre-MA-06 these returned weak/improving/proficient via a mastery_score bucket; now
    // the divergent fallback is gone and an absent canonical level is an honest not_started.
    expect(mapMasteryStatusFromLevel(null, 10)).toBe("not_started");
    expect(mapMasteryStatusFromLevel(undefined, 10)).toBe("not_started");
    expect(mapMasteryStatusFromLevel("unexpected", 10)).toBe("not_started");
  });
});
