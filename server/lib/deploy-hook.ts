/**
 * Triggers the production build through Vercel's deploy hook.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q1, R18 (the daily QOTD rebuild);
 *       docs/Spec/Lyceon_Doc_10B.md §8.4 ("a daily job triggers the production deploy hook only on
 *       days when an item's date arrives")] | @implemented [2026-10-05; shared 2026-10-11]
 *
 * plain English: one POST to `VERCEL_DEPLOY_HOOK_URL`, with a 10-second timeout. Used by the QOTD
 * schedule job and the content publish job, so both rebuild the site the same way. The hook URL is
 * a credential: on failure only the error class is logged, never the URL.
 */
import { logger } from "../logger";

export type DeployHookOutcome = "triggered" | "failed" | "skipped_no_hook";

export async function triggerDeployHook(
  deployHookUrl: string | undefined,
  component: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeployHookOutcome> {
  if (!deployHookUrl) return "skipped_no_hook";
  try {
    const res = await fetchImpl(deployHookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "triggered" : "failed";
  } catch (err: unknown) {
    // The hook URL is a credential: log only the error class, never the URL.
    logger.warn(component, "deploy_hook_failed", "Deploy hook request failed", {
      reason: err instanceof Error ? err.name : "unknown",
    });
    return "failed";
  }
}
