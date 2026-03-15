import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Tag } from "@/components/common/tag";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Calculator, Clock, Target, Flame, TrendingUp, Award } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useState } from "react";
import { getCalendarMonth } from "@/lib/calendarApi";
import { DateTime } from "luxon";

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

const MATH_TOPICS = [
  { id: 'algebra', name: 'Algebra', count: 45 },
  { id: 'geometry', name: 'Geometry', count: 32 },
  { id: 'statistics', name: 'Statistics', count: 28 },
  { id: 'functions', name: 'Functions', count: 38 },
];

const READING_TOPICS = [
  { id: 'reading-comp', name: 'Reading Comprehension', count: 52 },
  { id: 'grammar', name: 'Grammar', count: 41 },
  { id: 'vocabulary', name: 'Vocabulary', count: 35 },
  { id: 'rhetoric', name: 'Rhetoric', count: 29 },
];

function Practice() {
  const { user, authLoading } = useSupabaseAuth();
  const [timePreference, setTimePreference] = useState("15");
<<<<<<< HEAD

  const { data: stats, isLoading: statsLoading, isError: statsError, error: statsErrorObj, refetch: refetchStats } = useQuery<QuestionStats>({
=======
  
  const { data: stats, isLoading: statsLoading } = useQuery<QuestionStats>({
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
    queryKey: ['/api/questions/stats'],
    enabled: !!user && !authLoading,
  });

  // Weekly KPIs query (same as dashboard)
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
<<<<<<< HEAD

  const { data: kpiData, isLoading: kpiLoading, isError: kpiError, error: kpiErrorObj, refetch: refetchKpis } = useQuery<KpiResponse>({
=======
  
  const { data: kpiData, isLoading: kpiLoading } = useQuery<KpiResponse>({
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
    queryKey: ['/api/progress/kpis'],
    enabled: !!user && !authLoading,
  });

  // Streak query (from calendar month)
  const { data: calendarData, isLoading: streakLoading } = useQuery({
    queryKey: ['calendar-streak-practice'],
    queryFn: async () => {
      const now = DateTime.local();
      const start = now.startOf('month').toISODate() ?? now.toISODate()!;
      const end = now.endOf('month').toISODate() ?? now.toISODate()!;
      return getCalendarMonth(start, end);
    },
    enabled: !!user && !authLoading,
  });

  const streakCurrent = calendarData?.streak?.current ?? 0;
  const weekSessions = kpiData?.week?.practiceSessions ?? 0;
  const weekAccuracy = kpiData?.week?.accuracy ?? 0;

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
            Practice Questions
          </h1>
          <p className="text-muted-foreground">
            Choose your practice mode and start improving your SAT score
          </p>
        </div>

        <div className="grid lg:grid-cols-4 gap-6">
          {/* Main Content (3/4 width) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Quick Practice Card */}
            <PageCard title="Quick Practice" description="Start a focused practice session">
              <div className="space-y-6">
                {/* Time Selector */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium">Practice Duration:</label>
                  <Select value={timePreference} onValueChange={setTimePreference}>
                    <SelectTrigger className="w-40" data-testid="select-duration">
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

                {/* Section Buttons */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <Button
                    asChild
                    size="lg"
                    className="h-auto py-6 flex-col items-start gap-2"
                    data-testid="button-practice-math"
                  >
                    <Link href="/practice/math">
                      <div className="flex items-center gap-3 w-full">
                        <div className="p-2 rounded-lg bg-primary/20">
                          <Calculator className="h-6 w-6" />
                        </div>
                        <div className="flex-1 text-left">
                          <div className="font-semibold text-base">Math</div>
                          <div className="text-xs opacity-90">
                            {statsLoading ? '--' : stats?.math || 0} questions
                          </div>
                        </div>
                      </div>
                    </Link>
                  </Button>

                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="h-auto py-6 flex-col items-start gap-2"
                    data-testid="button-practice-reading"
                  >
                    <Link href="/practice/reading-writing">
                      <div className="flex items-center gap-3 w-full">
                        <div className="p-2 rounded-lg bg-secondary">
                          <BookOpen className="h-6 w-6 text-foreground" />
                        </div>
                        <div className="flex-1 text-left">
                          <div className="font-semibold text-base">Reading & Writing</div>
                          <div className="text-xs text-muted-foreground">
<<<<<<< HEAD
                            {statsLoading
                              ? '--'
                              : statsError
                                ? '—'
                                : (Number(stats?.reading_writing || 0))} questions
=======
                            {statsLoading ? '--' : (Number(stats?.reading || 0) + Number(stats?.writing || 0))} questions
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
                          </div>
                        </div>
                      </div>
                    </Link>
                  </Button>
                </div>
<<<<<<< HEAD
                {statsError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <p className="font-medium">We couldn't load question totals.</p>
                    <p className="mt-1">{(statsErrorObj as Error)?.message ?? "Please try again."}</p>
                    <Button className="mt-3" variant="outline" size="sm" onClick={() => refetchStats()}>
                      Retry
                    </Button>
                  </div>
                )}
=======
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
              </div>
            </PageCard>

            {/* Browse by Topic - Math */}
            <PageCard title="Browse Math Topics">
              {statsLoading ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
<<<<<<< HEAD
              ) : topicsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <p className="font-medium">We couldn't load math topics.</p>
                  <p className="mt-1">{(topicsErrorObj as Error)?.message ?? "Please try again."}</p>
                  <Button className="mt-4" variant="outline" size="sm" onClick={() => refetchTopics()}>
                    Retry
                  </Button>
                </div>
              ) : mathDomains.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <p className="font-medium">No math topics available yet.</p>
                  <p className="mt-1">Check back soon for curated topic sets.</p>
                </div>
=======
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {MATH_TOPICS.map((topic) => (
                    <button
                      key={topic.id}
                      className="p-4 rounded-lg border text-left hover:bg-muted/50 hover:border-primary/50 transition-all group"
                      data-testid={`topic-${topic.id}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm group-hover:text-primary transition-colors">
                          {topic.name}
                        </span>
                        <Tag variant="muted">{topic.count}</Tag>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Click to practice {topic.name.toLowerCase()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </PageCard>

            {/* Browse by Topic - Reading & Writing */}
            <PageCard title="Browse Reading & Writing Topics">
              {statsLoading ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
<<<<<<< HEAD
              ) : topicsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <p className="font-medium">We couldn't load reading &amp; writing topics.</p>
                  <p className="mt-1">{(topicsErrorObj as Error)?.message ?? "Please try again."}</p>
                  <Button className="mt-4" variant="outline" size="sm" onClick={() => refetchTopics()}>
                    Retry
                  </Button>
                </div>
              ) : readingDomains.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <p className="font-medium">No reading &amp; writing topics available yet.</p>
                  <p className="mt-1">Check back soon for curated topic sets.</p>
                </div>
=======
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {READING_TOPICS.map((topic) => (
                    <button
                      key={topic.id}
                      className="p-4 rounded-lg border text-left hover:bg-muted/50 hover:border-primary/50 transition-all group"
                      data-testid={`topic-${topic.id}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm group-hover:text-primary transition-colors">
                          {topic.name}
                        </span>
                        <Tag variant="muted">{topic.count}</Tag>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Click to practice {topic.name.toLowerCase()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </PageCard>

            {/* Other Options */}
            <PageCard title="More Practice Modes">
              <div className="grid sm:grid-cols-3 gap-4">
                <Button
                  asChild
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  data-testid="button-random-practice"
                >
                  <Link href="/practice/random">
                    <Target className="h-5 w-5" />
                    <span className="text-sm font-medium">Mixed Practice</span>
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  data-testid="button-flow-cards"
                >
                  <Link href="/flow-cards">
                    <div className="relative">
                      <BookOpen className="h-5 w-5" />
                      <Badge className="absolute -top-2 -right-2 h-4 px-1 text-[10px]">New</Badge>
                    </div>
                    <span className="text-sm font-medium">FlowCards</span>
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  data-testid="button-review-errors"
                >
                  <Link href="/review-errors">
                    <TrendingUp className="h-5 w-5" />
                    <span className="text-sm font-medium">Review Errors</span>
                  </Link>
                </Button>
              </div>
            </PageCard>
          </div>

          {/* Sidebar (1/4 width) */}
          <div className="space-y-6">
            {/* Stats Card */}
            <PageCard title="Your Stats">
              <div className="space-y-4">
<<<<<<< HEAD
                {(kpiError || streakError) && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    <p className="font-medium">We couldn't load your stats.</p>
                    <p className="mt-1">
                      {(kpiErrorObj as Error)?.message || (streakErrorObj as Error)?.message || "Please try again."}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => refetchKpis()}>
                        Retry KPIs
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => refetchStreak()}>
                        Retry Streak
                      </Button>
                    </div>
                  </div>
                )}
=======
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="h-5 w-5 text-foreground" />
                    <span className="text-sm text-muted-foreground">Streak</span>
                  </div>
                  <span className="text-2xl font-bold">
                    {streakLoading ? "—" : streakCurrent}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-foreground" />
                    <span className="text-sm text-muted-foreground">This Week</span>
                  </div>
                  <span className="text-2xl font-bold">
                    {kpiLoading ? "—" : weekSessions}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="h-5 w-5 text-foreground" />
                    <span className="text-sm text-muted-foreground">Accuracy</span>
                  </div>
                  <span className="text-2xl font-bold text-foreground">
<<<<<<< HEAD
                    {kpiLoading
                      ? "—"
                      : kpiError
                        ? "—"
                        : kpiData?.week?.questionsSolved === 0
                          ? "—"
                          : `${weekAccuracy}%`}
=======
                    {kpiLoading ? "—" : (kpiData?.week?.questionsSolved === 0 ? "—" : `${weekAccuracy}%`)}
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
                  </span>
                </div>
              </div>
            </PageCard>

            {/* Total Questions */}
            <PageCard>
              <div className="text-center py-4">
                <div className="text-4xl font-bold text-primary mb-2">
                  {statsLoading ? '--' : stats?.total || 0}
                </div>
                <p className="text-sm text-muted-foreground">
                  Total Questions Available
                </p>
              </div>
            </PageCard>

            {/* Quick Links */}
            <PageCard title="Quick Links">
              <div className="space-y-2">
                <Button asChild variant="ghost" className="w-full justify-start" size="sm">
                  <Link href="/full-test">
                    Take Full Test
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="w-full justify-start" size="sm">
                  <Link href="/chat">
                    Ask Lisa
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="w-full justify-start" size="sm">
                  <Link href="/dashboard">
                    View Progress
                  </Link>
                </Button>
              </div>
            </PageCard>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default Practice;
