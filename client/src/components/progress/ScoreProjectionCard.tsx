import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { TrendingUp, Target, AlertCircle } from "lucide-react";
import {
  fetchScoreEstimate,
  getConfidenceLabel,
  getConfidenceColor,
} from "@/lib/projectionApi";
import { useLocation } from "wouter";
import { isEntitlementDenialError } from "@/lib/api-error";

export function ScoreProjectionCard() {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/progress/projection"],
    queryFn: fetchScoreEstimate,
    staleTime: 5 * 60 * 1000,
  });
  const isPremiumLocked = isEntitlementDenialError(error);

  const handleUpgrade = () => {
    navigate("/upgrade");
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Score Estimate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Score Estimate
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isPremiumLocked ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span>Score estimate is a premium KPI feature.</span>
              </div>
              <Button variant="outline" size="sm" onClick={handleUpgrade}>
                View Plans
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>Start practicing to see your score estimate</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // LC-AM3-UI-001 honest-signal: when the estimate is uncomputed (05C projections deferred /
  // not yet generated), render an explicit not-yet-available state — never a fake number, never a
  // crash. The discriminated union narrows `estimate` to ScoreEstimate only past this guard.
  const { estimate, totalQuestionsAttempted } = data;
  if (data.estimateStatus !== "computed" || !estimate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Score Estimate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>
              Your score estimate isn’t available yet
              {totalQuestionsAttempted > 0
                ? " — it appears once enough scored evidence accumulates."
                : " — start practicing to generate it."}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }
  const scoreProgress = ((estimate.composite - 400) / 1200) * 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Score Estimate
          </span>
          <span
            className={`text-sm font-normal ${getConfidenceColor(estimate.confidence)}`}
          >
            {getConfidenceLabel(estimate.confidence)} Estimate Confidence
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <div className="text-4xl font-bold text-primary">
            {estimate.composite}
          </div>
          <div className="text-sm text-muted-foreground">
            Estimate Range: {estimate.range.low} - {estimate.range.high}
          </div>
        </div>

        <Progress value={scoreProgress} className="h-2" />

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Math
            </div>
            <div className="text-2xl font-semibold">{estimate.math}</div>
            <div className="text-xs text-muted-foreground">/ 800</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Reading & Writing
            </div>
            <div className="text-2xl font-semibold">{estimate.rw}</div>
            <div className="text-xs text-muted-foreground">/ 800</div>
          </div>
        </div>

        {totalQuestionsAttempted > 0 && (
          <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            Based on {totalQuestionsAttempted} questions
          </div>
        )}
      </CardContent>
    </Card>
  );
}
