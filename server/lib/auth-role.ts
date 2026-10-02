import {
  runtimeRoleSchema,
  type RuntimeRole,
} from "../../packages/shared/src/runtime-role-schema";

export type { RuntimeRole };

/**
 * @spec [Guardian_Closure_Plan G2-02; audit G-AUD-23] | @implemented [2026-09-29]
 *
 * plain English: parses a stored or claimed role into one the application understands, or
 * `null`. It used to return "student" for anything it did not recognise, and the session loader
 * wrote that "student" back to the profile — so a 'tutor' or 'teacher' row became a student,
 * with student access, at its next sign-in. `null` now means "refuse": every caller fails closed.
 *
 * There is no legacy alias: the old 'parent' → 'guardian' mapping is gone (guardian closeout),
 * because every caller passes a `profiles.role` value or a role this function already parsed,
 * and the `profile_role` enum cannot hold 'parent'.
 */
export function parseRuntimeRole(rawRole: unknown): RuntimeRole | null {
  const parsed = runtimeRoleSchema.safeParse(rawRole);
  return parsed.success ? parsed.data : null;
}

export function isAdminRoleRequest(rawRole: unknown): boolean {
  return rawRole === "admin";
}
