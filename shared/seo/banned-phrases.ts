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
  // Taglines and absolutes. ("Score Higher" and "real progress" moved to OUTCOME_PATTERNS below:
  // Karl approved specific uses of each on 2026-10-05, F13; every other use still fails.)
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
  {
    pattern: /of students got this right/i,
    why: '(e) superseded: the QOTD stat reads "N% answered correctly" (approved by Karl 2026-10-05)',
  },
];

/**
 * Words pipeline content never uses: AI, models, automation, or how content is made.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §2.12 ("Content never mentions AI, automation or how it was
 *       made; the only AI it names is LISA, as a product feature"), §2.13, §5 gate 12; owner answer
 *       on Doc 10B Phase 1 Step 0, item 8 (Karl, 2026-10-11): "content may name LISA as a product
 *       feature ('LISA, your AI tutor'). Nothing else about AI, models, automation or process."]
 *       | @implemented [2026-10-11]
 *
 * plain English: applied to every blog post by the content gate (shared/seo/content-gate.ts). The
 * product pages, which describe the AI tutor as a feature, are not pipeline content and keep their
 * wording. The one exception, LISA named as the AI tutor, is set aside before matching.
 */
export const PIPELINE_BANNED: readonly BannedPhrase[] = [
  {
    pattern: /\bA\.?I\.?\b/,
    why: "AI (LISA, your AI tutor, is the only exception)",
  },
  {
    pattern:
      /\b(artificial intelligence|machine[- ]learning|neural|(large )?language models?|LLMs?|chatbots?|bots?)\b/i,
    why: "AI or models",
  },
  {
    pattern: /\b((Chat)?GPT|Claude|Codex|Anthropic|OpenAI|Gemini|Copilot)\b/,
    why: "AI or models: a named model or vendor",
  },
  {
    pattern:
      /\b(automat(e|ed|es|ing|ion|ic|ically)|algorithms?|(auto|machine)[- ]generated|generated (by|with))\b/i,
    why: "automation",
  },
  {
    pattern:
      /\b((our|this|the) (process|pipeline|workflow|content team|editorial team)|(written|drafted|reviewed|edited|produced) by)\b/i,
    why: "how content is made",
  },
];

/** "LISA, your AI tutor" and "the AI tutor, LISA": the one AI mention pipeline content may make. */
const LISA_AS_FEATURE =
  /\bLISA\b,?\s+(your|our|an?|the|Lyceon's)\s+AI tutor\b|\bAI tutor,?\s+LISA\b/g;

/** The first pipeline-banned phrase in `text` once LISA-as-a-feature is set aside, or null. */
export function firstPipelinePhrase(text: string): BannedPhrase | null {
  const rest = text.replace(LISA_AS_FEATURE, " ");
  return PIPELINE_BANNED.find((b) => b.pattern.test(rest)) ?? null;
}

/**
 * Outcome claims: wording that promises or implies a result (a higher score, progress, a gain).
 *
 * @spec [Doctrine rule 5 (outcome/performance claims need Karl's written approval); owner ruling
 *       2026-10-05, F13 Step 0 decision 3 ("remove 'score higher' and 'real progress' from the
 *       banned list, recorded in the claim inventory as approved by Karl 2026-10-05. Keep the guard
 *       failing on any other new outcome phrase")] | @implemented [2026-10-05]
 *
 * plain English: public copy may carry an outcome phrase only as one of the exact approved
 * sentences in APPROVED_OUTCOME_PHRASES (claim inventory X1, H34, H38, H40, W18). Each approved
 * sentence is removed from the text first; anything an outcome pattern still matches is an
 * unapproved claim and fails tests/ci/public-copy-claims.contract.test.ts. Adding an approved
 * sentence here is the code half of a written approval; the inventory row is the other half.
 *
 * trade-off: Question of the Day candidates are screened with it too (schedule-job.ts), because a
 * scheduled question becomes a public archive page; an SAT passage that mentions scores rising is
 * skipped for another candidate, which costs nothing.
 */
export const APPROVED_OUTCOME_PHRASES: readonly string[] = [
  // X1: the slogan, visible copy only (title stays "Lyceon | SAT Prep").
  "Study Smarter, Score Higher",
  // H34: homepage-hero Variant B headline.
  "See real SAT progress before test day",
  // H38: "How it works" card 4 heading.
  "See real progress",
  // H40: the example parent view's label.
  "Real progress comes from the student's account",
  // W18 (SEO Wave 3, approved by Karl 2026-10-05): the College Board's own finding, quoted with
  // its "link, not proof" caveat on /free-sat-practice-test.
  "students who took one, two, or three or more Bluebook practice tests scored about 25, 45 and 60 points higher than similar students who took none",
];

export const OUTCOME_PATTERNS: readonly BannedPhrase[] = [
  { pattern: /\bscores? higher\b/i, why: "(e) outcome claim: a higher score" },
  {
    pattern: /\bhigher (sat )?scores?\b/i,
    why: "(e) outcome claim: a higher score",
  },
  {
    pattern: /\b(raise|boost|improve|increase|lift)s?\b[^.]{0,20}\bscores?\b/i,
    why: "(e) outcome claim: a score gain",
  },
  { pattern: /\breal (sat )?progress\b/i, why: "(e) outcome claim: progress" },
  { pattern: /\bguarantee/i, why: "(e) outcome claim: a guarantee" },
  { pattern: /\bproven\b/i, why: "(e) outcome claim: proof" },
  {
    pattern: /\b\d+\+? ?points? (higher|more|increase|gain|improvement)/i,
    why: "(e) outcome claim: a points gain",
  },
];

/** The first outcome pattern `text` matches once every approved sentence is set aside, or null. */
export function firstUnapprovedOutcome(text: string): BannedPhrase | null {
  let rest = text;
  for (const phrase of APPROVED_OUTCOME_PHRASES)
    rest = rest.split(phrase).join(" ");
  return OUTCOME_PATTERNS.find((o) => o.pattern.test(rest)) ?? null;
}

/** The first banned phrase `text` matches, or null. Patterns carry no `g` flag (no lastIndex state). */
export function firstBannedPhrase(text: string): BannedPhrase | null {
  return BANNED.find((b) => b.pattern.test(text)) ?? null;
}

/**
 * Internal labels and mechanisms content pages never name.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §5 gate 2 ("no mechanisms, no proprietary details, no bank
 *       size, no internal labels"); docs/plans/seo/seo-marketing-vertical.md §0 rule 2]
 *       | @implemented [2026-10-11]
 *
 * plain English: applied by the content gate (shared/seo/content-gate.ts) to every content page
 * and post. Not part of BANNED, which scans every public page: the legal pages must name
 * entitlements and the mastery data they hold, and do so as a privacy and billing disclosure,
 * not as a description of how anything works.
 */
export const INTERNAL_LABELS: readonly BannedPhrase[] = [
  {
    pattern: /\bmastery (score|engine|model|algorithm|level|weights?)s?\b/i,
    why: "(c) mastery computation",
  },
  {
    pattern: /\bscoring (formula|model|algorithm|weights?|constants?)\b/i,
    why: "(c) the scoring formula",
  },
  {
    pattern: /\bquestion[- ]selection\b|\bitem response theory\b|\bIRT\b/i,
    why: "(c) question selection logic",
  },
  {
    pattern: /\b(entitlements?|canonical (ids?|questions?))\b/i,
    why: "(c) internal label",
  },
  {
    pattern: /\b(SCL|INV|OQ|SEO)-\d+\b/,
    why: "(c) internal label: a register or plan ID",
  },
];

/** The first internal label or mechanism in `text`, or null. */
export function firstInternalLabel(text: string): BannedPhrase | null {
  return INTERNAL_LABELS.find((b) => b.pattern.test(text)) ?? null;
}
