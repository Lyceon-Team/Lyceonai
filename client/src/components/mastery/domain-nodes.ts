import type { MasteryDomainNode, MasterySection } from "@/lib/masteryApi";
import { UNMEASURED_DISPLAY_NAME } from "@lyceon/shared/mastery-levels";
import { CANONICAL_DOMAINS_BY_SECTION } from "@shared/canonical-domains";

/**
 * @spec [owner decision 2026-10-01 on #1003 (always the eight domains, four per section);
 *   owner ruling 2026-08-20 RULE 1 (levels from `mastery_levels`)] | @implemented [2026-10-01;
 *   extracted from DomainGrid 2026-10-03 for Home's mastery rows, UI-50]
 *
 * plain English: the domains a mastery view draws, ALWAYS the canonical ones in the server's
 * order (`CANONICAL_DOMAINS_BY_SECTION`, as `canonicalDomainPairs`), for the given sections. A
 * served row keeps its level and the server's words; a domain with no row reads "Not enough
 * answers yet" (`unmeasured`), never a missing row and never an invented level. A row whose
 * domain is not canonical is not drawn (the database CHECK makes one impossible). One function,
 * so every mastery view (Home's rows, the Mastery page) draws the same domains. (DomainGrid, which
 * it was extracted from, is gone: deleted when #1069 merged main, its last callers having moved.)
 */
export function canonicalDomainNodes(
  domains: readonly MasteryDomainNode[],
  sections: readonly MasterySection[],
): MasteryDomainNode[] {
  const served = new Map(domains.map((d) => [`${d.section}:${d.domain}`, d]));
  return sections.flatMap((section) =>
    CANONICAL_DOMAINS_BY_SECTION[section].map(
      (domain): MasteryDomainNode =>
        served.get(`${section}:${domain}`) ?? {
          section,
          domain,
          levelKey: "unmeasured",
          level: null,
          displayName: UNMEASURED_DISPLAY_NAME,
        },
    ),
  );
}
