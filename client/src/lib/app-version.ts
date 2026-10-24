/**
 * The app version: the deploy's short commit, set at build by vite.config.ts from Vercel's
 * VERCEL_GIT_COMMIT_SHA, or `dev` for a local build.
 *
 * @spec [final brief "Trustpilot card + Feedback" (Karl, 2026-10-20) §3: "the app version from
 *       the deploy commit"] | @implemented [2026-10-20]
 *
 * plain English: feedback carries it so a report can be matched to a deploy. Anything that does
 * not look like a version is sent as null, never guessed.
 */
import { appVersionSchema } from "../../../packages/shared/src/product-feedback-schema";

export function appVersion(
  raw: unknown = import.meta.env.VITE_APP_VERSION,
): string | null {
  const parsed = appVersionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
