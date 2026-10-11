/**
 * @spec [Doc-01_V8 §9 (login and signup flows: the server-side profile soft-gate);
 *        contracts/auth-standard-flow.contract.md AS-3 (onboarding gate); hotfix 2026-10-11
 *        (owner brief: "one definition of profile complete … admins are not subject to the
 *        student profile-completion gate")] | @implemented [2026-10-11]
 *
 * plain English: THE one answer to "has this account passed the profile-completion gate?",
 * read by the server gate (`requireProfileComplete`), by `GET /api/profile`'s
 * `requiredProfileComplete`, and by the client's route gate (`RequireRole`), the completion page
 * and the login landing. THE RULE:
 *   1. an admin always passes — the gate exists to make a student (or guardian) state their age
 *      and role before learning, and an admin is neither;
 *   2. otherwise `profile_completed_at` must be set;
 *   3. and a STUDENT must also have a known date of birth — the server's other learning gate
 *      (`requireGuardianLinkForUnder13`, G2-06) refuses a student whose age is unknown with the
 *      same PROFILE_INCOMPLETE, and the completion form requires a student's date of birth, so
 *      "complete" without it would be a second disagreement.
 *
 * Why one function: on 2026-10-11 the server refused an admin with `profile_completed_at` NULL
 * (403 PROFILE_INCOMPLETE) while the client exempted admins from onboarding and the completion
 * page sent every admin back to /dashboard — the two sides disagreed, and the client reloaded
 * between them every ~1.5s. With one rule they cannot disagree.
 *
 * edge cases: a date of birth without `profile_completed_at` is NOT complete — the timestamp is
 * the record that the student finished the form (role, terms, SAT dates), not just the age.
 * `profileCompletedAt` may arrive as an ISO string (wire) or a Date (row). `dateOfBirthKnown`
 * undefined means the caller does not hold the fact (a client payload without it); the server
 * always passes it, and its answer reaches the client as `requiredProfileComplete`.
 */
export type ProfileCompletionFacts = {
  isAdmin: boolean;
  role?: string | null | undefined;
  profileCompletedAt: string | Date | null | undefined;
  dateOfBirthKnown?: boolean | undefined;
};

export function isProfileGateSatisfied(facts: ProfileCompletionFacts): boolean {
  if (facts.isAdmin) return true;
  if (
    facts.profileCompletedAt === null ||
    facts.profileCompletedAt === undefined ||
    facts.profileCompletedAt === ""
  ) {
    return false;
  }
  if (facts.role === "student" && facts.dateOfBirthKnown === false)
    return false;
  return true;
}
