import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Brain, ArrowLeft, Target, TrendingUp, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

function getStatusColor(status: string): string {
  switch (status) {
    case "proficient": return "text-green-600 bg-green-50";
    case "improving": return "text-blue-600 bg-blue-50";
    case "weak": return "text-orange-600 bg-orange-50";
    default: return "text-gray-600 bg-gray-50";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "proficient": return "Proficient";
    case "improving": return "Improving";
    case "weak": return "Needs Work";
    default: return "Not Started";
  }
}

export default function MasteryPage() {
  const handleBack = () => {
    window.history.back();
  };

  // Fetch mastery data from the real API endpoint
  const { data, isLoading, error } = useQuery<MasteryResponse>({
    queryKey: ['/api/me/mastery/skills'],
    retry: 1,
  });

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Button variant="ghost" size="sm" onClick={handleBack} className="mr-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Brain className="h-8 w-8 text-foreground" />
            <h1 className="text-3xl font-bold text-foreground">Skill Mastery</h1>
          </div>
          <p className="text-muted-foreground">
            Track your progress across all SAT skills.
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {/* Error State */}
        {error && (
          (() => {
            const message = error instanceof Error ? error.message : "";
            const isPremiumLocked = message.includes("402") || message.includes("PREMIUM_KPI_REQUIRED");
            return isPremiumLocked ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>Mastery details are part of premium KPI access.</span>
                  <Button asChild variant="outline" size="sm">
                    <a href="/">View Upgrade Options</a>
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to load mastery data. Please try again later.
                </AlertDescription>
              </Alert>
            );
          })()
        )}

        {/* Empty State */}
        {!isLoading && !error && data && data.sections.every(s => s.avgMastery === 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                No Practice Data Yet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Start practicing to see your skill mastery progress. Complete some practice questions to build your mastery profile.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Data Display */}
        {!isLoading && !error && data && data.sections.some(s => s.avgMastery > 0) && (
          <div className="space-y-6">
            {data.sections.map((section) => (
              <Card key={section.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{section.label}</CardTitle>
                    <div className="text-sm text-muted-foreground">
                      Average Mastery: {section.avgMastery}%
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {section.domains.map((domain) => (
                      <div key={domain.id} className="border-l-2 border-primary/20 pl-4">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-semibold">{domain.label}</h3>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(domain.status)}`}>
                              {getStatusLabel(domain.status)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {domain.avgMastery}%
                            </span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                          {domain.skills.map((skill) => (
                            <div 
                              key={skill.id} 
                              className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                            >
                              <span className="truncate">{skill.label}</span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(skill.status)}`}>
                                  {skill.mastery_score}%
                                </span>
                                {skill.attempts > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {skill.correct}/{skill.attempts}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
