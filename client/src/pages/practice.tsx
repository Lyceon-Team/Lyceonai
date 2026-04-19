import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen,
  Calculator,
  Clock,
  Target,
  Flame,
  TrendingUp,
  Award,
  ArrowRight,
  Timer,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useMemo, useState } from "react";
import { getCalendarMonth } from "@/lib/calendarApi";
import { normalizePracticeTopicDomains, type RawPracticeTopicDomain } from "@/lib/practice-topic-taxonomy";
import { appendPracticeDuration } from "@/lib/practice-duration";
import { DateTime } from "luxon";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";

interface QuestionStats {
  total: number;
  math: number;
  reading_writing: number;
  byDifficulty: {
    easy: number;
    medium: number;
    hard: number;
  };
  recentlyAdded: number;
}

interface PracticeTopics {
  sections?: Array<{
    section: string;
    label: string;
    domains?: RawPracticeTopicDomain[];
  }>;
}

interface KpiResponse {
  timezone: string;
  week: {
    practiceSessions: number;
    questionsSolved: number;
    accuracy: number;
  };
  recency: {
    window: number;
    totalAttempts: number;
    accuracy: number;
    avgSecondsPerQuestion: number;
  };
}

function Practice() {
  const { user, authLoading } = useSupabaseAuth();
  const [timePreference, setTimePreference] = useState("15");

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    error: statsErrorObj,
    refetch: refetchStats,
  } = useQuery<QuestionStats>({
    queryKey: ["/api/questions/stats"],
    enabled: !!user && !authLoading,
  });

  const {
    data: topicsData,
    isLoading: topicsLoading,
    isError: topicsError,
    error: topicsErrorObj,
    refetch: refetchTopics,
  } = useQuery<PracticeTopics>({
    queryKey: ["/api/practice/topics"],
    enabled: !!user && !authLoading,
  });

  const {
    data: kpiData,
    isLoading: kpiLoading,
    isError: kpiError,
    error: kpiErrorObj,
    refetch: refetchKpis,
  } = useQuery<KpiResponse>({
    queryKey: ["/api/progress/kpis"],
    enabled: !!user && !authLoading,
  });

  const {
    data: calendarData,
    isLoading: streakLoading,
    isError: streakError,
    error: streakErrorObj,
    refetch: refetchStreak,
  } = useQuery({
    queryKey: ["calendar-streak-practice"],
    queryFn: async () => {
      const now = DateTime.local();
      const start = now.startOf("month").toISODate() ?? now.toISODate()!;
      const end = now.endOf("month").toISODate() ?? now.toISODate()!;
      return getCalendarMonth(start, end);
    },
    enabled: !!user && !authLoading,
  });

  const streakCurrent = calendarData?.streak?.current ?? 0;
  const weekSessions = kpiData?.week?.practiceSessions ?? 0;
  const weekAccuracy = kpiData?.week?.accuracy ?? 0;
  const mathDomains = normalizePracticeTopicDomains(topicsData?.sections?.find((s: any) => s.section === "math")?.domains);
  const readingDomains = normalizePracticeTopicDomains(topicsData?.sections?.find((s: any) => s.section === "reading_writing")?.domains);

  const statsEmpty = !statsLoading && !statsError && (stats?.total ?? 0) === 0;
  const kpiEmpty = !kpiLoading && !kpiError && !kpiData;
  const streakEmpty = !streakLoading && !streakError && !calendarData?.streak;

  const quickFocus = useMemo(
    () => [
      {
        href: appendPracticeDuration("/practice/reading-writing", timePreference),
        title: "Reading & Writing",
        subtitle: `${statsLoading ? "--" : statsError ? "—" : Number(stats?.reading_writing || 0)} questions in bank`,
        icon: BookOpen,
        testId: "button-practice-reading",
        variant: "outline" as const,
      },
      {
        href: appendPracticeDuration("/practice/math", timePreference),
        title: "Math",
        subtitle: `${statsLoading ? "--" : statsError ? "—" : Number(stats?.math || 0)} questions in bank`,
        icon: Calculator,
        testId: "button-practice-math",
        variant: "default" as const,
      },
    ],
    [stats?.math, stats?.reading_writing, statsError, statsLoading, timePreference],
  );

  const secondaryActions = [
    { href: "/review-errors", title: "Review Errors", icon: AlertCircle, caption: "Resolve unresolved mistakes" },
    { href: "/flow-cards", title: "FlowCards", icon: Sparkles, caption: "Fast adaptive drill mode" },
    { href: "/full-test", title: "Full-Length Exam", icon: Target, caption: "Run a timed full SAT" },
    { href: "/mastery", title: "Mastery", icon: TrendingUp, caption: "Domain-level performance" },
  ];

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">Practice Center</p>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2" data-testid="page-title">
            Deliberate SAT Practice
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            Start focused sessions, continue your current section flow naturally, and keep all activity synced to live Lyceon runtime progress.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            <PageCard
              title="Session Setup"
              description="Configure your next focused run. Starting a section reuses any compatible active canonical session on the backend."
              className="bg-card/80 border-border/50"
            >
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary/50 p-4">
                  <Timer className="h-4 w-4 text-foreground" />
                  <p className="text-sm text-foreground/90">
                    Session target duration
                  </p>
                  <Select value={timePreference} onValueChange={setTimePreference}>
                    <SelectTrigger className="w-44 bg-background" data-testid="select-duration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10 minutes</SelectItem>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {quickFocus.map((focus) => (
                    <Button
                      key={focus.href}
                      asChild
                      size="lg"
                      variant={focus.variant}
                      className="h-auto justify-start py-5 px-5"
                      data-testid={focus.testId}
                    >
                      <Link href={focus.href}>
                        <div className="w-full flex items-start justify-between gap-4 text-left">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <focus.icon className="h-4 w-4" />
                              <span className="font-semibold">{focus.title}</span>
                            </div>
                            <p className="text-xs opacity-85">{focus.subtitle}</p>
                          </div>
                          <ArrowRight className="h-4 w-4 shrink-0" />
                        </div>
                      </Link>
                    </Button>
                  ))}
                </div>

                {statsError && (
                  <RecoveryNotice
                    title="We couldn't load question totals."
                    message={(statsErrorObj as Error)?.message ?? "Try again. If this keeps happening, refresh the page."}
                    onRetry={() => void refetchStats()}
                    retryLabel="Retry"
                    className="rounded-lg"
                  />
                )}
              </div>
            </PageCard>

            <PageCard
              title="Domain Library"
              description="Browse available domains from live taxonomy before launching a filtered topic run."
              className="bg-card/80 border-border/50"
            >
              {topicsLoading ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : topicsError ? (
                <RecoveryNotice
                  title="We couldn't load domain taxonomy."
                  message={(topicsErrorObj as Error)?.message ?? "Try again. If this keeps happening, refresh the page."}
                  onRetry={() => void refetchTopics()}
                  retryLabel="Retry"
                />
              ) : (
                <div className="space-y-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Math Domains</p>
                    {mathDomains.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No math domains published yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {mathDomains.map((domain: any) => (
                          <Badge key={`math-${domain.domain}`} variant="outline" className="px-3 py-1">
                            {domain.domain}
                            {domain.skills.length > 0 ? ` · ${domain.skills.length}` : ""}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Reading & Writing Domains</p>
                    {readingDomains.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No reading & writing domains published yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {readingDomains.map((domain: any) => (
                          <Badge key={`rw-${domain.domain}`} variant="outline" className="px-3 py-1">
                            {domain.domain}
                            {domain.skills.length > 0 ? ` · ${domain.skills.length}` : ""}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/practice/topics">
                        <BookOpen className="h-4 w-4 mr-2" />
                        Open Topic Explorer
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </PageCard>
          </div>

          <aside className="lg:col-span-4 space-y-6">
            <PageCard title="Weekly Activity" className="bg-card/80 border-border/50">
              <div className="space-y-4">
                {(kpiError || streakError) && (
                  <RecoveryNotice
                    title="We couldn't load your activity summary."
                    message={
                      (kpiErrorObj as Error)?.message ||
                      (streakErrorObj as Error)?.message ||
                      "Try again. If this keeps happening, refresh the page."
                    }
                    onRetry={() => {
                      void refetchKpis();
                      void refetchStreak();
                    }}
                    retryLabel="Retry summary"
                  />
                )}

                <div className="rounded-lg bg-secondary/60 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-foreground/80">
                    <Flame className="h-4 w-4" />
                    Streak
                  </div>
                  <span className="text-xl font-semibold">{streakLoading ? "—" : streakError ? "—" : streakEmpty ? "0" : streakCurrent}</span>
                </div>

                <div className="rounded-lg bg-secondary/60 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-foreground/80">
                    <Clock className="h-4 w-4" />
                    Sessions (7d)
                  </div>
                  <span className="text-xl font-semibold">{kpiLoading ? "—" : kpiError ? "—" : kpiEmpty ? "0" : weekSessions}</span>
                </div>

                <div className="rounded-lg bg-secondary/60 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-foreground/80">
                    <Award className="h-4 w-4" />
                    Accuracy
                  </div>
                  <span className="text-xl font-semibold">
                    {kpiLoading ? "—" : kpiError ? "—" : kpiData?.week?.questionsSolved === 0 ? "—" : `${weekAccuracy}%`}
                  </span>
                </div>

                {kpiEmpty && <p className="text-xs text-muted-foreground">No weekly KPI activity recorded yet.</p>}
                {streakEmpty && <p className="text-xs text-muted-foreground">No streak data for this month yet.</p>}
              </div>
            </PageCard>

            <PageCard className="bg-primary-container text-primary-foreground border-transparent">
              <div className="space-y-2 text-center py-2">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70">Question Bank</p>
                <p className="text-5xl font-bold">{statsError ? "—" : statsLoading ? "--" : stats?.total || 0}</p>
                <p className="text-sm text-primary-foreground/80">
                  {statsEmpty ? "No questions available yet" : "Total questions currently available"}
                </p>
              </div>
            </PageCard>

            <PageCard title="Quick Actions" className="bg-card/80 border-border/50">
              <div className="space-y-3">
                {secondaryActions.map((item) => (
                  <Button key={item.href} asChild variant="ghost" className="h-auto w-full justify-between px-3 py-3">
                    <Link href={item.href}>
                      <span className="flex items-center gap-2 text-sm">
                        <item.icon className="h-4 w-4" />
                        {item.title}
                      </span>
                      <span className="text-xs text-muted-foreground">{item.caption}</span>
                    </Link>
                  </Button>
                ))}
              </div>
            </PageCard>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export default Practice;
