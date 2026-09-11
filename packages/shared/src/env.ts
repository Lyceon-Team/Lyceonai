/**
 * @spec PROVISIONAL — observed contract; required-set pending reconciliation vs Doc 06A/06B.
 * @spec [Coding Standards, §7.3 Validate Environment Variables] | @implemented 2026-06-05
 * plain English: Canonical Zod schema for process environment, parsed at the
 * boundary (never trust raw `process.env` shapes downstream). Modeled on the
 * OBSERVED contract (`.env.example` + the ad-hoc `apps/api/src/env.ts`), not yet
 * on the authoritative infra spec.
 *
 * HARD GATE (ledger fast-follow): no consumer may migrate onto this schema until
 * the required-vs-optional set is reconciled against Doc 06A/06B (one targeted
 * read of the env/config sections). This schema must not silently canonize
 * drifted env practice. Until then it exists as the SSOT *shape*, validated by
 * its own tests, consumed by nobody.
 *
 * trade-offs: core Supabase/CSRF/NODE_ENV are required (the app cannot run
 * without them); provider keys are optional pending reconciliation.
 */
import { z } from "zod";

export const nodeEnvSchema = z.enum(["development", "production", "test"]);

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default("development"),

  // Core required — app cannot boot without these (observed, high-confidence).
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CSRF_SECRET: z.string().min(1),

  // Provisional / provider-specific — optional pending 06A/06B reconciliation.
  SUPABASE_DB_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url().optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),

  // Stripe — the six variables the billing surface actually reads.
  // Added 2026-08-20. Not drift: each is read by name at a cited call site, so
  // this documents the observed contract rather than canonizing a guess.
  //   STRIPE_SECRET_KEY        server/lib/stripe/client.ts:38
  //   STRIPE_PUBLISHABLE_KEY   server/lib/stripe/client.ts (getStripePublishableKey)
  //   STRIPE_WEBHOOK_SECRET    server/lib/stripe/webhook-handler.ts (constructEvent)
  //   STRIPE_PRICE_PARENT_*    server/lib/stripe/client.ts (PRICE_ENV_VAR record)
  // Optional for the same reason as the other provider keys: the schema is
  // consumed by nobody pending the 06A/06B reconciliation gate above, and a
  // non-billing environment must not be forced to carry billing credentials.
  //
  // `STRIPE_SECRET_KEY`'s prefix is the sole source of the Stripe mode
  // (SCL-049) — there is deliberately no `STRIPE_ENV` here, and no
  // `_LIVE`/`_TEST` variants. `ci/env-example-stripe-parity` enforces that
  // `server/.env.example` advertises exactly this set and nothing else.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_PARENT_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_PARENT_QUARTERLY: z.string().min(1).optional(),
  STRIPE_PRICE_PARENT_YEARLY: z.string().min(1).optional(),

  // Product notifications (contracts/notifications.contract.md §12.2). Read at:
  //   RESEND_API_KEY           server/lib/notifications/transport.ts
  //   RESEND_WEBHOOK_SECRET    server/routes/resend-webhook.ts
  //   NOTIFICATION_FROM_EMAIL  server/lib/notifications/transport.ts
  // Optional in the shape for the same reason as the Stripe keys; production
  // presence is enforced at startup by apps/api/src/env.ts validateEnvironment().
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  NOTIFICATION_FROM_EMAIL: z.string().email().optional(),
});

/**
 * The notification lane's three variables, as one schema so the startup validator and
 * the transport parse the same shape.
 */
export const notificationEnvSchema = envSchema.pick({
  RESEND_API_KEY: true,
  RESEND_WEBHOOK_SECRET: true,
  NOTIFICATION_FROM_EMAIL: true,
});
export type NotificationEnv = z.infer<typeof notificationEnvSchema>;

/**
 * The Stripe variable names this codebase reads, derived from the canonical
 * schema so there is one source rather than two lists to keep in step.
 *
 * `ci/env-example-stripe-parity` asserts `server/.env.example` advertises
 * exactly these names — no more, no fewer. That check exists because the file
 * previously advertised a `_TEST`/`_LIVE` key model the code had stopped
 * reading, and an audit caught it rather than a test.
 */
export const STRIPE_ENV_VAR_NAMES: readonly string[] = Object.keys(
  envSchema.shape,
).filter((k) => k.startsWith("STRIPE_"));

export type Env = z.infer<typeof envSchema>;

/** Parse-or-throw. Throws a ZodError listing every invalid/missing var. */
export function parseEnv(source: unknown = process.env): Env {
  return envSchema.parse(source);
}

/** Non-throwing variant for callers that want to handle the failure explicitly. */
export function safeParseEnv(
  source: unknown = process.env,
): z.SafeParseReturnType<unknown, Env> {
  return envSchema.safeParse(source);
}
