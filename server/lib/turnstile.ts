/**
 * Cloudflare Turnstile verification for public submit endpoints.
 *
 * @spec [SCL-202 item 2 ("A public endpoint that accepts a submission verifies a Cloudflare
 *       Turnstile token server-side before any other work; a missing or invalid token is
 *       rejected"); plan R19, Q2; owner Step 0 decision 8 (2026-10-05): Cloudflare's published
 *       test keys until Karl creates the real ones] | @implemented [2026-10-05]
 *
 * plain English: posts the token to Cloudflare's siteverify endpoint with the server secret and
 * returns pass / reject / unavailable. The caller answers a reject with 403 and an unavailable
 * with 503: an unreachable verifier is never treated as a pass. The caller's IP is NOT sent
 * (siteverify's `remoteip` is optional), so no raw IP leaves the server.
 *
 * Secret: TURNSTILE_SECRET_KEY. Until it is set, Cloudflare's published "always passes" test
 * secret is used and a warning is logged once, so the flow works end to end with the matching
 * test site key; a production key rejects test tokens, so swapping keys needs no code change.
 */
import { z } from "zod";
import { logger } from "../logger";

export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's published test secret that always passes (developers.cloudflare.com, Turnstile testing). */
export const TURNSTILE_TEST_SECRET_ALWAYS_PASSES =
  "1x0000000000000000000000000000000AA";

const siteverifyResponseSchema = z
  .object({
    success: z.boolean(),
    "error-codes": z.array(z.string()).optional(),
  })
  .passthrough();

export type TurnstileResult =
  | { outcome: "pass" }
  | { outcome: "reject"; codes: string[] }
  | { outcome: "unavailable"; reason: string };

let warnedTestKey = false;

function turnstileSecret(): string {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret && secret.length > 0) return secret;
  if (!warnedTestKey) {
    warnedTestKey = true;
    logger.warn(
      "TURNSTILE",
      "test_secret_in_use",
      "TURNSTILE_SECRET_KEY is not set; using Cloudflare's published always-pass test secret",
      {},
    );
  }
  return TURNSTILE_TEST_SECRET_ALWAYS_PASSES;
}

export async function verifyTurnstile(
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!token) return { outcome: "reject", codes: ["missing-input-response"] };
  const body = new URLSearchParams({
    secret: turnstileSecret(),
    response: token,
  });
  let res: Response;
  try {
    res = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch (err: unknown) {
    return {
      outcome: "unavailable",
      reason: err instanceof Error ? err.name : "fetch_failed",
    };
  }
  if (!res.ok) return { outcome: "unavailable", reason: `http_${res.status}` };
  const parsed = siteverifyResponseSchema.safeParse(
    await res.json().catch(() => null),
  );
  if (!parsed.success)
    return { outcome: "unavailable", reason: "unparseable_response" };
  if (parsed.data.success) return { outcome: "pass" };
  return { outcome: "reject", codes: parsed.data["error-codes"] ?? [] };
}
