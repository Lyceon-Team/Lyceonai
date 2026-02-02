import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowRight, Target } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

interface WeakSkill {
  section: string;
  domain: string | null;
  skill: string;
  label: string;
  attempts: number;
  accuracy: number;
  mastery_score: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

interface WeakestResponse {
  weakest: WeakSkill[];
}

const statusColors = {
  weak: "border-l-red-500 bg-red-50",
  improving: "border-l-yellow-500 bg-yellow-50",
  proficient: "border-l-green-500 bg-green-50",
  not_started: "border-l-gray-300 bg-gray-50",
};

export function FocusAreasCard() {
  const { data, isLoading, error } = useQuery<WeakestResponse>({
    queryKey: ["/api/me/mastery/weakest"],
    queryFn: async () => {
      const response = await fetch("/api/me/mastery/weakest", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            Current Focus Areas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data || data.weakest.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            Current Focus Areas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-3">
              Complete some practice questions to identify your focus areas.
            </p>
            <Link href="/practice">
              <Button size="sm" variant="outline">
                Start Practicing
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const topWeakest = data.weakest.slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            Current Focus Areas
          </CardTitle>
          <Link href="/mastery">
            <Button variant="ghost" size="sm" className="text-xs">
              View All <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {topWeakest.map((skill, index) => (
          <div
            key={`${skill.section}-${skill.skill}`}
            className={cn(
              "flex items-center justify-between p-3 rounded-lg border-l-4",
              statusColors[skill.status]
            )}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className={cn(
                  "h-4 w-4 mt-0.5 flex-shrink-0",
                  skill.status === "weak" && "text-red-500",
                  skill.status === "improving" && "text-yellow-500"
                )}
              />
              <div>
                <div className="text-sm font-medium text-foreground">
                  {skill.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {skill.section === "math" ? "Math" : "Reading & Writing"}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-foreground">
                {skill.mastery_score}%
              </div>
              <div className="text-xs text-muted-foreground">
                {skill.accuracy}% accuracy
              </div>
            </div>
          </div>
        ))}

        <div className="pt-2">
          <Link href="/calendar">
            <Button size="sm" className="w-full">
              Plan Practice Session
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
