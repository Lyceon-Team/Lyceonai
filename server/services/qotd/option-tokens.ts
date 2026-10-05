/**
 * Opaque, stateless option tokens for today's Question of the Day.
 *
 * @spec [owner ruling 2026-10-05 (QOTD follow-up, item 1): "shuffles the options on every
 *       request ... each option is returned as an opaque, stateless token: an HMAC of
 *       (qotd_date, canonical option id) under a key derived from the server secret ... on
 *       submit, recompute the four tokens to resolve the answer"; Coding Standards §5.2]
 *       | @implemented [2026-10-05]
 *
 * plain English: token(date, key) = base64url(HMAC-SHA256(K, "<date>:<key>")), 22 characters,
 * where K = HMAC-SHA256(PUBLIC_RATE_LIMIT_HMAC_SECRET, "lyceon:qotd:option-token:v1"), a
 * sub-key with its own label so these tokens can never collide with the rate-limit subject
 * HMAC made from the same secret. Nothing is stored: the server recomputes the four tokens on
 * submit and maps the submitted one back to its canonical key. A token reveals nothing about
 * the canonical letter without the secret, so the order the browser shows (A-D by position)
 * is the only lettering a visitor sees.
 *
 * trade-offs: tokens are the same for every visitor on a given day (stateless by design); the
 * answer is public once anyone submits, so a per-visitor token would protect nothing more.
 * Missing secret -> PublicIpSecretMissingError, which the route turns into a 503.
 */
import { createHmac } from "node:crypto";
import { requirePublicHmacSecret } from "../../lib/client-ip";

const TOKEN_LABEL = "lyceon:qotd:option-token:v1";
/** 16 bytes of HMAC, base64url without padding: 22 characters. */
const TOKEN_BYTES = 16;

function tokenKey(): Buffer {
  return createHmac("sha256", requirePublicHmacSecret())
    .update(TOKEN_LABEL)
    .digest();
}

/** The one derivation: base64url(HMAC-SHA256(key, "<date>:<canonicalKey>")), first 16 bytes. */
function deriveToken(
  key: Buffer,
  qotdDate: string,
  canonicalKey: string,
): string {
  return createHmac("sha256", key)
    .update(`${qotdDate}:${canonicalKey}`)
    .digest()
    .subarray(0, TOKEN_BYTES)
    .toString("base64url");
}

export function qotdOptionToken(
  qotdDate: string,
  canonicalKey: string,
): string {
  return deriveToken(tokenKey(), qotdDate, canonicalKey);
}

/** token -> canonical key, for every canonical key of the day's question. */
export function qotdOptionTokenMap(
  qotdDate: string,
  canonicalKeys: readonly string[],
): Record<string, string> {
  const key = tokenKey();
  const map: Record<string, string> = {};
  for (const canonicalKey of canonicalKeys) {
    map[deriveToken(key, qotdDate, canonicalKey)] = canonicalKey;
  }
  return map;
}
