/**
 * @spec [contracts/notifications.contract.md §7.2] | @implemented [2026-09-03]
 *
 * plain English: verifies a Resend webhook the way Svix signs it. Signed content is
 * `${svix-id}.${svix-timestamp}.${raw body}`; the key is the base64 part of the
 * `whsec_...` secret; the header carries one or more `v1,<base64 signature>` entries
 * separated by spaces. The timestamp must be within the tolerance window (replay defence).
 * Comparison is constant-time. No dependency: the algorithm is small and the repo does not
 * add packages without approval.
 *
 * Expected failures come back as a Result so the receiver can answer 400 without a throw.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { RESEND_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS } from "../../../packages/shared/src/notifications-schema";
import { err, ok, type Result } from "../../../packages/shared/src/result";

export type SvixHeaders = {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
};

export type SvixFailure =
  | "missing_headers"
  | "bad_secret"
  | "bad_timestamp"
  | "timestamp_out_of_range"
  | "signature_mismatch";

export type SvixVerification = { id: string; timestampSeconds: number };

function decodeSecret(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  if (raw.length === 0) return null;
  const key = Buffer.from(raw, "base64");
  return key.length > 0 ? key : null;
}

export function verifySvixSignature(args: {
  headers: SvixHeaders;
  rawBody: Buffer;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Result<SvixVerification, SvixFailure> {
  const { id, timestamp, signature } = args.headers;
  if (!id || !timestamp || !signature) return err("missing_headers");

  const key = decodeSecret(args.secret);
  if (!key) return err("bad_secret");

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return err("bad_timestamp");
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance =
    args.toleranceSeconds ?? RESEND_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  if (Math.abs(now - ts) > tolerance) return err("timestamp_out_of_range");

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(args.rawBody)
    .digest();

  const candidates = signature
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("v1,"))
    .map((entry) => Buffer.from(entry.slice(3), "base64"));

  const matched = candidates.some(
    (candidate) =>
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected),
  );
  if (!matched) return err("signature_mismatch");

  return ok({ id, timestampSeconds: ts });
}
