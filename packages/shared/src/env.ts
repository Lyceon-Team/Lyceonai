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
});

export type Env = z.infer<typeof envSchema>;

/** Parse-or-throw. Throws a ZodError listing every invalid/missing var. */
export function parseEnv(source: unknown = process.env): Env {
  return envSchema.parse(source);
}

/** Non-throwing variant for callers that want to handle the failure explicitly. */
export function safeParseEnv(source: unknown = process.env): z.SafeParseReturnType<unknown, Env> {
  return envSchema.safeParse(source);
}
