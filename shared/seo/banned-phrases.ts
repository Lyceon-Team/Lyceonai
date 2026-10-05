/**
 * The phrasings public copy must never carry: the claims F6 removed and the mechanisms the
 * doctrine keeps private.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 (Public Disclosure Doctrine) rules 1-3, 5;
 *       §5 F6, F14; owner Step 0 decision 10 for Wave 2 (2026-10-05): the QOTD scheduler screens
 *       candidates against the SAME list] | @implemented [2026-10-05]
 *
 * plain English: one list, two consumers. tests/ci/public-copy-claims.contract.test.ts fails
 * if any rendered public page carries a phrase; server/services/qotd/schedule-job.ts never
 * schedules a question whose text matches one, because a Question of the Day becomes a public
 * archive page. Each entry names why it is banned, in the claim inventory's categories
 * (docs/compliance/claim-inventory.md): (b) contradicts the product, (c) a mechanism,
 * (d) an unsourced fact, (e) an unapproved Lyceon claim.
 */
export type BannedPhrase = { readonly pattern: RegExp; readonly why: string };

export const BANNED: readonly BannedPhrase[] = [
  // Taglines and absolutes.
  { pattern: /score higher/i, why: "(e) implied outcome: the old tagline" },
  {
    pattern: /\bfinger ?tips\b/i,
    why: "(b) the tutor is paid: old OG image text",
  },
  {
    pattern: /\bunlimited\b/i,
    why: "(b) paid practice and the tutor are rate-limited",
  },
  { pattern: /\bunlock everything\b/i, why: "(e) absolute" },
  { pattern: /priority feature access/i, why: "(b) no such entitlement" },
  { pattern: /\breal progress\b/i, why: "(e) outcome claim" },
  { pattern: /\bexpert sat prep\b/i, why: "(e) unapproved claim" },
  {
    pattern: /\bmaster (the |digital |sat )/i,
    why: '(e) outcome claim ("Master the Digital SAT")',
  },
  { pattern: /\bcomprehensive guides?\b/i, why: "(e) puffery" },
  // Adaptivity: only the paid study plan adapts (R15), and selection is a mechanism.
  {
    pattern: /\badaptive (practice|question|difficulty|flow|sat)/i,
    why: "(b, c) R15",
  },
  { pattern: /\bpractice adaptively\b/i, why: "(b, c) R15" },
  { pattern: /difficulty adjusts/i, why: "(b, c) R15" },
  { pattern: /question selection adjusts/i, why: "(b, c) R15" },
  { pattern: /adapt to your level/i, why: "(b, c) R15" },
  // The tutor described by how it works.
  { pattern: /\bgrounded in\b/i, why: "(c) describes the tutor's grounding" },
  {
    pattern: /references current question context/i,
    why: "(c) tutor mechanism",
  },
  { pattern: /analyzing question/i, why: "(c) the removed tutor demo" },
  { pattern: /how does lisa work/i, why: "(c) tutor mechanism" },
  { pattern: /generic chatbot/i, why: "(c) tutor mechanism" },
  // Guardian visibility described beyond the ruling.
  {
    pattern: /expanded (guardian|visibility)/i,
    why: "(b) guardian view is read-only, paid plan only",
  },
  { pattern: /entitlement-gated/i, why: "(c) internal mechanism" },
  { pattern: /planning signals/i, why: "(b, c) guardian view" },
  // Internal architecture and "evidence" (F14, Doctrine rule 4).
  { pattern: /trust evidence/i, why: "(c) F14: the evidence page is removed" },
  {
    pattern: /\/trust\/evidence/i,
    why: "(c) F14: the evidence page is removed",
  },
  { pattern: /implementation-backed/i, why: "(c) Doctrine rule 4" },
  {
    pattern: /add the page to the router/i,
    why: "(c) developer message on the 404 page",
  },
  {
    pattern: /legal consent are handled in one standard flow/i,
    why: "(c) auth mechanism",
  },
  // Unsourced or wrong facts about the SAT, and the question bank's size.
  {
    pattern: /thousands of (sat )?(practice )?questions/i,
    why: "(c) question-bank size",
  },
  { pattern: /nearly 35%/i, why: "(d) unsourced" },
  { pattern: /98-question/i, why: "(d, c) exam-form structure" },
  {
    pattern: /calculators? (access )?(for|on) all (math )?questions/i,
    why: "(d) unsourced wording",
  },
  { pattern: /typical coverage/i, why: "(d) unpublished per-skill counts" },
  { pattern: /~\d+-\d+ questions/i, why: "(d) unpublished per-skill counts" },
  {
    pattern: /here's exactly how it works/i,
    why: "(d) scoring the College Board does not publish",
  },
  { pattern: /module 1 matters most/i, why: "(d) unsourced" },
];

/** The first banned phrase `text` matches, or null. Patterns carry no `g` flag (no lastIndex state). */
export function firstBannedPhrase(text: string): BannedPhrase | null {
  return BANNED.find((b) => b.pattern.test(text)) ?? null;
}
