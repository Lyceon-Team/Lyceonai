import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { LevelPill } from "@/components/mastery/LevelPill";
import { MasteryMeter } from "@/components/mastery/MasteryMeter";
import type { MasteryDomainNode, MasterySection } from "@/lib/masteryApi";
import { UNMEASURED_DISPLAY_NAME } from "@lyceon/shared/mastery-levels";
import { CANONICAL_DOMAINS_BY_SECTION } from "@shared/canonical-domains";

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
 * GUARDIANS SEE NO SKILLS (owner ruling 2026-10-01, #1013 review item 2; SCL-194). `viewer`
 * is required, as on `HeaderFacts`. For `viewer="guardian"` the grid draws nothing
 * skill-related — no "Skills" control, whatever `onOpen` it is handed — so a guardian caller
 * that passed a drill-down by mistake still renders none; the server refuses a guardian's
 * skills read with 403 in any case. The student page passes `viewer="student"` and `onOpen`,
 * and each card keeps its drill-down. Domain levels and the meter are the same for both.
 */
export function DomainGrid({
  viewer,
  domains,
  sections = ALL_SECTIONS,
  onOpen,
}: {
  viewer: "student" | "guardian";
  domains: readonly MasteryDomainNode[];
  sections?: readonly MasterySection[];
  onOpen?: (target: { section: MasterySection; domain: string }) => void;
}): JSX.Element {
  const openSkills = viewer === "student" ? onOpen : undefined;
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
          <CardContent className="flex flex-col gap-3">
            {/* The pill (and the student's Skills control) on one row; beneath it, the
                five-segment meter across the card's full content width (owner review
                2026-10-01). */}
            <div className="flex items-center justify-between gap-3">
              <LevelPill
                levelKey={node.levelKey}
                displayName={node.displayName}
              />
              {openSkills === undefined ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    openSkills({ section: node.section, domain: node.domain })
                  }
                  data-testid="domain-open"
                  aria-label={`View skills in ${node.domain}`}
                >
                  Skills
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
            {/* The one segment renderer `MasteryRow` also draws (UI-42), stretched across
                the card. The card keeps its title / pill / meter layout until Wave 5 rebuilds
                the Mastery page with mastery rows (UI-37). */}
            <MasteryMeter
              levelKey={node.levelKey}
              displayName={node.displayName}
              size="fill"
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
