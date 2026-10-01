/**
 * The one-time role choice at profile completion.
 *
 * @spec [Guardian_Closure_Plan G1-02; owner rulings R1, R10; Doc 01 V8 §17A (a role switch
 *        requires unlinking first), §16 (admin is never self-assigned)] | @implemented [2026-09-29]
 *
 * plain English: every account is created as a student (the `handle_new_user` trigger), so a
 * parent who picks "Guardian" on the profile-completion form is asking to CHANGE role. This
 * module decides whether that is allowed. Expected outcome: a brand-new account can pick
 * student or guardian exactly once; after completion the role is locked; admin is never
 * self-assigned; and an account that already holds a guardian link or any learning state
 * cannot switch, because that state was written under the other role.
 *
 * Trade-off: the facts are read with the service role in the request, not enforced by a
 * constraint, because no plan row names a schema change for this. A race between the read
 * and the write (a practice answer landing mid-request on a not-yet-completed profile) is
 * not reachable: practice, review, exams, calendar and tutor all sit behind
 * `requireProfileComplete` or `requireStudentOrAdmin` flows that a profile still being
 * completed has no path through in the same instant.
 *
 * Edge cases: a fact read that errors THROWS (fail closed: the route answers 500 and no role
 * is written), rather than being read as "no state".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GUARDIAN_MIN_AGE,
  ageInYears,
  type RoleChoiceErrorCode,
} from "../../packages/shared/src/profile-role-choice-schema";

export type SelfAssignableRole = "student" | "guardian";

export type RoleChoiceFacts = {
  /** Any `guardian_links` row with `status='active'` naming this profile on either side. */
  hasActiveLink: boolean;
  /** Any row keyed to this profile in a learning-state root table. */
  hasLearningState: boolean;
};

export type RoleChoiceRefusal = {
  status: 400 | 403 | 409;
  code: RoleChoiceErrorCode;
  message: string;
};

export type RoleChoiceDecision =
  | { ok: true; role: SelfAssignableRole }
  | { ok: false; refusal: RoleChoiceRefusal };

/**
 * The learning-state ROOT tables and the column that names the owner. A child row
 * (answers, items, mastery events) cannot exist without one of these roots, so checking
 * the roots is sufficient.
 */
export const LEARNING_STATE_ROOTS: ReadonlyArray<{
  table: string;
  ownerColumn: string;
}> = [
  { table: "practice_sessions", ownerColumn: "user_id" },
  { table: "review_sessions", ownerColumn: "student_id" },
  { table: "test_sessions", ownerColumn: "student_id" },
  { table: "student_study_profile", ownerColumn: "student_id" },
  { table: "tutor_conversations", ownerColumn: "student_id" },
  { table: "student_skill_mastery", ownerColumn: "student_id" },
  { table: "student_domain_mastery", ownerColumn: "student_id" },
];

export const NOT_SELF_ASSIGNABLE: RoleChoiceRefusal = {
  status: 403,
  code: "ROLE_NOT_SELF_ASSIGNABLE",
  message: "You can sign up as a student or a guardian.",
};

export function isSelfAssignableRole(role: string): role is SelfAssignableRole {
  return role === "student" || role === "guardian";
}

export function supportMessage(supportEmail: string): string {
  return `Email ${supportEmail} if you need your role changed.`;
}

/**
 * Pure. Decides the role a PATCH may write. `requestedRole` is whatever string the client
 * sent (or null when it sent none); the schema is NOT trusted to have narrowed it yet.
 */
export function decideRoleChoice(input: {
  currentRole: string;
  requestedRole: string | null;
  profileCompletedAt: string | null;
  facts: RoleChoiceFacts;
  supportEmail: string;
}): RoleChoiceDecision {
  const { currentRole, requestedRole, profileCompletedAt, facts } = input;

  if (requestedRole !== null && !isSelfAssignableRole(requestedRole)) {
    return { ok: false, refusal: NOT_SELF_ASSIGNABLE };
  }

  const wanted: string = requestedRole ?? currentRole;
  if (wanted === currentRole) {
    if (isSelfAssignableRole(currentRole)) {
      return { ok: true, role: currentRole };
    }
    return { ok: false, refusal: NOT_SELF_ASSIGNABLE };
  }

  // A real change of role from here on.
  if (profileCompletedAt !== null) {
    return {
      ok: false,
      refusal: {
        status: 403,
        code: "ROLE_LOCKED",
        message: `Your account type is set when you finish signing up. ${supportMessage(input.supportEmail)}`,
      },
    };
  }

  if (facts.hasActiveLink || facts.hasLearningState) {
    return {
      ok: false,
      refusal: {
        status: 403,
        code: "ROLE_CHANGE_BLOCKED",
        message: `This account already has study activity or a linked account, so its type can't be changed here. ${supportMessage(input.supportEmail)}`,
      },
    };
  }

  return { ok: true, role: wanted === "guardian" ? "guardian" : "student" };
}

/** F-41: an age beyond this is a typing error, not a person. */
export const MAX_PLAUSIBLE_AGE_YEARS = 120;

/** F-41: the refusal for a date of birth that is not a real, plausible, past date. */
export const INVALID_DATE_OF_BIRTH: RoleChoiceRefusal = {
  status: 400,
  code: "DATE_OF_BIRTH_REQUIRED",
  message: "Please enter a valid date of birth.",
};

/**
 * Pure. F-41 (Brief 8 ruling 6, 2026-10-01): a date of birth is accepted only as a real date that
 * is not in the future and not more than 120 years ago. Returns the refusal, or null.
 *
 * @spec [Brief 8 ruling 6; Doc 01 V8 §9 / §37.1; SCL-187 rule 1 (APPLIED)] | @implemented
 * [2026-10-01] | plain English: this is the format-and-plausibility half of the onboarding age
 * check. The AGE half is not a refusal: an under-13 student is ACCEPTED, the `profiles_set_age`
 * trigger derives `is_under_13`, and `requireGuardianLinkForUnder13` closes every learning surface
 * until a guardian link is active while `requireStudentOnly` keeps LISA closed regardless. That
 * is SCL-187 as live, and the owner's instruction of 2026-10-01 ("check what is currently live in
 * the repo now and follow that") — refusing under-13 here would make that gate unreachable.
 */
export function dateOfBirthRefusal(
  dateOfBirth: string | null | undefined,
  today: Date,
): RoleChoiceRefusal | null {
  if (!dateOfBirth) {
    return {
      status: 400,
      code: "DATE_OF_BIRTH_REQUIRED",
      message: "Please enter your date of birth to continue.",
    };
  }
  const age = ageInYears(dateOfBirth, today);
  if (age === null || age < 0 || age > MAX_PLAUSIBLE_AGE_YEARS) {
    return INVALID_DATE_OF_BIRTH;
  }
  return null;
}

/**
 * Pure. R10: a guardian must give a real date of birth and be at least 18.
 * Returns the refusal, or null when the date is acceptable.
 */
export function guardianAgeRefusal(
  dateOfBirth: string | null | undefined,
  today: Date,
): RoleChoiceRefusal | null {
  const invalid = dateOfBirthRefusal(dateOfBirth, today);
  if (invalid) return invalid;
  const age = ageInYears(dateOfBirth ?? "", today);
  if (age === null || age < GUARDIAN_MIN_AGE) {
    return {
      status: 403,
      code: "GUARDIAN_UNDER_18",
      message: "Guardian accounts are for adults 18 or older.",
    };
  }
  return null;
}

/**
 * A `date` column as `YYYY-MM-DD`, or null. PostgREST sends the string; a node-postgres
 * transport sends a `Date` built at LOCAL midnight, so it is read back with local getters
 * (UTC getters would move it a day in any zone west of UTC).
 */
export function toIsoDate(value: unknown): string | null {
  if (typeof value === "string" && value.length >= 10)
    return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${m}-${d}`;
  }
  return null;
}

/** Reads the two facts. Throws on any read error (fail closed). */
export async function loadRoleChoiceFacts(
  supabase: SupabaseClient,
  profileId: string,
): Promise<RoleChoiceFacts> {
  const asGuardian = await supabase
    .from("guardian_links")
    .select("id")
    .eq("guardian_profile_id", profileId)
    .eq("status", "active")
    .limit(1);
  if (asGuardian.error) {
    throw new Error(
      `role_choice_link_read_failed: ${asGuardian.error.message}`,
    );
  }
  const asStudent = await supabase
    .from("guardian_links")
    .select("id")
    .eq("student_profile_id", profileId)
    .eq("status", "active")
    .limit(1);
  if (asStudent.error) {
    throw new Error(`role_choice_link_read_failed: ${asStudent.error.message}`);
  }
  const hasActiveLink =
    (asGuardian.data ?? []).length > 0 || (asStudent.data ?? []).length > 0;

  let hasLearningState = false;
  for (const root of LEARNING_STATE_ROOTS) {
    const { data, error } = await supabase
      .from(root.table)
      .select(root.ownerColumn)
      .eq(root.ownerColumn, profileId)
      .limit(1);
    if (error) {
      throw new Error(
        `role_choice_state_read_failed: ${root.table}: ${error.message}`,
      );
    }
    if ((data ?? []).length > 0) {
      hasLearningState = true;
      break;
    }
  }

  return { hasActiveLink, hasLearningState };
}
