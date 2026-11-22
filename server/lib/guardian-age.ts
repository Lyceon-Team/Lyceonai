/**
 * @spec [Guardian_Closure_Plan G1-02 (owner ruling R10: a guardian is an adult with a date of
 *        birth on file); SCL-187 item 3; owner ruling 2026-11-21 (counsel-approved) on the invite
 *        claim re-checking the inviting guardian] | @implemented [2026-11-22]
 *
 * plain English: is this guardian an adult with a date of birth on file, read from their
 * profile now? One reader for every place that asks before a link is made: link-code
 * redemption (the guardian is the caller), starting an invite (the guardian is the caller), and
 * claiming one (the TEEN is the caller, so the inviting guardian is checked by id). The rule
 * itself is `guardianAgeRefusal`; this only reads the date and names the missing-date refusal.
 *
 * Expected outcome: `{ ok: true }` for an adult; `{ ok: false, refusal }` for no date of birth
 * or under 18; a thrown error only when the profile cannot be read (the caller answers 500).
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  guardianAgeRefusal,
  toIsoDate,
  type RoleChoiceRefusal,
} from "./role-choice";

export type GuardianAgeCheck =
  | { ok: true }
  | { ok: false; refusal: RoleChoiceRefusal };

const GUARDIAN_DATE_OF_BIRTH_REQUIRED: RoleChoiceRefusal = {
  status: 403,
  code: "GUARDIAN_DATE_OF_BIRTH_REQUIRED",
  message: "Add your date of birth to your account before linking a student.",
};

export async function checkGuardianIsAdult(
  guardianProfileId: string,
  today: Date = new Date(),
): Promise<GuardianAgeCheck> {
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("date_of_birth")
    .eq("id", guardianProfileId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `guardian profile read failed (${error.code ?? "unknown"})`,
    );
  }
  const dateOfBirth = toIsoDate(data?.date_of_birth);
  const refusal =
    dateOfBirth !== null
      ? guardianAgeRefusal(dateOfBirth, today)
      : GUARDIAN_DATE_OF_BIRTH_REQUIRED;
  return refusal ? { ok: false, refusal } : { ok: true };
}
