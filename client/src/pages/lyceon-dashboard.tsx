import { useQuery } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { SectionHeader } from "@/components/common/section-header";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar, Target, TrendingUp, Zap, ArrowRight, Brain, Award, Flame, Play, Calculator, MessageCircle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { ScoreProjectionCard } from "@/components/progress/ScoreProjectionCard";
import { getCalendarMonth, getCalendarProfile, StudyProfile, StudyPlanDay } from "@/lib/calendarApi";
import { DateTime } from "luxon";

interface ProgressTotals {
  correct: number;
  incorrect: number;
  skipped: number;
}

interface SectionTotals {
  correct: number;
  incorrect: number;
  skipped: number;
}

interface CompetencySummary {
  key: string;
  section: string | null;
  score: number;
  incorrectCount?: number | null;
}

interface ProgressData {
  totals: ProgressTotals;
  bySection: Record<string, SectionTotals>;
  weakestCompetencies: CompetencySummary[];
  improvingCompetencies: CompetencySummary[];
  accuracy: number;
  currentScore: number;
  totalAttempts: number;
}

interface RecentActivity {
  id: string;
  type: 'practice' | 'test' | 'tutor';
  title: string;
  timestamp: Date;
  result?: string;
}

export default function LyceonDashboard() {
  const { user } = useSupabaseAuth();
  const [, navigate] = useLocation();

  // Progress and activity data removed - endpoints not implemented
  // const { data: progressData, isLoading: progressLoading } = useQuery<ProgressData>({
  //   queryKey: ['/api/progress'],
  //   enabled: !!user,
  // });
  // const { data: recentActivity, isLoading: activityLoading } = useQuery<RecentActivity[]>({
  //   queryKey: ['/api/recent-activity'],
  //   enabled: !!user,
  // });

  // Calendar profile query (provides timezone, baseline, target, exam date)
  const { data: profileData, isLoading: profileLoading, error: profileError } = useQuery<StudyProfile | null>({
    queryKey: ['calendar-profile'],
    queryFn: getCalendarProfile,
    enabled: !!user,
    staleTime: 60000,
  });

  // Derive timezone from profile (default: America/Chicago)
  const userTimezone = profileData?.timezone || 'America/Chicago';
  const todayISO = DateTime.now().setZone(userTimezone).toISODate()!;

  const { data: calendarData, isLoading: streakLoading, error: calendarError } = useQuery({
    queryKey: ['calendar-month', userTimezone],
    queryFn: async () => {
      const now = DateTime.now().setZone(userTimezone);
      const start = now.startOf('month').toISODate() ?? now.toISODate()!;
      const end = now.endOf('month').toISODate() ?? now.toISODate()!;
      return getCalendarMonth(start, end);
    },
    enabled: !!user,
    refetchInterval: 60000,
  });

  // Find today's plan day from calendar data
  const todayPlan: StudyPlanDay | undefined = calendarData?.days?.find(
    (day) => day.day_date === todayISO
  );

  // Weekly KPIs query
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

  const { data: kpiData, isLoading: kpiLoading, error: kpiError } = useQuery<KpiResponse>({
    queryKey: ['/api/progress/kpis'],
    enabled: !!user,
    refetchInterval: 60000,
  });

  // Derive focus areas from weakest competencies (removed - API not implemented)
  // const focusAreas = progressData?.weakestCompetencies ?? [];
  // const hasFocusAreas = !!focusAreas && focusAreas.length > 0;

  // Derive values from calendar profile (deterministic)
  const baselineScore = profileData?.baseline_score ?? 400;
  const targetScore = profileData?.target_score ?? null;
  const examDateStr = profileData?.exam_date ?? null;
  const examDate = examDateStr ? DateTime.fromISO(examDateStr) : null;
  const daysUntilTest = examDate
    ? Math.ceil(examDate.diff(DateTime.now(), 'days').days)
    : null;

  // Today's plan progress
  const plannedMinutes = todayPlan?.planned_minutes ?? 0;
  const completedMinutes = todayPlan?.completed_minutes ?? 0;
  const minutesProgress = plannedMinutes > 0 ? Math.min(1, completedMinutes / plannedMinutes) * 100 : 0;
  const streakCurrent = calendarData?.streak?.current ?? 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
            {getGreeting()}, {user?.display_name || 'Student'}
          </h1>
          <p className="text-muted-foreground">
            {daysUntilTest !== null && daysUntilTest > 0
              ? `Your test is in ${daysUntilTest} days. Let's keep the momentum going!`
              : "Ready to ace your SAT? Let's practice!"
            }
          </p>
        </div>

        {(profileError || calendarError || kpiError) && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>
              Some dashboard data failed to load. Please refresh the page or try again later.
            </AlertDescription>
          </Alert>
        )}

        {/* FlowCards Featured Hero */}
        <Card className="relative overflow-hidden border-0 bg-background from-purple-900 via-pink-900 to-indigo-900 mb-8" data-testid="card-flowcards-hero">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(120,119,198,0.3),transparent),radial-gradient(circle_at_80%_20%,rgba(255,119,198,0.3),transparent)]"></div>
          <CardContent className="relative p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row items-center gap-6">
              {/* Left: Content */}
              <div className="flex-1 text-center lg:text-left">
                <div className="flex items-center justify-center lg:justify-start gap-2 mb-3">
                  <div className="p-2 bg-white/10 backdrop-blur-sm rounded-full">
                    <Zap className="h-5 w-5 text-pink-400" />
                  </div>
                  <span className="text-sm font-medium text-pink-300 uppercase tracking-wide">Featured</span>
                </div>
                <h2 className="text-2xl lg:text-3xl font-bold text-white mb-3">
                  FlowCards
                </h2>
                <p className="text-base text-white/80 mb-4 max-w-lg">
                  TikTok-style SAT practice. Swipe through questions, build streaks, and master the SAT one card at a time.
                </p>
                <div className="flex flex-wrap justify-center lg:justify-start gap-3 mb-5">
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
                    <Flame className="h-3.5 w-3.5 text-orange-400" />
                    <span className="text-xs text-white">
                      {streakLoading ? "..." : `${calendarData?.streak?.current || 0} Day Streak`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
                    <Zap className="h-3.5 w-3.5 text-yellow-400" />
                    <span className="text-xs text-white">Auto-Submit</span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
                    <MessageCircle className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-xs text-white">AI Explanations</span>
                  </div>
                </div>
                <div className="flex flex-wrap justify-center lg:justify-start gap-3">
                  <Button
                    size="lg"
                    className="bg-white text-purple-900 hover:bg-white/90 font-semibold"
                    data-testid="button-start-flowcards"
                    asChild
                  >
                    <Link href="/flow-cards">
                      <Play className="h-4 w-4 mr-2" />
                      Start FlowCards
                    </Link>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/30 text-white hover:bg-white/10 hover:text-white"
                    data-testid="button-flowcards-math"
                    asChild
                  >
                    <Link href="/flow-cards?section=math">
                      <Calculator className="h-4 w-4 mr-2" />
                      Math Only
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Right: Preview Card Stack (hidden on mobile) */}
              <div className="hidden lg:block relative w-48 h-64">
                <div className="absolute top-3 left-3 w-full h-full bg-white/10 rounded-2xl transform rotate-6"></div>
                <div className="absolute top-1.5 left-1.5 w-full h-full bg-white/20 rounded-2xl transform rotate-3"></div>
                <div className="absolute inset-0 w-full h-full bg-white/95 rounded-2xl shadow-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 mb-3">
                      <div className="px-1.5 py-0.5 bg-blue-100 rounded text-[10px] font-medium text-blue-600">Math</div>
                      <div className="px-1.5 py-0.5 bg-yellow-100 rounded text-[10px] font-medium text-yellow-600">Medium</div>
                    </div>
                    <p className="text-gray-800 text-xs leading-relaxed">
                      If 3x + 7 = 22, what is the value of x?
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="p-2 bg-gray-50 rounded-lg text-xs text-gray-600">A) 3</div>
                    <div className="p-2 bg-indigo-100 rounded-lg text-xs text-indigo-700 font-medium border border-indigo-300">B) 5</div>
                    <div className="p-2 bg-gray-50 rounded-lg text-xs text-gray-600">C) 7</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-6 min-w-0">
          {/* Left Column (2/3 width) */}
          <div className="lg:col-span-2 space-y-6 min-w-0">
            {/* Today's Focus Card */}
            <PageCard
              title="Today's Focus"
              description="Your personalized practice plan for today"
              className="border-2 border-primary/20 shadow-lg"
            >
              {(profileLoading || streakLoading) ? (
                <div className="space-y-4">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : profileData === null ? (
                <EmptyState
                  title="Set up your study plan"
                  description="Add your baseline score and test date to see your personalized plan."
                />
              ) : (
                <div className="space-y-6">
                  {/* Score Overview + Streak */}
                  <div className="grid sm:grid-cols-4 gap-4">
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5" data-testid="current-score">
                      <div className="p-2 rounded-full bg-primary/10">
                        <Award className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Current</p>
                        <p className="text-2xl font-bold text-foreground">{baselineScore}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50" data-testid="target-score">
                      <div className="p-2 rounded-full bg-green-100">
                        <Target className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Target</p>
                        <p className="text-2xl font-bold text-foreground">{targetScore ?? "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50" data-testid="test-date">
                      <div className="p-2 rounded-full bg-amber-100">
                        <Calendar className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Test Date</p>
                        <p className="text-lg font-semibold text-foreground">
                          {examDate ? examDate.toFormat('MMM d') : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-orange-50" data-testid="streak">
                      <div className="p-2 rounded-full bg-orange-100">
                        <Flame className="h-5 w-5 text-orange-600" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Streak</p>
                        <p className="text-2xl font-bold text-foreground">{streakCurrent} days</p>
                      </div>
                    </div>
                  </div>

                  {/* Minutes Progress Bar */}
                  <div className="p-4 rounded-lg bg-muted/50 border">
                    <div className="flex items-center justify-between gap-3 min-w-0 mb-2">
                      <span className="text-sm font-medium min-w-0 truncate">Today's Progress</span>
                      <span className="text-sm font-semibold text-primary shrink-0">{completedMinutes} / {plannedMinutes} min</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <Progress value={minutesProgress} className="w-full h-3" />
                    </div>
                    {plannedMinutes === 0 && (
                      <p className="text-xs text-muted-foreground mt-2">No plan for today. Go to Calendar to generate one.</p>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="flex flex-col sm:flex-row gap-3 min-w-0">
                    <Button asChild className="w-full sm:flex-1 h-12 text-base font-medium" size="lg" data-testid="button-start-practice">
                      <Link href="/practice">
                        <Zap className="mr-2 h-5 w-5" />
                        Start Today's Practice
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full sm:w-auto sm:flex-none h-12 text-base font-medium" size="lg" data-testid="button-calendar">
                      <Link href="/calendar">
                        <Calendar className="mr-2 h-4 w-4" />
                        Calendar
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </PageCard>

            {/* Score Projection */}
            <ScoreProjectionCard />
          </div>

          {/* Right Column (1/3 width) */}
          <div className="space-y-6 min-w-0">
            {/* Tutor Insights */}
            <PageCard title="Lisa Insights">
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-start gap-3">
                    <Brain className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                      Personalized tutor recommendations are being rebuilt from backend KPI truth data.
                    </p>
                  </div>
                </div>

                <Button asChild variant="outline" className="w-full" data-testid="button-ask-tutor">
                  <Link href="/chat">
                    Ask Lisa
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </PageCard>

            {/* Focus Areas - Temporarily Disabled */}
            <PageCard title="Focus Areas">
              <EmptyState
                title="Coming Soon"
                description="Detailed progress tracking is being rebuilt. Continue practicing and we'll show your focus areas soon!"
              />
            </PageCard>

            {/* Next Topic */}
            <PageCard title="Next Topic to Master">
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <TrendingUp className="h-4 w-4 text-primary" />
                    </div>
                    <p className="font-semibold text-sm">Topic recommendations coming soon</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    We are connecting this card to canonical mastery and weakness signals.
                  </p>
                </div>

                <Button asChild className="w-full" data-testid="button-practice-topic">
                  <Link href="/practice">
                    Practice Now
                  </Link>
                </Button>
              </div>
            </PageCard>

            {/* Quick Stats */}
            <PageCard title="This Week">
              {kpiLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ) : kpiError ? (
                <div className="text-sm text-destructive">Unable to load weekly stats.</div>
              ) : !kpiData ? (
                <div className="text-sm text-muted-foreground">No weekly stats yet.</div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <span className="text-sm text-muted-foreground min-w-0 truncate">Practice Sessions</span>
                    <span className="text-2xl font-bold shrink-0">
                      {kpiData.week?.practiceSessions ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <span className="text-sm text-muted-foreground min-w-0 truncate">Questions Solved</span>
                    <span className="text-2xl font-bold shrink-0">
                      {kpiData.week?.questionsSolved ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <span className="text-sm text-muted-foreground min-w-0 truncate">Accuracy</span>
                    <span className="text-2xl font-bold text-green-600 shrink-0">
                      {kpiData.week?.questionsSolved === 0 ? "—" : `${kpiData.week?.accuracy ?? 0}%`}
                    </span>
                  </div>
                </div>
              )}
            </PageCard>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
