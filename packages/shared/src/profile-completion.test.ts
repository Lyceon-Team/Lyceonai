/**
 * @spec [hotfix 2026-10-11: one definition of "profile complete"] | @implemented [2026-10-11]
 * plain English: the shared rule, case by case — the three production shapes from the loop
 * report, plus the completed student and the empty string the wire can carry.
 */
import { describe, expect, it } from "vitest";
import { isProfileGateSatisfied } from "./profile-completion";

describe("isProfileGateSatisfied", () => {
  it("an admin passes even with profile_completed_at NULL (the looping account)", () => {
    expect(
      isProfileGateSatisfied({ isAdmin: true, profileCompletedAt: null }),
    ).toBe(true);
  });
  it("a student with profile_completed_at set passes", () => {
    expect(
      isProfileGateSatisfied({
        isAdmin: false,
        profileCompletedAt: "2026-10-01T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      isProfileGateSatisfied({
        isAdmin: false,
        profileCompletedAt: new Date("2026-10-01"),
      }),
    ).toBe(true);
  });
  it("a completed student whose date of birth is unknown does not pass (the age gate would refuse them)", () => {
    expect(
      isProfileGateSatisfied({
        isAdmin: false,
        role: "student",
        profileCompletedAt: "2026-10-01T00:00:00Z",
        dateOfBirthKnown: false,
      }),
    ).toBe(false);
    // a guardian is not asked for one
    expect(
      isProfileGateSatisfied({
        isAdmin: false,
        role: "guardian",
        profileCompletedAt: "2026-10-01T00:00:00Z",
        dateOfBirthKnown: false,
      }),
    ).toBe(true);
  });
  it("a student without profile_completed_at does not pass, date of birth or not", () => {
    expect(
      isProfileGateSatisfied({ isAdmin: false, profileCompletedAt: null }),
    ).toBe(false);
    expect(
      isProfileGateSatisfied({ isAdmin: false, profileCompletedAt: undefined }),
    ).toBe(false);
    expect(
      isProfileGateSatisfied({ isAdmin: false, profileCompletedAt: "" }),
    ).toBe(false);
  });
});
