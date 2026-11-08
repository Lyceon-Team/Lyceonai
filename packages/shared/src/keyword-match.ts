/**
 * @spec [owner brief "Video retrieval: method tags", Karl 2026-10-27 (a versioned keyword map in
 *       runtime config, no model call); owner brief "Help-level engine", Karl 2026-11-05 (rule 4:
 *       "a versioned keyword map in runtime config, as with `video_method_keywords`")]
 *       | @implemented [2026-10-27, generalised 2026-11-05]
 *
 * plain English: THE one deterministic phrase matcher for the tutor's runtime-config keyword maps
 * (`video_method_keywords`, `tutor_help_keywords`). The student's message is normalised, every
 * phrase is matched on whole words, the longest matching phrase wins, and two keys tied on the
 * longest phrase give no match. No model call; the same message and map always give the same
 * answer.
 *
 * Edge cases: an empty or punctuation-only message matches nothing. Phrases must already be in
 * normalised form (lowercase words, single spaces, no punctuation: "i'm" is written "i m").
 */
import { z } from "zod";

/**
 * Lowercase (NFKC), every run of non-letters/digits becomes one space, padded with a space at
 * each end so a phrase matches only on whole words (" graph it " is not in " graphite ").
 */
export function normaliseForMatch(text: string): string {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return words === "" ? " " : ` ${words} `;
}

/** A phrase as a keyword map stores it: already normalised. */
export const keywordPhraseSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((p) => normaliseForMatch(p) === ` ${p} `, {
    message:
      "a phrase must already be normalised: lowercase words separated by single spaces",
  });

/**
 * Pure. The key whose phrase is the longest whole-word match in `message`, or null when nothing
 * matches or two keys tie on the longest phrase. `keys` fixes the iteration order.
 */
export function detectKeyword<K extends string>(
  message: string,
  keys: readonly K[],
  phrases: Partial<Record<K, readonly string[]>>,
): K | null {
  const haystack = normaliseForMatch(message);
  let best: { key: K; length: number } | null = null;
  let tied = false;
  for (const key of keys) {
    for (const phrase of phrases[key] ?? []) {
      if (!haystack.includes(` ${phrase} `)) continue;
      if (best === null || phrase.length > best.length) {
        best = { key, length: phrase.length };
        tied = false;
      } else if (phrase.length === best.length && best.key !== key) {
        tied = true;
      }
    }
  }
  return best === null || tied ? null : best.key;
}
