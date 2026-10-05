/**
 * Records the visitor's first-touch channel on a new account.
 *
 * @spec [SCL-201 IS 6 ("`user_signed_up.signup_source` is set server-side from the visitor's
 *       first-touch UTM, captured before signup and carried to the post-signup handler"); Doc 07A
 *       §6.2 (the enum); plan R11, F10] | @implemented [2026-10-05]
 *
 * plain English: the browser derives the channel in memory (nothing stored on the device) and
 * sends it with the email signup or carries it through the Google callback. This writes it to
 * `profiles.signup_source` — once, and only on an account that has not completed onboarding, so a
 * returning user signing in through the same path cannot rewrite where they came from. The
 * database enforces set-once as well (trigger profiles_analytics_fields_set_once).
 *
 * edge cases: an unparseable value is ignored (the event then reports `unknown`); a write failure
 * is logged and the signup carries on — attribution is never worth an account.
 */
import { getSupabaseAdmin } from "../../middleware/supabase-auth";
import { signupSourceSchema } from "../../../packages/shared/src/analytics-consent-schema";
import { logger } from "../../logger";

export async function recordSignupSource(
  profileId: string,
  raw: unknown,
  requestId: string | undefined,
): Promise<void> {
  const parsed = signupSourceSchema.safeParse(raw);
  if (!parsed.success) return;
  const { error } = await getSupabaseAdmin()
    .from("profiles")
    .update({ signup_source: parsed.data })
    .eq("id", profileId)
    .is("signup_source", null)
    .is("profile_completed_at", null);
  if (error) {
    logger.warn(
      "ANALYTICS",
      "signup_source_write_failed",
      "signup_source not recorded",
      {
        code: error.code ?? "unknown",
        requestId,
      },
    );
  }
}
