/**
 * §31.3 — a guardian's premium derives from ANY ONE active premium student.
 *
 * @spec [Doc 01 V8 §31.3; SP25-001 single evaluator] | @implemented [2026-08-27]
 *
 * plain English: proves a guardian with two linked students gets premium when
 * EITHER is premium — including when it is the second one, which is the case
 * that was broken. Expected outcome: the fold looks past the first link.
 * Trade-off: the link reader and the entitlement evaluator are stubbed, because
 * this pins the FOLD, not their internals — both have their own coverage.
 * Edge cases: no links at all, and links present but no entitled student, which
 * must stay distinguishable.
 *
 * The defect this guards: `getPrimaryGuardianLink` returns the OLDEST active
 * link, so a guardian whose SECOND student is the premium one derived `free`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const GUARDIAN = "11111111-1111-4111-8111-111111111111";
const STUDENT_A = "22222222-2222-4222-8222-222222222222";
const STUDENT_B = "33333333-3333-4333-8333-333333333333";

const dbMocks = vi.hoisted(() => ({
  allLinks: vi.fn(),
  entitlementFor: vi.fn(),
  isActive: vi.fn(),
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ order: () => dbMocks.allLinks(table) }),
          maybeSingle: () => dbMocks.entitlementFor(table),
        }),
      }),
    }),
  },
}));

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: dbMocks.isActive,
  },
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * A link row in the shape `guardianLinkSchema` actually validates — every
 * field, because the reader parses rather than casts and a partial fixture
 * fails the parse rather than the assertion.
 */
function link(studentProfileId: string, createdAt: string) {
  return {
    id: `44444444-4444-4444-8444-${studentProfileId.slice(-12)}`,
    guardian_profile_id: GUARDIAN,
    student_profile_id: studentProfileId,
    status: "active",
    initiated_by: "guardian",
    initiated_at: createdAt,
    accepted_at: createdAt,
    accepted_by_profile_id: studentProfileId,
    revoked_at: null,
    revoked_by_profile_id: null,
    revocation_reason: null,
    created_at: createdAt,
  };
}

async function resolver() {
  return (await import("../../server/lib/account"))
    .resolveLinkedPairPremiumAccessForGuardian;
}

describe("guardian premium folds over ALL active links (§31.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.entitlementFor.mockResolvedValue({ data: null, error: null });
  });

  it("derives premium when only the SECOND student is entitled — the broken case", async () => {
    dbMocks.allLinks.mockResolvedValue({
      data: [
        link(STUDENT_A, "2026-01-01T00:00:00Z"), // oldest — NOT premium
        link(STUDENT_B, "2026-02-01T00:00:00Z"), // premium
      ],
      error: null,
    });
    // Only student B is entitled.
    dbMocks.isActive.mockImplementation(async (id: string) => id === STUDENT_B);

    const resolve = await resolver();
    const access = await resolve(GUARDIAN);

    // Both halves: premium AND the link that conferred it.
    expect(access.hasPremiumAccess).toBe(true);
    expect(access.hasActiveLink).toBe(true);
    expect(access.studentUserId).toBe(STUDENT_B);
  });

  it("derives premium when the FIRST student is entitled, without asking about the rest", async () => {
    dbMocks.allLinks.mockResolvedValue({
      data: [
        link(STUDENT_A, "2026-01-01T00:00:00Z"),
        link(STUDENT_B, "2026-02-01T00:00:00Z"),
      ],
      error: null,
    });
    dbMocks.isActive.mockImplementation(async (id: string) => id === STUDENT_A);

    const resolve = await resolver();
    const access = await resolve(GUARDIAN);

    expect(access.hasPremiumAccess).toBe(true);
    expect(access.studentUserId).toBe(STUDENT_A);
    // Short-circuits: student B is never evaluated.
    expect(dbMocks.isActive).toHaveBeenCalledTimes(1);
  });

  it("keeps 'linked but not premium' distinguishable from 'not linked'", async () => {
    dbMocks.allLinks.mockResolvedValue({
      data: [link(STUDENT_A, "2026-01-01T00:00:00Z")],
      error: null,
    });
    dbMocks.isActive.mockResolvedValue(false);

    const resolve = await resolver();
    const access = await resolve(GUARDIAN);

    // The distinction that must not collapse: no premium, but the link is real.
    expect(access.hasPremiumAccess).toBe(false);
    expect(access.hasActiveLink).toBe(true);
  });

  it("reports no link when the guardian has none", async () => {
    dbMocks.allLinks.mockResolvedValue({ data: [], error: null });

    const resolve = await resolver();
    const access = await resolve(GUARDIAN);

    expect(access.hasPremiumAccess).toBe(false);
    expect(access.hasActiveLink).toBe(false);
    expect(dbMocks.isActive).not.toHaveBeenCalled();
  });
});
