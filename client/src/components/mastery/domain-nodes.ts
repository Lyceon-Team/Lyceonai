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
 * it was extracted from, is gone: deleted when PR 1069 merged main, its last callers having moved.)
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

/**
 * @spec [owner QA list (Karl, 2026-10-07) item 14: "Home mastery rows deep-link to their domain on
 *   /mastery (check /mastery supports a domain anchor/param; add an anchor id if it's a client-only
 *   change)"] | @implemented [2026-10-07]
 *
 * plain English: one domain's address on the Mastery page, `/mastery?domain=M%3AAlgebra` (section
 * code and domain name). The page opens that domain's skills and scrolls it into view. Only a
 * canonical (section, domain) pair is honoured; anything else reads as no domain, so the page
 * opens as it always did.
 */
const MASTERY_DOMAIN_PARAM = "domain";

function domainKey(section: MasterySection, domain: string): string {
  return `${section}:${domain}`;
}

export function masteryDomainHref(node: {
  section: MasterySection;
  domain: string;
}): string {
  const key = encodeURIComponent(domainKey(node.section, node.domain));
  return `/mastery?${MASTERY_DOMAIN_PARAM}=${key}`;
}

/** The canonical domain a `/mastery` search string names, as the page's open-row key, or null. */
export function masteryDomainFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(MASTERY_DOMAIN_PARAM);
  if (raw === null) return null;
  const sections: readonly MasterySection[] = ["M", "RW"];
  const known = sections.some((section) =>
    CANONICAL_DOMAINS_BY_SECTION[section].some(
      (domain) => domainKey(section, domain) === raw,
    ),
  );
  return known ? raw : null;
}

/** The element id of one domain's block on the Mastery page (the scroll target). */
export function masteryDomainAnchorId(key: string): string {
  return `mastery-domain-${key.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
}
