/**
 * @spec [Doc-01_V8 §9 (login and signup flows: the server-side profile soft-gate);
 *        contracts/auth-standard-flow.contract.md AS-3 (onboarding gate); hotfix 2026-10-11
 *        (owner brief: "one definition of profile complete … admins are not subject to the
 *        student profile-completion gate")] | @implemented [2026-10-11]
 *
 * plain English: THE one answer to "has this account passed the profile-completion gate?",
 * read by the server gate (`requireProfileComplete`), by `GET /api/profile`'s
 * `requiredProfileComplete`, and by the client's route gate (`RequireRole`), the completion page
 * and the login landing. An admin always passes: the gate exists to make a STUDENT (or
 * guardian) state their age and role before learning, and an admin is neither. Everyone else
 * passes exactly when `profile_completed_at` is set.
 *
 * Why one function: on 2026-10-11 the server refused an admin with `profile_completed_at` NULL
 * (403 PROFILE_INCOMPLETE) while the client exempted admins from onboarding and the completion
 * page sent every admin back to /dashboard — the two sides disagreed, and the client reloaded
 * between them every ~1.5s. With one rule they cannot disagree.
 *
 * edge cases: a date of birth without `profile_completed_at` is NOT complete — the timestamp is
 * the record that the student finished the form (role, terms, SAT dates), not just the age.
 * `profileCompletedAt` may arrive as an ISO string (wire) or a Date (row).
 */
export type ProfileCompletionFacts = {
  isAdmin: boolean;
  profileCompletedAt: string | Date | null | undefined;
};

export function isProfileGateSatisfied(facts: ProfileCompletionFacts): boolean {
  if (facts.isAdmin) return true;
  return (
    facts.profileCompletedAt !== null &&
    facts.profileCompletedAt !== undefined &&
    facts.profileCompletedAt !== ""
  );
}
