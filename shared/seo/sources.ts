/**
 * External sources for the general facts stated on public pages.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 rule 3 ("General facts cite real sources"),
 *       §5 F6] | @implemented [2026-10-03] | plain English: every statement about the SAT that
 * a public page makes is backed by one of these pages, and the page shows the link next to
 * the statement. Each entry was fetched on 2026-10-03 and its text read for the exact facts
 * the copy states (recorded in `docs/compliance/claim-inventory.md`). The FAQPage JSON-LD
 * carries the answer text only, so a source never changes what search engines quote.
 * Studying facts that are not about the SAT cite research instead (CEPEDA_2006).
 */
export type Source = { readonly label: string; readonly url: string };

/** Section timing, question counts, the two modules per section and how the second adapts. */
export const CB_STRUCTURE: Source = {
  label: "College Board: SAT structure",
  url: "https://satsuite.collegeboard.org/sat/whats-on-the-test/structure",
};

/** The four Math content domains. */
export const CB_MATH: Source = {
  label: "College Board: the Math section",
  url: "https://satsuite.collegeboard.org/sat/whats-on-the-test/math",
};

/** Passage length (25–150 words), one question per passage, the four Reading and Writing domains. */
export const CB_READING_WRITING: Source = {
  label: "College Board: the Reading and Writing section",
  url: "https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing",
};

/** Calculator use throughout the Math section; the Desmos calculator built into Bluebook. */
export const CB_CALCULATOR: Source = {
  label: "College Board: calculator policy",
  url: "https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy",
};

/** Total score 400–1600; section scores 200–800. */
export const CB_SCORES: Source = {
  label: "College Board: understanding SAT scores",
  url: "https://satsuite.collegeboard.org/sat/scores/understanding-scores",
};

/** Spacing effect: spread-out practice is retained better than massed practice. */
export const CEPEDA_2006: Source = {
  label:
    "Cepeda, Pashler, Vul, Wixted & Rohrer (2006), Distributed practice in verbal recall tasks: A review and quantitative synthesis, Psychological Bulletin 132(3), 354–380",
  url: "https://doi.org/10.1037/0033-2909.132.3.354",
};
