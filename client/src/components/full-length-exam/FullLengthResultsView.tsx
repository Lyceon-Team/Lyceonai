import { useMemo, type ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Share2, Trophy } from "lucide-react";

interface SectionModuleScore {
  correct: number;
  total: number;
}

interface SectionScoreSummary {
  module1: SectionModuleScore;
  module2: SectionModuleScore;
  totalCorrect: number;
  totalQuestions: number;
}

interface ScoreBreakdown {
  rw: number;
  math: number;
  total: number;
}

interface ExplainedKpiMetric {
  id: string;
  label: string;
  kind: "official" | "weighted" | "diagnostic";
  unit: "count" | "percent" | "minutes" | "seconds" | "score";
  value: number | null;
  explanation?: {
    ruleId?: string;
    whatThisMeans?: string;
    whyThisChanged?: string;
    whatToDoNext?: string;
  };
}

export interface FullLengthResultsData {
  sessionId: string;
  completedAt?: string | Date | null;
  rwScore?: SectionScoreSummary;
  mathScore?: SectionScoreSummary;
  overallScore?: {
    totalCorrect: number;
    totalQuestions: number;
    percentageCorrect: number;
    scaledTotal?: number | null;
  };
  scaledScore?: ScoreBreakdown;
  estimatedScore?: ScoreBreakdown;
  kpis?: ExplainedKpiMetric[];
}

interface FullLengthResultsViewProps {
  data: FullLengthResultsData;
  title?: string;
  description?: string;
  shareLabel?: string;
  shareEnabled?: boolean;
  actions?: ReactNode;
}

function formatKpiValue(metric: ExplainedKpiMetric): string {
  if (metric.value == null) {
    return "No data";
  }

  if (metric.unit === "percent") {
    return `${metric.value}%`;
  }

  if (metric.unit === "minutes") {
    return `${metric.value} min`;
  }

  if (metric.unit === "seconds") {
    return `${metric.value}s`;
  }

  return `${metric.value}`;
}

export default function FullLengthResultsView({
  data,
  title = "Exam Results",
  description = "Results below reflect completed runtime session data only.",
  shareLabel = "Share Results",
  shareEnabled = false,
  actions,
}: FullLengthResultsViewProps) {
  const { toast } = useToast();

  const scaledTotal =
    data.scaledScore?.total ??
    data.overallScore?.scaledTotal ??
    data.estimatedScore?.total ??
    null;

  const scoreSummary = useMemo(() => {
    if (data.overallScore) {
      return {
        headline: `${data.overallScore.percentageCorrect.toFixed(1)}%`,
        detail: `${data.overallScore.totalCorrect} / ${data.overallScore.totalQuestions} correct`,
      };
    }

    if (scaledTotal !== null) {
      return {
        headline: scaledTotal.toLocaleString(),
        detail: "Estimated scaled total score",
      };
    }

    return {
      headline: "No score",
      detail: "No completed score payload available",
    };
  }, [data.overallScore, scaledTotal]);

  const shareText = useMemo(() => {
    if (data.overallScore) {
      return `I completed a full-length SAT run on Lyceon: ${data.overallScore.totalCorrect}/${data.overallScore.totalQuestions} correct (${data.overallScore.percentageCorrect.toFixed(1)}%).`;
    }
    if (scaledTotal !== null) {
      return `I reviewed a Lyceon full-length SAT report with an estimated total score of ${scaledTotal}.`;
    }
    return null;
  }, [data.overallScore, scaledTotal]);

  const handleShare = async () => {
    if (!shareText) {
      toast({
        title: "Sharing unavailable",
        description: "No report summary is available for sharing.",
      });
      return;
    }

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title: "Lyceon SAT Results",
          text: shareText,
        });
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        toast({
          title: "Results copied",
          description: "Your report summary was copied to the clipboard.",
        });
        return;
      }

      toast({
        title: "Sharing unavailable",
        description: "Your browser does not support native share or clipboard.",
      });
    } catch (error) {
      const maybeAbort = error as { name?: string };
      if (maybeAbort?.name === "AbortError") {
        return;
      }
      toast({
        title: "Unable to share",
        description: "Please try again.",
      });
    }
  };

  const hasStudentSectionScores = Boolean(data.rwScore && data.mathScore);
  const kpis = data.kpis ?? [];

  return (
    <Card className="bg-card/90 border-border/60">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">Runtime-backed report</p>
            <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">{description}</p>
          </div>
          <Trophy className="h-8 w-8 text-primary/70 shrink-0 mt-1" />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Overall</p>
            <p className="text-5xl font-semibold leading-none tracking-tight">{scoreSummary.headline}</p>
            <p className="text-sm text-muted-foreground mt-3">{scoreSummary.detail}</p>
            <p className="text-xs text-muted-foreground mt-2">Session ID: {data.sessionId}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {shareEnabled && (
              <Button variant="outline" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" />
                {shareLabel}
              </Button>
            )}
            {actions}
          </div>
        </div>

        {hasStudentSectionScores && (
          <div className="grid md:grid-cols-2 gap-5">
            <div className="rounded-xl bg-secondary/50 p-5">
              <h3 className="font-semibold mb-4">Reading & Writing</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Module 1</span>
                  <span className="font-medium">
                    {data.rwScore?.module1.correct} / {data.rwScore?.module1.total}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Module 2</span>
                  <span className="font-medium">
                    {data.rwScore?.module2.correct} / {data.rwScore?.module2.total}
                  </span>
                </div>
                <div className="flex justify-between font-semibold pt-2 border-t border-border/50">
                  <span>Total</span>
                  <span>
                    {data.rwScore?.totalCorrect} / {data.rwScore?.totalQuestions}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-secondary/50 p-5">
              <h3 className="font-semibold mb-4">Math</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Module 1</span>
                  <span className="font-medium">
                    {data.mathScore?.module1.correct} / {data.mathScore?.module1.total}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Module 2</span>
                  <span className="font-medium">
                    {data.mathScore?.module2.correct} / {data.mathScore?.module2.total}
                  </span>
                </div>
                <div className="flex justify-between font-semibold pt-2 border-t border-border/50">
                  <span>Total</span>
                  <span>
                    {data.mathScore?.totalCorrect} / {data.mathScore?.totalQuestions}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {!hasStudentSectionScores && (
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 text-sm text-muted-foreground">
            Section-level raw counts are not present in this estimate payload.
          </div>
        )}

        {kpis.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">KPI Snapshot</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {kpis.slice(0, 6).map((metric) => (
                <div key={metric.id} className="rounded-lg border border-border/50 bg-secondary/40 p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-sm font-medium">{metric.label}</p>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                      {metric.kind}
                    </Badge>
                  </div>
                  <p className="text-lg font-semibold">{formatKpiValue(metric)}</p>
                  {metric.explanation?.whatThisMeans && (
                    <p className="text-xs text-muted-foreground mt-2">{metric.explanation.whatThisMeans}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
