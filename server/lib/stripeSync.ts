import { StripeSync } from "stripe-replit-sync";
import { getStripeSecretKey } from "./stripeClient";

let stripeSync: StripeSync | null = null;

export async function getStripeSync(): Promise<StripeSync> {
  if (stripeSync) return stripeSync;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const stripeSecretKey = await getStripeSecretKey();

  stripeSync = new StripeSync({
    stripeSecretKey,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    poolConfig: {
      connectionString: databaseUrl,
    },
    logger: console,
  });

  return stripeSync;
}
