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

async function getReplitStripeConnection(): Promise<{ secretKey: string; publishableKey: string } | null> {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? 'repl ' + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? 'depl ' + process.env.WEB_REPL_RENEWAL
        : null;

    if (!xReplitToken || !hostname) {
      return null;
    }

    const connectorName = 'stripe';
    const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
    const targetEnvironment = isProduction ? 'production' : 'development';

    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set('include_secrets', 'true');
    url.searchParams.set('connector_names', connectorName);
    url.searchParams.set('environment', targetEnvironment);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    });

    const data = await response.json();
    const connectionSettings = data.items?.[0];

    if (!connectionSettings?.settings?.publishable || !connectionSettings?.settings?.secret) {
      return null;
    }

    return {
      publishableKey: connectionSettings.settings.publishable,
      secretKey: connectionSettings.settings.secret,
    };
  } catch (err) {
    logger.warn("STRIPE", "connection", "Replit connection fallback failed", { error: (err as Error).message });
    return null;
  }
}

async function getStripeSecretKey(): Promise<string> {
  const envKey = getEnvStripeSecretKey();
  if (envKey) return envKey;

  const replitConn = await getReplitStripeConnection();
  if (replitConn) return replitConn.secretKey;

  throw new Error(
    `Stripe secret key is not configured. Set STRIPE_SECRET_KEY (recommended) or configure a Replit Stripe connection.`
  );
}

async function getStripePublishableKey(): Promise<string> {
  const envKey = getEnvStripePublishableKey();
  if (envKey) return envKey;

  const replitConn = await getReplitStripeConnection();
  if (replitConn) return replitConn.publishableKey;

  throw new Error(
    `Stripe publishable key is not configured. Set STRIPE_PUBLISHABLE_KEY (recommended) or configure a Replit Stripe connection.`
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

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
