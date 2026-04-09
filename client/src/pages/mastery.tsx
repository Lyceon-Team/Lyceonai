import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, Target, AlertCircle, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Link } from "wouter";
import { useEffect, useMemo, useState } from "react";

interface SkillNode {
  id: string;
  label: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

interface DomainNode {
  id: string;
  label: string;
  skills: SkillNode[];
  avgMastery: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

interface SectionNode {
  id: string;
  label: string;
  domains: DomainNode[];
  avgMastery: number;
}

interface MasteryResponse {
  sections: SectionNode[];
}

function getStatusTone(status: string): string {
  switch (status) {
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

function getStatusLabel(status: string): string {
  switch (status) {
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

export default function MasteryPage() {
  const handleBack = () => {
    window.history.back();
  };

  const { data, isLoading, error } = useQuery<MasteryResponse>({
    queryKey: ["/api/me/mastery/skills"],
    retry: 1,
  });

  const sections = data?.sections ?? [];
  const hasAnyMastery = sections.some((section) => section.avgMastery > 0);
  const domains = useMemo(
    () => sections.flatMap((section) => section.domains.map((domain) => ({ sectionLabel: section.label, ...domain }))),
    [sections],
  );
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  useEffect(() => {
    if (domains.length === 0) {
      setSelectedDomainId(null);
      return;
    }

    if (!selectedDomainId || !domains.some((domain) => domain.id === selectedDomainId)) {
      setSelectedDomainId(domains[0].id);
    }
  }, [domains, selectedDomainId]);

  const selectedDomain = domains.find((domain) => domain.id === selectedDomainId) ?? null;

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <Button variant="ghost" size="sm" onClick={handleBack} className="mr-1">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mastery & Insights</p>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">Domain Mastery</h1>
          <p className="text-muted-foreground max-w-3xl">All scores and status badges below come from live mastery runtime data. No projected placeholders are shown.</p>
        </header>

        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        )}

        {error && (() => {
          const message = error instanceof Error ? error.message : "";
          const isPremiumLocked = message.includes("402") || message.includes("PREMIUM_REQUIRED");

          if (isPremiumLocked) {
            return (
              <Card className="bg-primary-container text-primary-foreground border-transparent">
                <CardContent className="pt-6">
                  <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70 mb-3">Premium Insight</p>
                  <h2 className="text-2xl font-bold mb-2">Mastery analytics are locked</h2>
                  <p className="text-sm text-primary-foreground/85 mb-5">This account needs premium KPI access before `/api/me/mastery/skills` can be displayed in the dashboard.</p>
                  <Button asChild variant="secondary" size="sm">
                    <a href="/">View Upgrade Options</a>
                  </Button>
                </CardContent>
              </Card>
            );
          }

          return (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Failed to load mastery data. Please try again later.</AlertDescription>
            </Alert>
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
              <p className="text-muted-foreground">Start practice sessions to generate domain-level mastery evidence.</p>
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
                <Card key={section.id} className="bg-card/80 border-border/50">
                  <CardHeader>
                    <CardDescription className="uppercase tracking-[0.2em] text-[10px]">{section.label}</CardDescription>
                    <CardTitle className="text-4xl tracking-tight">{section.avgMastery}%</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-2 w-full rounded-full bg-secondary/60 overflow-hidden mb-3">
                      <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, section.avgMastery))}%` }} />
                    </div>
                    <p className="text-sm text-muted-foreground">{section.domains.length} domains tracked</p>
                  </CardContent>
                </Card>
              ))}
            </section>

            {sections.map((section) => (
              <section key={`domains-${section.id}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold tracking-tight">{section.label} Domains</h2>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Live mastery breakdown</p>
                </div>
                <Accordion
                  type="single"
                  collapsible
                  value={selectedDomainId ?? undefined}
                  onValueChange={(value) => setSelectedDomainId(value || null)}
                  className="space-y-3"
                >
                  {section.domains.map((domain) => (
                    <AccordionItem key={domain.id} value={domain.id} className="rounded-lg border border-border/60 bg-card/80 px-4">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex-1 text-left">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <p className="text-sm font-semibold leading-snug">{domain.label}</p>
                            <span className="text-sm font-semibold">{domain.avgMastery}%</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <Badge className={getStatusTone(domain.status)}>{getStatusLabel(domain.status)}</Badge>
                            <span className="text-xs text-muted-foreground">{domain.skills.length} skills</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, domain.avgMastery))}%` }} />
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-2">
                          {domain.skills.map((skill) => (
                            <div key={skill.id} className="rounded-lg border border-border/60 bg-secondary/35 p-3">
                              <p className="text-sm font-medium mb-1">{skill.label}</p>
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{skill.correct}/{skill.attempts} correct</span>
                                <span>{skill.mastery_score}% mastery</span>
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
                    <CardDescription className="uppercase tracking-[0.2em] text-[10px]">Selected Domain Insight</CardDescription>
                    <CardTitle className="text-2xl tracking-tight">{selectedDomain.label}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Section: {selectedDomain.sectionLabel} · Current domain mastery: {selectedDomain.avgMastery}%
                    </p>
                  </CardHeader>
                  <CardContent>
                    {selectedDomain.skills.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No skills are currently mapped to this domain.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {selectedDomain.skills
                          .slice()
                          .sort((a, b) => {
                            if (a.attempts === 0 && b.attempts > 0) return 1;
                            if (b.attempts === 0 && a.attempts > 0) return -1;
                            return a.mastery_score - b.mastery_score;
                          })
                          .map((skill) => (
                          <div key={skill.id} className="rounded-lg border border-border/60 bg-secondary/40 p-3">
                            <p className="text-sm font-medium mb-1">{skill.label}</p>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{skill.correct}/{skill.attempts} correct</span>
                              <span>{skill.mastery_score}% mastery</span>
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
