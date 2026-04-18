import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/app-shell";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  Calendar,
  FileText,
  MessageCircle,
  Play,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  getCalendarMonth,
  getCalendarProfile,
  type StudyPlanDay,
  type StudyProfile,
} from "@/lib/calendarApi";
import {
  fetchScoreEstimate,
  getConfidenceLabel,
  type EstimateResponse,
} from "@/lib/projectionApi";
import { startSubscriptionCheckout } from "@/lib/billing-client";
import { useToast } from "@/hooks/use-toast";

interface KpiExplanation {
  ruleId: string;
  whatThisMeans: string;
  whyThisChanged: string;
  whatToDoNext: string;
}

interface KpiMetric {
  id: string;
  label: string;
  kind: "official" | "weighted" | "diagnostic";
  unit: "count" | "percent" | "minutes" | "seconds" | "score";
  value: number | null;
  explanation: KpiExplanation;
}

interface KpiResponse {
  timezone: string;
  week: {
    practiceSessions: number;
    questionsSolved: number;
    accuracy: number;
    explanations?: Record<string, KpiExplanation>;
  };
  recency: {
    window: number;
    totalAttempts: number;
    accuracy: number;
    avgSecondsPerQuestion: number;
    explanations?: Record<string, KpiExplanation>;
  } | null;
  metrics?: KpiMetric[];
  gating?: {
    historicalTrends?: {
      allowed: boolean;
      requiredPlan: "paid";
      reason: string;
    };
  };
}

function ScoreSnapshotRow({
  label,
  value,
  max,
}: {
  label: string;
  value: number | null;
  max: number;
}) {
  if (value === null) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">No data</span>
        </div>
        <div className="h-2 rounded-full bg-muted/60" />
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm gap-3">
        <span className="font-medium truncate">{label}</span>
        <span className="font-semibold shrink-0">{value.toLocaleString()}</span>
      </div>
      <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function LyceonDashboard() {
  const { user } = useSupabaseAuth();
  const { toast } = useToast();
  const [upgradePending, setUpgradePending] = useState(false);

  const { data: profileData, error: profileError } = useQuery<StudyProfile | null>({
    queryKey: ["calendar-profile"],
    queryFn: getCalendarProfile,
    enabled: !!user,
    staleTime: 60000,
  });

  const userTimezone = profileData?.timezone || "America/Chicago";
  const nowInUserTz = DateTime.now().setZone(userTimezone);
  const todayISO = nowInUserTz.toISODate()!;
  const nextWeekISO = nowInUserTz.plus({ days: 7 }).toISODate()!;

  const { data: calendarData, isLoading: calendarLoading, error: calendarError } = useQuery({
    queryKey: ["calendar-month", userTimezone],
    queryFn: async () => {
      const start = nowInUserTz.startOf("month").toISODate() ?? nowInUserTz.toISODate()!;
      const end = nowInUserTz.endOf("month").toISODate() ?? nowInUserTz.toISODate()!;
      return getCalendarMonth(start, end);
    },
    enabled: !!user,
    refetchInterval: 60000,
  });

  const { data: kpiData, isLoading: kpiLoading, error: kpiError } = useQuery<KpiResponse>({
    queryKey: ["/api/progress/kpis"],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const {
    data: estimateData,
    isLoading: estimateLoading,
    error: estimateError,
  } = useQuery<EstimateResponse>({
    queryKey: ["/api/progress/projection"],
    queryFn: fetchScoreEstimate,
    enabled: !!user,
    staleTime: 60000,
  });

  const estimateErrorMessage = estimateError instanceof Error ? estimateError.message : "";
  const estimatePremiumLocked =
    estimateErrorMessage.includes("402") || estimateErrorMessage.includes("PREMIUM_REQUIRED");

  const todayPlan: StudyPlanDay | undefined = useMemo(
    () => calendarData?.days?.find((day) => day.day_date === todayISO),
    [calendarData?.days, todayISO],
  );

  const upcomingMilestones = useMemo(
    () =>
      (calendarData?.days ?? []).filter(
        (day) => day.day_date >= todayISO && day.day_date <= nextWeekISO && day.planned_minutes > 0,
      ).length,
    [calendarData?.days, nextWeekISO, todayISO],
  );

  const metricById = useMemo(
    () => new Map((kpiData?.metrics ?? []).map((metric) => [metric.id, metric])),
    [kpiData?.metrics],
  );

  const weekMinutes = Number(metricById.get("week_minutes")?.value ?? 0);
  const weekStudyHours = (weekMinutes / 60).toFixed(1);
  const weekAccuracy = Number(kpiData?.week?.accuracy ?? 0);
  const weekQuestions = Number(kpiData?.week?.questionsSolved ?? 0);
  const weekSessions = Number(kpiData?.week?.practiceSessions ?? 0);
  const weekMinutesChange =
    metricById.get("week_minutes")?.explanation?.whyThisChanged ?? "Current 7-day local window.";
  const weekAccuracyChange =
    metricById.get("week_accuracy")?.explanation?.whyThisChanged ?? "Current 7-day local window.";

  const baselineScore = profileData?.baseline_score ?? null;
  const targetScore = profileData?.target_score ?? null;
  const examDate = profileData?.exam_date ? DateTime.fromISO(profileData.exam_date).setZone(userTimezone) : null;
  const streakCurrent = calendarData?.streak?.current ?? 0;

  const getGreeting = () => {
    const hour = nowInUserTz.hour;
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const nextMilestone = (() => {
    if (todayPlan && todayPlan.planned_minutes > 0) {
      return `Complete today's ${todayPlan.planned_minutes}-minute study plan.`;
    }
    if (examDate?.isValid) {
      return `Stay on track for your ${examDate.toFormat("MMM d")} SAT date.`;
    }
    return "Complete one focused SAT practice block today.";
  })();

  const handleUpgradeToPremium = async () => {
    if (upgradePending) return;
    setUpgradePending(true);
    try {
      await startSubscriptionCheckout('monthly');
    } catch (error: any) {
      toast({
        title: 'Unable to start checkout',
        description: error?.message || 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setUpgradePending(false);
    }
  };

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-2 tracking-tight" data-testid="page-title">
            Welcome back, {user?.display_name || "Student"}
          </h1>
          <p className="text-muted-foreground text-base">
            {getGreeting()}. Your next milestone: <span className="text-foreground font-medium">{nextMilestone}</span>
          </p>
        </div>

        {(profileError || calendarError || kpiError) && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>
              Some dashboard data failed to load. Please refresh the page or try again later.
            </AlertDescription>
          </Alert>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-10">
          <Card className="lg:col-span-8 border-border/40 bg-card">
            <CardContent className="p-6 sm:p-8">
              <div className="space-y-8">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold">
                    Weekly Progress Summary
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-8">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-3">
                      Study Hours (7d)
                    </p>
                    {kpiLoading ? (
                      <Skeleton className="h-10 w-28 mb-2" />
                    ) : (
                      <p className="text-5xl font-semibold text-foreground leading-none">{weekStudyHours}</p>
                    )}
                    <p className="text-sm text-muted-foreground mt-3">{weekMinutesChange}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-3">
                      Accuracy (7d)
                    </p>
                    {kpiLoading ? (
                      <Skeleton className="h-10 w-28 mb-2" />
                    ) : (
                      <p className="text-5xl font-semibold text-foreground leading-none">
                        {weekQuestions > 0 ? `${weekAccuracy}%` : "-"}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-3">{weekAccuracyChange}</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-border/50 flex flex-wrap gap-3">
                  <Button asChild data-testid="button-dashboard-view-details">
                    <Link href="/calendar">View Details</Link>
                  </Button>
                  <Button asChild variant="secondary" data-testid="button-dashboard-set-goal">
                    <Link href="/calendar">Set Goal</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4 border-0 bg-primary text-primary-foreground">
            <CardContent className="p-6 sm:p-8 h-full flex flex-col justify-between gap-6">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] font-semibold text-primary-foreground/80">
                  Score Estimate
                </p>
                <p className="text-sm text-primary-foreground/70 mt-2">
                  Based on weighted mastery evidence from live runtime data.
                </p>
              </div>

              {estimateLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-48 bg-primary-foreground/20" />
                  <Skeleton className="h-5 w-32 bg-primary-foreground/20" />
                </div>
              ) : estimatePremiumLocked ? (
                <div className="space-y-4">
                  <p className="text-sm text-primary-foreground/80">
                    Score estimate is a premium KPI surface.
                  </p>
                  <Button variant="secondary" className="w-fit" onClick={handleUpgradeToPremium} disabled={upgradePending}>
                    {upgradePending ? "Starting checkout..." : "Upgrade to Premium"}
                  </Button>
                </div>
              ) : estimateData ? (
                <div className="space-y-4">
                  <p className="text-5xl font-semibold leading-none tracking-tight">
                    {estimateData.estimate.range.low}-{estimateData.estimate.range.high}
                  </p>
                  <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-primary-foreground/15 text-primary-foreground">
                    {getConfidenceLabel(estimateData.estimate.confidence)} estimate confidence
                  </div>
                  <p className="text-xs text-primary-foreground/80">
                    Based on {estimateData.totalQuestionsAttempted} attempted questions.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-primary-foreground/80">
                    Start practicing to unlock a score estimate.
                  </p>
                  <Button asChild variant="secondary" className="w-fit">
                    <Link href="/practice">Start Practice</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-10">
          <Link href="/practice">
            <a className="block rounded-xl border border-border/40 bg-card hover:bg-card/90 transition-colors p-6 min-h-[190px]">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-6">
                <Play className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight mb-1">Practice</h2>
              <p className="text-sm text-muted-foreground">
                {todayPlan?.planned_minutes ? `${todayPlan.planned_minutes} minutes planned today` : "Start a focused SAT block"}
              </p>
            </a>
          </Link>

          <Link href="/full-test">
            <a className="block rounded-xl border border-border/40 bg-card hover:bg-card/90 transition-colors p-6 min-h-[190px]">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-6">
                <FileText className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight mb-1">Full-Length Exam</h2>
              <p className="text-sm text-muted-foreground">Run a timed SAT simulation.</p>
            </a>
          </Link>

          <Link href="/review-errors">
            <a className="block rounded-xl border border-border/40 bg-card hover:bg-card/90 transition-colors p-6 min-h-[190px]">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-6">
                <Target className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight mb-1">Review Errors</h2>
              <p className="text-sm text-muted-foreground">
                {weekQuestions > 0 ? "Analyze misses from your recent attempts." : "Complete practice first to populate your error queue."}
              </p>
            </a>
          </Link>

          <Link href="/calendar">
            <a className="block rounded-xl border border-border/40 bg-card hover:bg-card/90 transition-colors p-6 min-h-[190px]">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-6">
                <Calendar className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight mb-1">Study Plan</h2>
              <p className="text-sm text-muted-foreground">
                {calendarLoading
                  ? "Loading schedule..."
                  : `${upcomingMilestones} planned study day${upcomingMilestones === 1 ? "" : "s"} in the next 7 days`}
              </p>
            </a>
          </Link>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Card className="lg:col-span-7 border-border/40 bg-card">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight">Score Trend Analysis</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Section breakdown from live estimate data.
                  </p>
                </div>
                <Button asChild variant="ghost" className="w-fit px-0">
                  <Link href="/mastery">
                    View Full Breakdown
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="rounded-lg bg-muted/45 p-4 text-sm text-muted-foreground">
                Historical score trend points are not currently exposed by this runtime contract. This card shows live snapshot values only.
              </div>

              {estimateLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : estimatePremiumLocked ? (
                <div className="rounded-lg bg-muted/45 p-5 space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Detailed score breakdown is locked behind paid KPI access.
                  </p>
                  <Button variant="outline" onClick={handleUpgradeToPremium} disabled={upgradePending}>
                    {upgradePending ? "Starting checkout..." : "Upgrade to Premium"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <ScoreSnapshotRow
                    label="Composite"
                    value={estimateData?.estimate.composite ?? null}
                    max={1600}
                  />
                  <ScoreSnapshotRow
                    label="Reading & Writing"
                    value={estimateData?.estimate.rw ?? null}
                    max={800}
                  />
                  <ScoreSnapshotRow
                    label="Math"
                    value={estimateData?.estimate.math ?? null}
                    max={800}
                  />
                </div>
              )}

              <div className="pt-4 border-t border-border/50 grid sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg bg-muted/35 p-3">
                  <p className="text-muted-foreground">Current Baseline</p>
                  <p className="font-semibold text-lg mt-1">{baselineScore ?? "-"}</p>
                </div>
                <div className="rounded-lg bg-muted/35 p-3">
                  <p className="text-muted-foreground">Target Score</p>
                  <p className="font-semibold text-lg mt-1">{targetScore ?? "-"}</p>
                </div>
                <div className="rounded-lg bg-muted/35 p-3">
                  <p className="text-muted-foreground">Current Streak</p>
                  <p className="font-semibold text-lg mt-1">{streakCurrent} day{streakCurrent === 1 ? "" : "s"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-5 border-border/40 bg-card">
            <CardContent className="p-6 sm:p-8 space-y-6 h-full">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-3xl font-semibold tracking-tight">Personalized Recommendations</h2>
                <span className="text-[10px] tracking-[0.18em] uppercase font-semibold text-muted-foreground bg-muted rounded-full px-2 py-1">
                  Alpha
                </span>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                The Stitch mock shows placeholder recommendation cards. In Lyceon runtime, this feed is still rebuilding against live KPI truth sources, so we show transparent status instead of fake suggestions.
              </p>

              <div className="rounded-lg bg-muted/45 p-4 space-y-2">
                <p className="text-sm font-medium">Current live signals</p>
                <p className="text-sm text-muted-foreground">{weekSessions} sessions in the last 7 days.</p>
                <p className="text-sm text-muted-foreground">
                  {weekQuestions} questions solved this week{weekQuestions > 0 ? ` at ${weekAccuracy}% accuracy` : "."}
                </p>
                <p className="text-sm text-muted-foreground">
                  {examDate?.isValid ? `Exam date set for ${examDate.toFormat("MMM d, yyyy")}.` : "Exam date not set yet."}
                </p>
              </div>

              <div className="rounded-lg bg-card border border-border/60 p-4">
                <p className="text-sm font-medium italic text-foreground">"Rebuilding from live data"</p>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mt-2">
                  Recommendation model wiring in progress
                </p>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button asChild data-testid="button-dashboard-ask-lisa">
                  <Link href="/chat">
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Ask Lisa
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/calendar">
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Open Study Plan
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
