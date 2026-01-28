import Stripe from "stripe";
import { logger } from "../logger";

type StripeEnv = "live" | "test";

function normalizeStripeEnv(v: string | undefined): StripeEnv {
  const x = (v || "").toLowerCase();
  return x === "live" ? "live" : "test";
}

function getEnvStripeSecretKey(): string | null {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;

  const env = normalizeStripeEnv(process.env.STRIPE_ENV);
  if (env === "live" && process.env.STRIPE_SECRET_KEY_LIVE) return process.env.STRIPE_SECRET_KEY_LIVE;
  if (env === "test" && process.env.STRIPE_SECRET_KEY_TEST) return process.env.STRIPE_SECRET_KEY_TEST;

  return null;
}

function getEnvStripePublishableKey(): string | null {
  if (process.env.STRIPE_PUBLISHABLE_KEY) return process.env.STRIPE_PUBLISHABLE_KEY;

  const env = normalizeStripeEnv(process.env.STRIPE_ENV);
  if (env === "live" && process.env.STRIPE_PUBLISHABLE_KEY_LIVE) return process.env.STRIPE_PUBLISHABLE_KEY_LIVE;
  if (env === "test" && process.env.STRIPE_PUBLISHABLE_KEY_TEST) return process.env.STRIPE_PUBLISHABLE_KEY_TEST;

  return null;
}


async function getStripeSecretKey(): Promise<string> {
  const envKey = getEnvStripeSecretKey();
  if (envKey) return envKey;
  throw new Error(
    `Stripe secret key is not configured. Set STRIPE_SECRET_KEY.`
  );
}

async function getStripePublishableKey(): Promise<string> {
  const envKey = getEnvStripePublishableKey();
  if (envKey) return envKey;
  throw new Error(
    `Stripe publishable key is not configured. Set STRIPE_PUBLISHABLE_KEY.`
  );
}

export async function getUncachableStripeClient() {
  const secretKey = await getStripeSecretKey();

  logger.info("STRIPE", "init", "Initializing Stripe client", {
    stripeEnv: normalizeStripeEnv(process.env.STRIPE_ENV),
    secretKeyPrefix: secretKey.slice(0, 8),
  });

  return new Stripe(secretKey);
}

export async function getStripePublishableKeySafe() {
  const pk = await getStripePublishableKey();
  return pk;
}

export { getStripeSecretKey };

