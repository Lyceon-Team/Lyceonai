/**
 * Which past Questions of the Day a content page shows.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R20a; owner decision 1 on Wave 3 Step 0,
 *       2026-10-05 ("up to 2 archived QOTD questions from that domain")] | @implemented [2026-10-05]
 *
 * plain English: the newest `limit` archive days in one section or one canonical domain. One
 * pure function, used by the page in the browser and by the prerender to preload exactly those
 * days, so the static HTML and the live page pick the same questions. Deterministic: the archive
 * newest date first decides, never chance.
 */
export type QotdSampleFilter = { section: "M" | "RW" } | { domain: string };

export function qotdSampleDates(
  days: readonly {
    qotd_date: string;
    section_code: "M" | "RW";
    domain: string;
  }[],
  filter: QotdSampleFilter,
  limit: number,
): string[] {
  return [...days]
    .filter((d) =>
      "section" in filter
        ? d.section_code === filter.section
        : d.domain === filter.domain,
    )
    .sort((a, b) =>
      a.qotd_date < b.qotd_date ? 1 : a.qotd_date > b.qotd_date ? -1 : 0,
    )
    .slice(0, limit)
    .map((d) => d.qotd_date);
}
