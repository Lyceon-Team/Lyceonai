/**
 * @spec [owner brief "Parent paid seat + teen invite" (Karl, 2026-11-19) §2.3; SCL-045 (the
 *        student is named on the subscription item); the SCL entry amending Doc 01 V8 §20]
 *        | @implemented [2026-11-19]
 *
 * plain English: the claim's Stripe step, run after the database claim committed. Name the
 * student on the seat's item and on the subscription (the shape every guardian subscription
 * has, and what the next purchase's duplicate check reads), then write the entitlement through
 * the one guardian writer. Every step is idempotent: a failure part-way is finished by the
 * same student retrying the claim, which the database answers 'claimed' again. The
 * `customer.subscription.updated` event the metadata change triggers writes the same row.
 */
import { getStripeClient } from "./client";
import { writeGuardianSeatEntitlement } from "./webhook-handler";

export async function attachGuardianSeatStudent(input: {
  seatId: string;
  subscriptionId: string;
  itemId: string | null;
  studentProfileId: string;
}): Promise<void> {
  const stripe = getStripeClient();
  let itemId = input.itemId;
  if (!itemId) {
    const sub = await stripe.subscriptions.retrieve(input.subscriptionId);
    itemId = sub.items.data[0]?.id ?? null;
  }
  if (!itemId) {
    throw new Error("guardian seat attach: the subscription has no item");
  }
  const metadata = { student_profile_id: input.studentProfileId };
  await stripe.subscriptionItems.update(itemId, { metadata });
  await stripe.subscriptions.update(input.subscriptionId, { metadata });
  await writeGuardianSeatEntitlement(input.subscriptionId, input.seatId);
}
