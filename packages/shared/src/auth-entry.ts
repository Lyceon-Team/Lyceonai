import { z } from "zod";
import { RETURN_PATH_PARAM, sanitizeReturnPath } from "./return-path";

/**
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rules 1-3;
 *        contracts/auth-standard-flow.contract.md AS-5 (the return path stays the one allowlisted
 *        `next`); Coding Standards §7.2 (one definition in packages/shared)] | @implemented [2026-10-10]
 *
 * plain English: THE one place that reads and writes the two auth-page entry parameters, so the
 * links that build them (the public site, the `/signup` redirect) and the page that reads them
 * cannot disagree.
 *   - `mode`: which tab the auth page opens on. An allowlist of two; anything else, or nothing,
 *     is Sign In (rule 1's fallback).
 *   - `role`: the account type a sign-up asked for. An allowlist of two; anything else is
 *     no intent at all, which is a student, as every sign-up was before.
 * The role rides the Google round trip exactly as `next` does (a callback query parameter the
 * server re-parses with this module) and the email sign-up as a body field, so both entry paths
 * create a guardian-intent account as a guardian (rule 2).
 *
 * Trade-off: the role is a CLIENT-supplied intent, and that is deliberate: student and guardian
 * are both self-assignable (server/lib/role-choice.ts), so naming one at sign-up grants nothing the
 * onboarding form does not already offer. Admin is never in the allowlist, and the sign-up route
 * still refuses an admin request before parsing. Edge cases: case and whitespace are not
 * forgiven (`Guardian`, ` signup` fall back), and the parameters never carry a destination — the
 * destination is `next`, sanitised by return-path.ts as before.
 */

export const AUTH_MODE_PARAM = "mode";
export const AUTH_ROLE_PARAM = "role";

export const authEntryModeSchema = z.enum(["signin", "signup"]);
export type AuthEntryMode = z.infer<typeof authEntryModeSchema>;

export const signupRoleIntentSchema = z.enum(["student", "guardian"]);
export type SignupRoleIntent = z.infer<typeof signupRoleIntentSchema>;

/** The tab the auth page opens on. Unknown, malformed or missing → Sign In. Total. */
export function parseAuthEntryMode(raw: unknown): AuthEntryMode {
  const parsed = authEntryModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : "signin";
}

/** The account type a sign-up asked for, or `null` (no intent: a student). Total. */
export function parseSignupRoleIntent(raw: unknown): SignupRoleIntent | null {
  const parsed = signupRoleIntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type AuthEntry = {
  mode: AuthEntryMode;
  role: SignupRoleIntent | null;
};

/** Both entry parameters from a query string (`?mode=signup&role=guardian`). Total. */
export function authEntryFromSearch(search: string): AuthEntry {
  const params = new URLSearchParams(search);
  return {
    mode: parseAuthEntryMode(params.get(AUTH_MODE_PARAM)),
    role: parseSignupRoleIntent(params.get(AUTH_ROLE_PARAM)),
  };
}

/**
 * The auth-page URL for an entry point, e.g.
 * `/login?mode=signup&role=guardian&next=%2Fguardian`. `next` goes through the ONE return-path
 * sanitiser; a value it refuses is dropped (the role default applies), never passed through.
 */
export function authEntryPath(input: {
  mode: AuthEntryMode;
  role?: SignupRoleIntent;
  next?: string;
}): string {
  const params = new URLSearchParams({ [AUTH_MODE_PARAM]: input.mode });
  if (input.role !== undefined) params.set(AUTH_ROLE_PARAM, input.role);
  const next = input.next === undefined ? null : sanitizeReturnPath(input.next);
  if (next !== null) params.set(RETURN_PATH_PARAM, next);
  return `/login?${params.toString()}`;
}

/**
 * @spec [owner brief 2026-10-10 rule 3] | plain English: the page that starts (or resumes) the
 * student's diagnostic and hands over to the practice runner. "Start the free diagnostic" returns
 * here after sign-in or sign-up, and through onboarding, on the existing `next` channel: it sits
 * under the allowlisted `/practice` prefix, so a guardian is never landed on it.
 */
export const DIAGNOSTIC_START_PATH = "/practice/diagnostic";
