/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20 entitlement_features, Vertical-B Slice 2]
 * @implemented 2026-08-12
 *
 * plain English: student-facing score estimate card with tiered rendering.
 *
 * - no_baseline: diagnostic not completed — prompt to complete it.
 * - baseline_only: diagnostic done, unpaid — show frozen baseline + upgrade CTA.
 * - computed: paid — show live projection + baseline for comparison.
 *
 * LC-AM3-UI-001 honest-signal: never fabricate a score; discriminated union
 * guards guarantee TS narrows `estimate` to ScoreEstimate only past the guard.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { TrendingUp, Target, AlertCircle, Lock } from "lucide-react";
import {
  fetchScoreEstimate,
  getConfidenceLabel,
  getConfidenceColor,
} from "@/lib/projectionApi";
import { useLocation } from "wouter";

export function ScoreProjectionCard() {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/progress/projection"],
    queryFn: fetchScoreEstimate,
    staleTime: 5 * 60 * 1000,
  });

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
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Unable to load your score estimate right now.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Branch 0: diagnostic completed, baseline still computing ────────────
  // Owner ruling Q2, 2026-08-17. Deliberately offers no action: the student has
  // already done the only thing they can do, and the diagnostic start route
  // refuses a second attempt with 409 diagnostic_already_completed.
  if (data.estimateStatus === "baseline_pending") {
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
              Your baseline is being calculated. You have finished the
              diagnostic — your starting point will appear here shortly.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Branch 1: no diagnostic completed yet ───────────────────────────────
  if (data.estimateStatus === "no_baseline") {
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
              Your score estimate isn&apos;t available yet — complete the
              diagnostic to establish your starting point.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Branch 2: baseline exists, unpaid — frozen baseline + upgrade CTA ───
  if (data.estimateStatus === "baseline_only") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Score Estimate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="text-sm text-muted-foreground mb-1">
              Diagnostic Baseline
            </div>
            <div className="text-4xl font-bold text-primary">
              {data.baseline.composite}
            </div>
            <div className="text-sm text-muted-foreground">
              Range: {data.baseline.range.low} - {data.baseline.range.high}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Math
              </div>
              <div className="text-2xl font-semibold">{data.baseline.math}</div>
              <div className="text-xs text-muted-foreground">/ 800</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Reading & Writing
              </div>
              <div className="text-2xl font-semibold">{data.baseline.rw}</div>
              <div className="text-xs text-muted-foreground">/ 800</div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4" />
              Track your progress over time
            </div>
            <p className="text-sm text-muted-foreground">
              Upgrade to see how your score improves as you practice.
            </p>
            <Button variant="outline" size="sm" onClick={handleUpgrade}>
              View Plans
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Branch 3: computed — live projection + baseline comparison ──────────
  const { estimate, totalQuestionsAttempted } = data;

  // LC-AM3-001 honest-signal: transient edge — live projection uncomputed
  // even for paid users (mastery_constants changed, evidence gate re-evaluated).
  // Defend against null estimate.
  if (!estimate) {
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
              Your score estimate isn&apos;t available yet
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

        {data.baseline && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Diagnostic Baseline
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="font-semibold">{data.baseline.composite}</span>
              <span className="text-muted-foreground">
                ({data.baseline.math} M / {data.baseline.rw} RW)
              </span>
              {estimate.composite > data.baseline.composite && (
                <span className="text-green-600 font-medium flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />+
                  {estimate.composite - data.baseline.composite}
                </span>
              )}
            </div>
          </div>
        )}

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
