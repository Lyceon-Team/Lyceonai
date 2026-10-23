/**
 * @spec [Doc-03C_V3 §4.3 — versioned prompt artifact; CC Brief "Video Library (ships now)"
 *        §7, Karl 2026-10-15 (the model never emits a video identifier: it offers a video by
 *        index into the turn's offered set, and the BFF attaches the id);
 *        LISA_Video_RAG_Plan.md Step G (lisa-default-v3 composing v2)]
 * @implemented 2026-10-15
 *
 * plain English: v2's rules, unchanged, plus one: when the context lists videos Lyceon can
 * offer for this skill (the [VIDEOS] block, rendered from `offered_videos`), LISA may offer
 * one — named by its title, in a sentence — and marks the offer with [OFFER_VIDEO n] on its
 * own line, n being the video's number in that list. The worker strips every marker; a valid
 * one becomes the `recommend_video` action carrying the index, and the BFF resolves the index
 * to the video. LISA never writes a link, a video address or an identifier.
 *
 * trade-offs:
 *  - v2 is immutable once published (§4.3). v3 composes it: v2's rendered text is reproduced
 *    byte-for-byte, and the video rule follows. A turn attributed to v2 still renders exactly
 *    as it did.
 *  - The rule is in the prompt artifact; the list of videos is a per-turn state block, so a
 *    turn with no offered videos gets a rule that never applies, and nothing else changes.
 *  - The marker is a plain token, like the practice handoff: deterministic to parse, always
 *    stripped, never shown to the student.
 */

import type { PromptArtifact, PromptFields } from "./types.js";
import { LISA_DEFAULT_V2 } from "./lisa-default-v2.js";

/** The token LISA ends a message with to offer video n of the turn's [VIDEOS] list. */
export const VIDEO_OFFER_MARKER = "[OFFER_VIDEO n]";

export const LISA_DEFAULT_V3: PromptArtifact = {
  version: "lisa-default-v3",
  policyVariant: "default",

  renderSystemInstruction: (fields: PromptFields): string =>
    [
      LISA_DEFAULT_V2.renderSystemInstruction(fields),
      `When the context blocks include a [VIDEOS] list and a short video would help — the ` +
        `student is stuck after an explanation, or asks for a video or another way to see ` +
        `it — you may offer one video from that list, naming it by its title in one ` +
        `sentence, and end your message with ${VIDEO_OFFER_MARKER} on its own line, where n ` +
        `is the video's number in the list. Offer at most one video per message, and only ` +
        `from that list. Never write a link, a web address, or a video's address, and ` +
        `never offer a video that is not in the list.`,
    ].join("\n\n"),
};

/** The client's label for the video action. */
export const VIDEO_OFFER_LABEL = "Watch a short video";

const VIDEO_OFFER_PATTERN = /\[\s*OFFER_VIDEO(?:\s+(\d+))?\s*\]/gi;

export type VideoOffer = {
  /** The model's text with every video marker removed — what the student reads. */
  content: string;
  /** The offered video's 1-based number, when the marker named one that exists. */
  index: number | null;
};

/**
 * Pure. Strips every video marker — the student never sees one — and returns the first
 * marker's number when it names a video in the turn's list (1..offeredCount). A marker
 * with no number, a number outside the list, or a turn with no list yields null: no
 * action, and nothing to resolve to a video.
 */
export function extractVideoOffer(
  text: string,
  offeredCount: number,
): VideoOffer {
  const matches = [...text.matchAll(VIDEO_OFFER_PATTERN)];
  if (matches.length === 0) return { content: text, index: null };
  const n = Number(matches[0]?.[1] ?? NaN);
  const index = Number.isInteger(n) && n >= 1 && n <= offeredCount ? n : null;
  const content = text
    .replace(VIDEO_OFFER_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { content, index };
}
