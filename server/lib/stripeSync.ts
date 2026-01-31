import { StripeSync, runMigrations } from "stripe-replit-sync";
import { getStripeSecretKey } from "./stripeClient";

type PoolConfig = {
  connectionString: string;
};

let stripeSyncInstance: StripeSync | null = null;

function getPoolConfig(databaseUrl: string): PoolConfig {
  return {
    connectionString: databaseUrl,
  };
}

export async function getStripeSync(): Promise<StripeSync> {
  if (stripeSyncInstance) {
    return stripeSyncInstance;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Stripe sync");
  }

  const stripeSecretKey = await getStripeSecretKey();

  stripeSyncInstance = new StripeSync({
    stripeSecretKey,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    poolConfig: getPoolConfig(databaseUrl),
  });

  return stripeSyncInstance;
}

export { runMigrations };
