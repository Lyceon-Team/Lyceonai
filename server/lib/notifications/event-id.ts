/**
 * @spec [contracts/notifications.contract.md §5.1 deterministic event ids] | @implemented [2026-09-03]
 *
 * plain English: the TypeScript twin of `public.notification_event_id(event_type, source_id)`.
 * Both take the first 16 bytes of sha256(`${eventType}:${sourceId}`), set the RFC 4122
 * version nibble to 5 and the variant bits to `10`, and format as a uuid. The SQL function is
 * what emits; this function exists so application code can NAME the event a mutation just
 * produced (to dispatch exactly that event's messages inline) without a second round-trip.
 * Parity between the two is asserted in tests/ci/notifications.pg.ci.test.ts — if either
 * derivation drifts, the inline dispatch would silently select nothing.
 */
import { createHash } from "node:crypto";

export function notificationEventId(
  eventType: string,
  sourceId: string,
): string {
  const digest = createHash("sha256")
    .update(`${eventType}:${sourceId}`, "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5 nibble
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
