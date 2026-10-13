/**
 * @spec [SCL-222 (owner ruling 2026-10-09: the sign-in notice replaces the Terms checkbox; acceptance
 *       is recorded at account creation, and a returning user's sign-in records nothing)] |
 *       @implemented [2026-10-09]
 *
 * plain English: tells the OAuth callback whether the Google sign-in it is finishing is the one that
 * CREATED the account. The profile row is made by the `handle_new_user` trigger in the same
 * transaction as the `auth.users` insert, which GoTrue performs during the very OAuth round trip
 * this callback completes, so a new account's `created_at` is seconds old when the callback runs.
 * A returning user's `created_at` is fixed at their first sign-up and never moves, unlike
 * `last_sign_in_at`, which every sign-in refreshes.
 *
 * expected outcome: true only for the first callback of a brand-new account; false for every later
 * sign-in, so a returning user is never recorded as accepting documents by signing in — updated
 * documents reach them through the re-acceptance prompt instead.
 *
 * trade-offs / edge cases: the window (10 minutes) covers the OAuth round trip with a wide margin.
 * A second Google sign-in inside the window re-records the same versions the account accepted at
 * creation (an idempotent upsert), which records nothing new. A missing or unparseable
 * `created_at` is treated as NOT new: the failure mode is a missing row (which the prompt then
 * collects), never a row recorded for a returning user.
 */
export const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

export function isNewlyCreatedAccount(
  createdAt: string | null | undefined,
  now: Date,
): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  const age = now.getTime() - created;
  // A created_at slightly in the future is clock skew between GoTrue and this server, still new.
  return age >= -60 * 1000 && age <= NEW_ACCOUNT_WINDOW_MS;
}
