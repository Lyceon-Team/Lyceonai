/**
 * The caller's IP for public endpoints, its keyed hash, and what may be logged of it.
 *
 * @spec [SCL-202 ("the RateLimitLedger keys a bucket on HMAC-SHA256(server_secret, client_ip)
 *       ... The raw IP is never stored or logged"); owner Step 0 decisions 2026-10-05: (2) the
 *       narrow fix — digest the IP in logs for /api/public/* only; (3) lyceon.ai is served by
 *       Vercel directly (not behind Cloudflare), so the IP is x-vercel-forwarded-for, then req.ip]
 *       | @implemented [2026-10-05]
 *
 * plain English:
 *   * clientIp: the first address in `x-vercel-forwarded-for` (set by Vercel's edge to the
 *     connecting client), else `req.ip` (Express, `trust proxy` 1), else the socket. Header
 *     precedence is fixed here and nowhere else.
 *   * subjectHmacHex: HMAC-SHA256(PUBLIC_RATE_LIMIT_HMAC_SECRET, ip) as 64 hex characters, the
 *     ledger subject. Throws when the secret is missing: the caller fails closed (503) rather
 *     than limiting on an unkeyed value.
 *   * loggableIp: for /api/public/* the first 8 hex characters of that keyed HMAC, which cannot
 *     be reversed without the secret (an unkeyed SHA-256 of an IPv4 address can be, by trying
 *     all 2^32), or nothing when the secret is missing. Every other route is unchanged.
 *
 * trade-offs: x-vercel-forwarded-for is trusted because Vercel overwrites it at the edge; a
 * deployment behind another proxy (the stale Cloudflare runbook line) would need this revisited.
 */
import { createHmac } from "node:crypto";
import type { Request } from "express";

export const PUBLIC_API_PREFIX = "/api/public/";

export class PublicIpSecretMissingError extends Error {
  constructor() {
    super("PUBLIC_RATE_LIMIT_HMAC_SECRET is not set");
    this.name = "PublicIpSecretMissingError";
  }
}

type IpRequest = Pick<Request, "headers" | "ip" | "socket"> & {
  originalUrl?: string;
  url?: string;
};

export function clientIp(req: IpRequest): string | null {
  const header = req.headers["x-vercel-forwarded-for"];
  const raw = Array.isArray(header) ? header[0] : header;
  const first = raw?.split(",")[0]?.trim();
  if (first) return first;
  return req.ip || req.socket?.remoteAddress || null;
}

function hmacSecret(): string | null {
  const secret = process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

/** HMAC-SHA256(server secret, ip), 64 lowercase hex characters. Throws if the secret is unset. */
export function subjectHmacHex(ip: string): string {
  const secret = hmacSecret();
  if (!secret) throw new PublicIpSecretMissingError();
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export function isPublicApiRequest(req: IpRequest): boolean {
  const path = req.originalUrl ?? req.url ?? "";
  return path.startsWith(PUBLIC_API_PREFIX);
}

/** What a log line may carry for the caller's IP (see the module note). */
export function loggableIp(req: IpRequest): string | undefined {
  if (!isPublicApiRequest(req)) {
    return req.ip || req.socket?.remoteAddress || undefined;
  }
  const ip = clientIp(req);
  if (!ip || !hmacSecret()) return undefined;
  return `hmac:${subjectHmacHex(ip).slice(0, 8)}`;
}
