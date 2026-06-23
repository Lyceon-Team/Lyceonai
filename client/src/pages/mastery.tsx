import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ArrowLeft, Target, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Link, useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { isEntitlementDenialError } from "@/lib/api-error";
import { EmptyStateCTA } from "@/components/feedback/EmptyStateCTA";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";

type MasteryTier = "not_started" | "weak" | "improving" | "proficient";

interface SkillNode {
  skill: string;
  label: string;
  masteryLevel: number | null;
  tier: MasteryTier;
  computedAt: string | null;
}

interface DomainNode {
  domain: string;
  label: string;
  masteryLevel: number | null;
  tier: MasteryTier;
  computedAt: string | null;
  skills: SkillNode[];
}

interface SectionNode {
  section: string;
  label: string;
  domains: DomainNode[];
}

interface MasteryResponse {
  sections: SectionNode[];
}

function getTierTone(tier: MasteryTier): string {
  switch (tier) {
    case "proficient":
      return "bg-emerald-100 text-emerald-700";
    case "improving":
      return "bg-blue-100 text-blue-700";
    case "weak":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getTierLabel(tier: MasteryTier): string {
  switch (tier) {
    case "proficient":
      return "Proficient";
    case "improving":
      return "Improving";
    case "weak":
      return "Needs Focus";
    default:
      return "Not Started";
  }
}

function tierToBarPercent(tier: MasteryTier): number {
  switch (tier) {
    case "proficient":
      return 100;
    case "improving":
      return 60;
    case "weak":
      return 25;
    default:
      return 0;
  }
}

export default function MasteryPage() {
  const [, navigate] = useLocation();

  const handleBack = () => {
    window.history.back();
  };

  const handleUpgrade = () => {
    navigate("/upgrade");
  };

  const { data, isLoading, error, refetch } = useQuery<MasteryResponse>({
    queryKey: ["/api/me/mastery/skills"],
    retry: 1,
  });

  const sections = data?.sections ?? [];
  const hasAnyMastery = sections.some((section) =>
    section.domains.some((d) => d.tier !== "not_started"),
  );
  const domains = useMemo(
    () =>
      sections.flatMap((section) =>
        section.domains.map((domain) => ({
          sectionLabel: section.label,
          ...domain,
        })),
      ),
    [sections],
  );
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  useEffect(() => {
    if (domains.length === 0) {
      setSelectedDomainId(null);
      return;
    }

    if (
      !selectedDomainId ||
      !domains.some((domain) => domain.domain === selectedDomainId)
    ) {
      setSelectedDomainId(domains[0].domain);
    }
  }, [domains, selectedDomainId]);

  const selectedDomain =
    domains.find((domain) => domain.domain === selectedDomainId) ?? null;

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="mr-1"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Mastery & Insights
            </p>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">
            Domain Mastery
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            Skill and domain tiers are computed from your practice evidence.
            Tiers update as you answer more questions.
          </p>
        </header>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        )}

        {error &&
          (() => {
            const isPremiumLocked = isEntitlementDenialError(error);

            if (isPremiumLocked) {
              return (
                <EmptyStateCTA
                  title="Mastery analytics are locked"
                  message="This account needs premium KPI access before mastery insights can be displayed."
                  actionLabel="View plans"
                  onAction={handleUpgrade}
                />
              );
            }

            return (
              <RecoveryNotice
                title="We couldn't load mastery data."
                message="Try again. If this keeps happening, refresh the page."
                onRetry={() => void refetch()}
              />
            );
          })()}

        {!isLoading && !error && !hasAnyMastery && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                No Mastery Data Yet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Start practice sessions to generate domain-level mastery
                evidence.
              </p>
              <Button asChild className="mt-4">
                <Link href="/practice">Start Practice</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && hasAnyMastery && (
          <div className="space-y-8">
            <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {sections.map((section) => (
                <Card
                  key={section.section}
                  className="bg-card/80 border-border/50"
                >
                  <CardHeader>
                    <CardDescription className="uppercase tracking-[0.2em] text-[10px]">
                      {section.label}
                    </CardDescription>
                    <CardTitle className="text-2xl tracking-tight">
                      {section.domains.length} domains
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {section.domains.map((d) => (
                        <Badge key={d.domain} className={getTierTone(d.tier)}>
                          {d.label}: {getTierLabel(d.tier)}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>

            {sections.map((section) => (
              <section key={`domains-${section.section}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {section.label} Domains
                  </h2>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Tier breakdown
                  </p>
                </div>
                <Accordion
                  type="single"
                  collapsible
                  value={selectedDomainId ?? undefined}
                  onValueChange={(value) => setSelectedDomainId(value || null)}
                  className="space-y-3"
                >
                  {section.domains.map((domain) => (
                    <AccordionItem
                      key={domain.domain}
                      value={domain.domain}
                      className="rounded-lg border border-border/60 bg-card/80 px-4"
                    >
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex-1 text-left">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <p className="text-sm font-semibold leading-snug">
                              {domain.label}
                            </p>
                            <Badge className={getTierTone(domain.tier)}>
                              {getTierLabel(domain.tier)}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <span className="text-xs text-muted-foreground">
                              {domain.skills.length} skills
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{
                                width: `${tierToBarPercent(domain.tier)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-2">
                          {domain.skills.map((skill) => (
                            <div
                              key={skill.skill}
                              className="rounded-lg border border-border/60 bg-secondary/35 p-3"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-medium">
                                  {skill.label}
                                </p>
                                <Badge
                                  variant="outline"
                                  className={getTierTone(skill.tier)}
                                >
                                  {getTierLabel(skill.tier)}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            ))}

            {selectedDomain && (
              <section>
                <Card className="bg-card/90 border-border/60">
                  <CardHeader>
                    <CardDescription className="uppercase tracking-[0.2em] text-[10px]">
                      Selected Domain Insight
                    </CardDescription>
                    <CardTitle className="text-2xl tracking-tight">
                      {selectedDomain.label}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Section: {selectedDomain.sectionLabel} · Tier:{" "}
                      {getTierLabel(selectedDomain.tier)}
                    </p>
                  </CardHeader>
                  <CardContent>
                    {selectedDomain.skills.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No skills are currently mapped to this domain.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {selectedDomain.skills
                          .slice()
                          .sort((a, b) => {
                            const tierOrder: Record<MasteryTier, number> = {
                              not_started: 0,
                              weak: 1,
                              improving: 2,
                              proficient: 3,
                            };
                            return tierOrder[a.tier] - tierOrder[b.tier];
                          })
                          .map((skill) => (
                            <div
                              key={skill.skill}
                              className="rounded-lg border border-border/60 bg-secondary/40 p-3"
                            >
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium">
                                  {skill.label}
                                </p>
                                <Badge
                                  variant="outline"
                                  className={getTierTone(skill.tier)}
                                >
                                  {getTierLabel(skill.tier)}
                                </Badge>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            <div className="flex justify-end">
              <Button asChild variant="outline">
                <Link href="/practice">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Continue Practice
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
