/**
 * @spec [Doc-06B §3 "Secrets at Runtime"; Coding Standards §7.1]
 * @implemented 2026-09-02
 *
 * plain English: Parses GCP service-account JSON from the
 * `GCP_SERVICE_ACCOUNT_JSON` env var and caches the result for the
 * lifetime of the process. Every @google-cloud/* and @google/genai
 * client in the BFF receives the parsed object via the explicit
 * `credentials` constructor option — ADC is removed from the path.
 *
 * expected outcome: `getGcpCredentials()` returns a Zod-validated
 * service-account object, or throws a fixed-vocabulary error that
 * can never contain credential material.
 *
 * trade-offs / edge cases:
 *  - The empty catch on `JSON.parse` is deliberate. A parse error's
 *    message quotes its input, which IS the credential. Discarding
 *    the error is the only safe behavior here.
 *  - `safeParse` is used instead of `parse` because `ZodError`
 *    embeds received values in its issues. A malformed key file
 *    would put `private_key` into the thrown error.
 *  - The cached singleton is module-scoped. A cold start parses
 *    once; subsequent calls return the cached object.
 *  - This module is BFF-only. The Cloud Run worker uses the
 *    metadata server and must not receive a key.
 */
import { z } from "zod";

const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  private_key_id: z.string().min(1),
  private_key: z.string().startsWith("-----BEGIN"),
  client_email: z.string().email(),
  client_id: z.string().min(1),
  auth_uri: z.string().url(),
  token_uri: z.string().url(),
});

export type GcpServiceAccount = z.infer<typeof serviceAccountSchema>;

let cached: GcpServiceAccount | null = null;

/**
 * Returns the validated GCP service-account credential object.
 * Throws a fixed-vocabulary error on any failure — no code path
 * can put credential material into the thrown message.
 */
export function getGcpCredentials(): GcpServiceAccount {
  if (cached) return cached;

  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not set");
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    // Deliberately discards the parse error. Its message quotes the input,
    // which IS the credential. This is the one place in this repo where
    // discarding an error is correct — a future reviewer tempted to
    // "fix" this empty catch should read the commit message first.
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  const result = serviceAccountSchema.safeParse(candidate);
  if (!result.success) {
    // Key paths only. Never result.error, never the received values.
    const failed = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `GCP_SERVICE_ACCOUNT_JSON failed validation on: ${failed}`,
    );
  }

  cached = result.data;
  return cached;
}

/**
 * Clears the cached credential. For testing only.
 * @internal
 */
export function _resetGcpCredentialsCache(): void {
  cached = null;
}
