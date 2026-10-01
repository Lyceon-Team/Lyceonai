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
 * Edge case: 'parent' is the one legacy alias still mapped (to 'guardian'). The `profile_role`
 * enum cannot hold it, so it can only arrive from a non-database source; it is mapped in memory
 * and never written anywhere.
 */
export function parseRuntimeRole(rawRole: unknown): RuntimeRole | null {
  if (rawRole === "parent") {
    return "guardian";
  }
  const parsed = runtimeRoleSchema.safeParse(rawRole);
  return parsed.success ? parsed.data : null;
}

export function isAdminRoleRequest(rawRole: unknown): boolean {
  return rawRole === "admin";
}
