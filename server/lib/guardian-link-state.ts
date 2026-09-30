import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * @spec [Guardian_Closure_Plan G2-05 / G2-04; owner ruling R6 (2026-09-27): an under-13 student
 *       may use the platform only while a guardian link is active; the redeemed link replaces the
 *       email-consent flow] | @implemented [2026-09-29]
 *
 * plain English: does this student have at least one ACTIVE guardian link right now? This is the
 * one read that answers "is a guardian connected" — there is no stored flag to drift from it.
 * Reads through the caller's service-role client, so the question is asked of the database the
 * request is using.
 *
 * Fails closed: a read error THROWS rather than answering "no" or "yes". The callers are an
 * access gate and a session loader; guessing either way is worse than a 500.
 */
export async function hasActiveGuardianLink(
  client: SupabaseClient,
  studentProfileId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("guardian_links")
    .select("id")
    .eq("student_profile_id", studentProfileId)
    .eq("status", "active")
    .limit(1);
  if (error) {
    throw new Error(`Failed to read guardian link state: ${error.message}`);
  }
  return (data ?? []).length > 0;
}
