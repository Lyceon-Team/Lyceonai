import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { LevelPill } from "@/components/mastery/LevelPill";
import type { MasteryDomainNode, MasterySection } from "@/lib/masteryApi";
import { UNMEASURED_DISPLAY_NAME } from "@lyceon/shared/mastery-levels";
import { CANONICAL_DOMAINS_BY_SECTION } from "@shared/question-bank-contract";

/** Server order: Math, then Reading & Writing (`canonicalDomainPairs`). */
const ALL_SECTIONS: readonly MasterySection[] = ["M", "RW"];

/**
 * @spec [owner ruling 2026-08-20 RULE 1, RULE 5 (drill-down: domain first, then skills);
 *   Guardian_Closure_Plan G4-03, R11; owner approval 2026-09-30 (extraction); owner decision
 *   2026-10-01 on #1003 (always the eight domains, four per section)]
 *   | @implemented [2026-09-30]
 *
 * plain English: the grid of domain cards, each naming its mastery level with `LevelPill`
 * (the name from `mastery_levels`, never a client table). Extracted from `pages/mastery.tsx`
 * so the student page and the guardian Dashboard render ONE component (R11), not two.
 *
 * ALWAYS THE CANONICAL DOMAINS. The cards are driven by `CANONICAL_DOMAINS_BY_SECTION` — the
 * list and order the server's `canonicalDomainPairs` uses — not by the rows handed in. A
 * served row keeps its level and the server's words; a domain with no row is a card reading
 * "Not enough answers yet" (the `unmeasured` state), never a missing card. The server already
 * sends all eight, so for a real payload this changes nothing; it stops a short payload from
 * quietly hiding domains. `sections` narrows to one section's four (the guardian Dashboard
 * draws a grid per section). A row whose domain is not canonical is not drawn — the database
 * CHECK makes one impossible.
 *
 * READ-ONLY IS THE ABSENCE OF `onOpen`. The student page passes it and each card gets its
 * "Skills" drill-down; the guardian Dashboard does not, so no card carries a control and no
 * skill is reachable (skills are student-only, Doc 05B §10.4). There is no mode flag to set
 * wrong: a guardian caller cannot render a drill-down it was never handed.
 */
export function DomainGrid({
  domains,
  sections = ALL_SECTIONS,
  onOpen,
}: {
  domains: readonly MasteryDomainNode[];
  sections?: readonly MasterySection[];
  onOpen?: (target: { section: MasterySection; domain: string }) => void;
}): JSX.Element {
  const served = new Map(domains.map((d) => [`${d.section}:${d.domain}`, d]));
  const nodes: MasteryDomainNode[] = sections.flatMap((section) =>
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
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      data-testid="domain-grid"
    >
      {nodes.map((node: MasteryDomainNode) => (
        <Card
          key={`${node.section}-${node.domain}`}
          className="bg-card/80 border-border/60"
          data-domain={node.domain}
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold tracking-tight">
              {node.domain}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <LevelPill
              levelKey={node.levelKey}
              displayName={node.displayName}
            />
            {onOpen === undefined ? null : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onOpen({ section: node.section, domain: node.domain })
                }
                data-testid="domain-open"
                aria-label={`View skills in ${node.domain}`}
              >
                Skills
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
