/**
 * @spec [Doc-03B_V4.1 §8.3 (list cursor), §7.3 (cursor format, CR-03B-28)]
 * | @implemented [2026-09-29]
 *
 * plain English: encodes and decodes the opaque cursor for
 * GET /api/tutor/conversations, and merges the two keyset reads that make up a
 * page after the first. The cursor is base64url(JSON) of
 * `{v:1, sort:"updated_at_desc", anchor_ts, anchor_id}` — the last row of the
 * previous page.
 *
 * expected outcome: page N+1 starts strictly after the anchor in
 * (updated_at DESC, id DESC) order, so no row repeats and none is skipped even
 * when rows share an updated_at.
 *
 * trade-offs: "strictly after" is `updated_at < ts OR (updated_at = ts AND
 * id < anchor_id)`. PostgREST can express that only as an `.or()` filter
 * string, which would carry a timestamp through PostgREST's filter grammar.
 * Two plain reads (the ties, then the older rows), each capped at limit+1 and
 * merged here, express the same predicate with ordinary filters.
 *
 * edge cases: a malformed or foreign cursor decodes to `null` and the caller
 * answers 400; the raw cursor is never logged.
 */
import {
  conversationListCursorSchema,
  type ConversationListCursor,
} from "../../packages/shared/src/tutor-lifecycle-schema";
import { logger } from "../logger";

export function encodeConversationCursor(anchor: {
  updated_at: string;
  id: string;
}): string {
  const raw: ConversationListCursor = {
    v: 1,
    sort: "updated_at_desc",
    anchor_ts: anchor.updated_at,
    anchor_id: anchor.id,
  };
  return Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
}

export function decodeConversationCursor(
  encoded: string,
): ConversationListCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    // An undecodable cursor is the client's expected failure (400 upstream),
    // not a throw. Logged so the catch is not silent (Coding Standards §13);
    // only its length, since Node's JSON error text quotes the input.
    logger.debug(
      "TUTOR_RUNTIME",
      "list_cursor_malformed",
      "Conversation list cursor did not decode",
      { cursorLength: encoded.length },
    );
    return null;
  }
  const result = conversationListCursorSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Merges the two keyset reads for a cursor page. Every tie (same updated_at,
 * smaller id) sorts before every strictly older row, so concatenation is the
 * (updated_at DESC, id DESC) order; `cap` is limit+1.
 */
export function mergeKeysetReads<T>(
  ties: readonly T[],
  older: readonly T[],
  cap: number,
): T[] {
  return [...ties, ...older].slice(0, cap);
}
