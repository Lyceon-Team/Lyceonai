/**
 * Find the Stripe promotion code a `/upgrade?promo=<CODE>` link names, if it can still be used.
 *
 * @spec [owner brief (Karl) 2026-10-10: "/upgrade?promo=<CODE> … the server looks up the active
 *       Stripe promotion code by name and passes it as discounts: [{ promotion_code }] … an
 *       unknown, expired or used-up code falls back silently to normal checkout with the code
 *       field"; Coding Standards §7.1 (parse third-party payloads)] | @implemented [2026-10-10]
 *
 * plain English: one `promotionCodes.list({ code, active: true, limit: 1 })`, parsed with Zod,
 * then `usablePromotionCode` decides: active, not past `expires_at`, and not at
 * `max_redemptions`. A usable code returns its id (`promo_…`); anything else, including a
 * Stripe error, returns `null`, and the caller shows the normal checkout with the code field.
 *
 * Trade-offs: Stripe re-checks everything when the session is created (and when it is paid), so
 * this lookup is a convenience, never an authority; a code that passes here but that Stripe then
 * refuses (for example a coupon restricted to first-time customers) is handled by the caller's
 * one retry without it. A failed lookup is logged at WARN and never fails the checkout. Nothing
 * personal is logged; the code name is a public marketing string, but it is not logged either.
 */
import type Stripe from "stripe";
import { z } from "zod";
import { logger } from "../../logger";

const promotionCodeSchema = z.object({
  id: z.string().startsWith("promo_"),
  active: z.boolean(),
  expires_at: z.number().int().nullable(),
  max_redemptions: z.number().int().nullable(),
  times_redeemed: z.number().int(),
});
export type PromotionCodeFacts = z.infer<typeof promotionCodeSchema>;

const promotionCodeListSchema = z.object({
  data: z.array(z.unknown()),
});

/** Pure: may this promotion code be pre-applied right now? */
export function usablePromotionCode(
  code: PromotionCodeFacts,
  nowSeconds: number,
): boolean {
  if (!code.active) return false;
  if (code.expires_at !== null && code.expires_at <= nowSeconds) return false;
  if (
    code.max_redemptions !== null &&
    code.times_redeemed >= code.max_redemptions
  ) {
    return false;
  }
  return true;
}

export async function findUsablePromotionCodeId(
  stripe: Pick<Stripe, "promotionCodes">,
  codeName: string,
  context: { requestId: string | undefined; nowMs: number },
): Promise<string | null> {
  let listed: unknown;
  try {
    listed = await stripe.promotionCodes.list({
      code: codeName,
      active: true,
      limit: 1,
    });
  } catch (err: unknown) {
    logger.warn(
      "BILLING",
      "promotion_code_lookup",
      "Promotion code lookup failed; checkout continues with the code field",
      {
        requestId: context.requestId,
        error: err instanceof Error ? err.name : "unknown",
      },
    );
    return null;
  }

  const list = promotionCodeListSchema.safeParse(listed);
  const first = list.success ? list.data.data[0] : undefined;
  const parsed = promotionCodeSchema.safeParse(first);
  if (!parsed.success) {
    // Unknown code (empty list) or an unexpected shape: both fall back.
    logger.info(
      "BILLING",
      "promotion_code_lookup",
      "No usable promotion code for the link; checkout continues with the code field",
      { requestId: context.requestId, found: first !== undefined },
    );
    return null;
  }
  if (!usablePromotionCode(parsed.data, Math.floor(context.nowMs / 1000))) {
    logger.info(
      "BILLING",
      "promotion_code_lookup",
      "Linked promotion code is inactive, expired or used up; checkout continues with the code field",
      { requestId: context.requestId },
    );
    return null;
  }
  return parsed.data.id;
}
