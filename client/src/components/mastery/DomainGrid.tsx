import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { LevelPill } from "@/components/mastery/LevelPill";
import type { MasteryDomainNode, MasterySection } from "@/lib/masteryApi";

/**
 * @spec [owner ruling 2026-08-20 RULE 1, RULE 5 (drill-down: domain first, then skills);
 *   Guardian_Closure_Plan G4-03, R11; owner approval 2026-09-30 (extraction)]
 *   | @implemented [2026-09-30]
 *
 * plain English: the grid of domain cards, each naming its mastery level with `LevelPill`
 * (the name from `mastery_levels`, never a client table). Extracted from `pages/mastery.tsx`
 * unchanged — `mastery.identity.test.tsx` pins the student page's markup across the move —
 * so the student page and the guardian Dashboard render ONE component (R11), not two.
 *
 * READ-ONLY IS THE ABSENCE OF `onOpen`. The student page passes it and each card gets its
 * "Skills" drill-down; the guardian Dashboard does not, so no card carries a control and no
 * skill is reachable (skills are student-only, Doc 05B §10.4). There is no mode flag to set
 * wrong: a guardian caller cannot render a drill-down it was never handed.
 */
export function DomainGrid({
  domains,
  onOpen,
}: {
  domains: readonly MasteryDomainNode[];
  onOpen?: (target: { section: MasterySection; domain: string }) => void;
}): JSX.Element {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      data-testid="domain-grid"
    >
      {domains.map((node: MasteryDomainNode) => (
        <Card
          key={`${node.section}-${node.domain}`}
          className="bg-card/80 border-border/60"
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
