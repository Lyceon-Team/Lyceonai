import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { isEntitlementDenialError } from "@/lib/api-error";
import { EmptyStateCTA } from "@/components/feedback/EmptyStateCTA";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";
import {
  fetchMasteryDomains,
  fetchMasterySkills,
  type MasteryDomainNode,
  type MasterySection,
  type MasterySkillNode,
} from "@/lib/masteryApi";
import { LevelPill } from "@/components/mastery/LevelPill";

/**
 * @spec [owner ruling 2026-08-20 RULE 1 (six level names), RULE 4 (nine columns never
 *   exposed), RULE 5 (drill-down: domain first, THEN its skills), RULE 6 (NULL is a
 *   distinct state — a single CTA or blank, never a CTA per card); ruling 2026-08-21 Q2
 *   (skill names verbatim); Coding Standards §11] | @implemented [2026-08-21]
 *
 * plain English: two screens. The first is the eight canonical domains, each showing the
 * name of its mastery level. Clicking one opens that domain's skills. That is the whole
 * surface — there is no third level, no chart, and no number anywhere.
 *
 * WHAT IS DELIBERATELY ABSENT.
 *   `tierToBarPercent` does not come back. The old page drew a progress bar by mapping a
 *   tier to 25 / 60 / 100 percent — a number the mastery model never produced, invented on
 *   the client to make a coarse signal look precise. A bar is a percentage claim; the level
 *   is not a percentage. Nothing on this page renders a `%`.
 *
 * WHY THE NAMES COME FROM THE SERVER.
 *   `displayName` is `mastery_levels.display_name`, straight through. This component maps a
 *   level to a COLOUR (presentation) but never to a NAME — the names are a locked owner
 *   ruling stored in one table, and a client-side copy is exactly how the retired four-tier
 *   labels drifted from what the formula actually meant.
 *
 * expected outcome: a student with no events sees eight domain cards reading "Not enough
 * answers yet" and one CTA for the whole grid; a student mid-course sees per-domain names
 * and drills into any of them.
 * trade-offs: the skill panel is a second request rather than one big payload. That is the
 * point of RULE 5 — the domain screen stays fast and the skills load when asked for.
 * edge cases: `catalogEmpty` renders its own copy, distinct from both "no skills measured"
 * and a failed load. Those are three different facts and they get three different screens.
 */

function SkillPanel({
  section,
  domain,
  onBack,
}: {
  section: MasterySection;
  domain: string;
  onBack: () => void;
}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["/api/me/mastery/domains", section, domain, "skills"],
    queryFn: () => fetchMasterySkills(section, domain),
    retry: 1,
  });

  const skills = data?.skills ?? [];
  // RULE 6: ONE call to action for the panel, shown only when something in it is
  // unmeasured — never one per card. Eight "Practise this" buttons on eight unmeasured
  // skills is a wall of identical asks, and it makes "we have not measured this yet" look
  // like a failure the student caused.
  const hasUnmeasured = skills.some((s) => s.levelKey === "unmeasured");

  return (
    <section data-testid="skill-panel">
      <div className="flex items-center gap-3 mb-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          data-testid="panel-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          All domains
        </Button>
        <h2 className="text-xl font-semibold tracking-tight">{domain}</h2>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {error && (
        <RecoveryNotice
          title="We couldn't load this domain's skills."
          message="Try again. If this keeps happening, refresh the page."
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !error && data?.catalogEmpty && (
        // Distinct from "no skills measured" AND from a failed load. The question bank
        // publishes nothing here yet; saying "no data" would blame the student for it.
        <p
          className="text-sm text-muted-foreground"
          data-testid="catalog-empty"
        >
          There are no published questions in this domain yet, so there is
          nothing to measure here.
        </p>
      )}

      {!isLoading && !error && !data?.catalogEmpty && (
        <>
          <ul className="space-y-2" data-testid="skill-list">
            {skills.map((skill: MasterySkillNode) => (
              <li
                key={skill.skill}
                className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/80 px-4 py-3"
                data-testid="skill-row"
              >
                <span className="text-sm font-medium">{skill.skill}</span>
                <LevelPill
                  levelKey={skill.levelKey}
                  displayName={skill.displayName}
                />
              </li>
            ))}
          </ul>

          {hasUnmeasured && (
            <div className="mt-6" data-testid="panel-cta">
              <Button asChild>
                <Link href="/practice">Practise {domain}</Link>
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function MasteryPage() {
  const [, navigate] = useLocation();
  const [selected, setSelected] = useState<{
    section: MasterySection;
    domain: string;
  } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["/api/me/mastery/domains"],
    queryFn: fetchMasteryDomains,
    retry: 1,
  });

  const domains = data?.domains ?? [];
  // Derived in the render body — no useEffect for a value that is a pure function of the
  // fetched data (Coding Standards §11.4).
  const allUnmeasured =
    domains.length > 0 && domains.every((d) => d.levelKey === "unmeasured");

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.history.back()}
              className="mr-1"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Mastery
            </p>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">
            Your mastery
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            Each domain shows where your answers place you. Levels move as you
            answer more questions.
          </p>
        </header>

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {error &&
          (isEntitlementDenialError(error) ? (
            <EmptyStateCTA
              title="Mastery is locked"
              message="This account needs premium access before mastery can be displayed."
              actionLabel="View plans"
              onAction={() => navigate("/upgrade")}
            />
          ) : (
            <RecoveryNotice
              title="We couldn't load mastery data."
              message="Try again. If this keeps happening, refresh the page."
              onRetry={() => void refetch()}
            />
          ))}

        {!isLoading && !error && selected && (
          <SkillPanel
            section={selected.section}
            domain={selected.domain}
            onBack={() => setSelected(null)}
          />
        )}

        {!isLoading && !error && !selected && (
          <>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSelected({
                          section: node.section,
                          domain: node.domain,
                        })
                      }
                      data-testid="domain-open"
                      aria-label={`View skills in ${node.domain}`}
                    >
                      Skills
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            {allUnmeasured && (
              // RULE 6 again, at grid level: one CTA for the whole page when nothing has
              // been measured yet, not eight identical ones.
              <div className="mt-8" data-testid="grid-cta">
                <Button asChild>
                  <Link href="/practice">Start practising</Link>
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
