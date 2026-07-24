import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  BookOpen,
  Calculator,
  Clock,
  Target,
  Flame,
  TrendingUp,
  Award,
  ArrowRight,
  AlertCircle,
  PlayCircle,
  Trash2,
  X,
  Hash,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useMemo, useState } from "react";
import { getCalendarMonth } from "@/lib/calendarApi";
import {
  normalizePracticeTopicDomains,
  type RawPracticeTopicDomain,
} from "@/lib/practice-topic-taxonomy";
import { type PracticeDifficulty } from "@/lib/practice-filters";
import { DateTime } from "luxon";
import { RecoveryNotice } from "@/components/feedback/RecoveryNotice";
import { useActiveSessions } from "@/hooks/useActiveSessions";
import { usePractice, type PracticeSessionFilters } from "@/hooks/usePractice";
import { isMathSection, sectionDisplayLabel } from "@shared/section-display";

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
    questionsSolved: number;
    accuracy: number | null;
  };
  recency: {
    window: number;
    totalAttempts: number;
    accuracy: number | null;
  } | null;
}

const DIFFICULTY_OPTIONS: {
  value: PracticeDifficulty;
  label: string;
  color: string;
}[] = [
  {
    value: "easy",
    label: "Easy",
    color:
      "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100",
  },
  {
    value: "medium",
    label: "Medium",
    color: "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100",
  },
  {
    value: "hard",
    label: "Hard",
    color: "border-red-300 text-red-700 bg-red-50 hover:bg-red-100",
  },
];

function Practice() {
  const { user, authLoading } = useSupabaseAuth();
  const [questionCount, setQuestionCount] = useState("10");
  const [selectedDifficulties, setSelectedDifficulties] = useState<
    PracticeDifficulty[]
  >([]);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [focusSection, setFocusSection] = useState<
    "math" | "reading_writing" | ""
  >("math");
  const [, setLocation] = useLocation();
  const [isStarting, setIsStarting] = useState(false);

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
    sessions: activeSessions,
    maxConcurrentSessions,
    terminateSession: terminateActiveSession,
    isTerminating,
  } = useActiveSessions();

  const practiceHook = usePractice();

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
  const weekQuestions = kpiData?.week?.questionsSolved ?? 0;
  const weekAccuracy = kpiData?.week?.accuracy ?? 0;
  const mathDomains = normalizePracticeTopicDomains(
    topicsData?.sections?.find((s: any) => s.section === "math")?.domains,
  );
  const readingDomains = normalizePracticeTopicDomains(
    topicsData?.sections?.find((s: any) => s.section === "reading_writing")
      ?.domains,
  );

  const visibleDomains = useMemo(() => {
    if (focusSection === "math") return mathDomains;
    if (focusSection === "reading_writing") return readingDomains;
    return [...mathDomains, ...readingDomains];
  }, [focusSection, mathDomains, readingDomains]);

  const statsEmpty = !statsLoading && !statsError && (stats?.total ?? 0) === 0;
  const kpiEmpty = !kpiLoading && !kpiError && !kpiData;
  const streakEmpty = !streakLoading && !streakError && !calendarData?.streak;

  const visibleSkills = useMemo(() => {
    const sourceDomains =
      selectedDomains.length > 0
        ? visibleDomains.filter((d) => selectedDomains.includes(d.domain))
        : visibleDomains;
    const all = new Set<string>();
    for (const d of sourceDomains) {
      for (const s of d.skills) all.add(s);
    }
    return Array.from(all).sort();
  }, [visibleDomains, selectedDomains]);

  const toggleSkill = (skill: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((x) => x !== skill) : [...prev, skill],
    );
  };

  const buildFilters = (
    section: "math" | "reading_writing",
  ): PracticeSessionFilters => ({
    sections: [section],
    domains: selectedDomains.length > 0 ? selectedDomains : undefined,
    skills: selectedSkills.length > 0 ? selectedSkills : undefined,
    difficulties:
      selectedDifficulties.length > 0 ? selectedDifficulties : undefined,
    targetQuestionCount: Number(questionCount) || 10,
  });

  const handleStartSession = async (section: "math" | "reading_writing") => {
    setIsStarting(true);
    const sessionFilters = buildFilters(section);
    const newId = await practiceHook.startSession(sessionFilters);
    setIsStarting(false);
    if (newId) {
      setLocation(`/practice/session/${newId}`);
    }
  };

  const toggleDifficulty = (d: PracticeDifficulty) => {
    setSelectedDifficulties((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  };

  const toggleDomain = (domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain)
        ? prev.filter((x) => x !== domain)
        : [...prev, domain],
    );
  };

  const clearFilters = () => {
    setSelectedDifficulties([]);
    setSelectedDomains([]);
    setSelectedSkills([]);
  };

  const hasActiveFilters =
    selectedDifficulties.length > 0 ||
    selectedDomains.length > 0 ||
    selectedSkills.length > 0;

  const quickFocus = useMemo(
    () => [
      {
        section: "reading_writing" as const,
        title: "Reading & Writing",
        subtitle: `${statsLoading ? "--" : statsError ? "—" : Number(stats?.reading_writing || 0)} questions in bank`,
        icon: BookOpen,
        testId: "button-practice-reading",
        variant: "outline" as const,
      },
      {
        section: "math" as const,
        title: "Math",
        subtitle: `${statsLoading ? "--" : statsError ? "—" : Number(stats?.math || 0)} questions in bank`,
        icon: Calculator,
        testId: "button-practice-math",
        variant: "default" as const,
      },
    ],
    [stats?.math, stats?.reading_writing, statsError, statsLoading],
  );

  const secondaryActions = [
    {
      href: "/review-errors",
      title: "Review Errors",
      icon: AlertCircle,
      caption: "Resolve unresolved mistakes",
    },
    {
      href: "/full-test",
      title: "Full-Length Exam",
      icon: Target,
      caption: "Run a timed full SAT",
    },
    {
      href: "/mastery",
      title: "Mastery",
      icon: TrendingUp,
      caption: "Domain-level performance",
    },
  ];

  return (
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Practice Center
          </p>
          <h1
            className="text-4xl font-bold tracking-tight text-foreground mb-2"
            data-testid="page-title"
          >
            Deliberate SAT Practice
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            Start focused sessions, continue your current section flow
            naturally, and keep all activity synced to live Lyceon runtime
            progress.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            {activeSessions.length > 0 && (
              <PageCard
                title="Active Sessions"
                description={`You have ${activeSessions.length} session${activeSessions.length === 1 ? "" : "s"} in progress. Choose one to resume.`}
                className="bg-primary/5 border-primary/20"
              >
                <div className="grid gap-3">
                  {activeSessions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          {isMathSection(s.section) ? (
                            <Calculator className="h-5 w-5" />
                          ) : (
                            <BookOpen className="h-5 w-5" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">
                              {isMathSection(s.section)
                                ? "Math"
                                : "Reading & Writing"}
                            </span>
                            <Badge
                              variant="secondary"
                              className="text-[10px] py-0"
                            >
                              {s.mode}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Progress: {s.answered_items} / {s.total_items}{" "}
                            questions · Started{" "}
                            {DateTime.fromISO(s.started_at).toRelative()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                              disabled={isTerminating}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                End this session?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This will terminate the session. Your progress
                                so far ({s.answered_items} of {s.total_items}{" "}
                                questions) is saved, but you will not be able to
                                resume it.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => terminateActiveSession(s.id)}
                              >
                                End session
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button
                          size="sm"
                          onClick={() =>
                            setLocation(`/practice/session/${s.id}`)
                          }
                        >
                          <PlayCircle className="h-4 w-4 mr-2" />
                          Continue
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </PageCard>
            )}

            <PageCard
              title="Session Setup"
              description={`Configure your next focused run. You can have up to ${maxConcurrentSessions ?? 5} active sessions at a time.`}
              className="bg-card/80 border-border/50"
            >
              <div className="space-y-6">
                {/* Question count */}
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary/50 p-4">
                  <Hash className="h-4 w-4 text-foreground" />
                  <p className="text-sm text-foreground/90">
                    Questions per session
                  </p>
                  <Select
                    value={questionCount}
                    onValueChange={setQuestionCount}
                  >
                    <SelectTrigger
                      className="w-44 bg-background"
                      data-testid="select-question-count"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 questions</SelectItem>
                      <SelectItem value="10">10 questions</SelectItem>
                      <SelectItem value="20">20 questions</SelectItem>
                      <SelectItem value="30">30 questions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Difficulty Filter */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Difficulty
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {DIFFICULTY_OPTIONS.map((opt) => {
                      const active = selectedDifficulties.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => toggleDifficulty(opt.value)}
                          className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                            active
                              ? opt.color + " ring-2 ring-offset-1 ring-current"
                              : "border-border text-muted-foreground hover:border-foreground/30 bg-background"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Select none to include all difficulties
                  </p>
                </div>

                {/* Topic/Domain Filter */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Topic (Domain)
                    </p>
                    <div className="flex items-center gap-2">
                      <Select
                        value={focusSection}
                        onValueChange={(v) => {
                          setFocusSection(v as "math" | "reading_writing" | "");
                          setSelectedDomains([]);
                          setSelectedSkills([]);
                        }}
                      >
                        <SelectTrigger className="h-7 w-36 text-xs bg-background">
                          <SelectValue placeholder="All sections" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="math">Math</SelectItem>
                          <SelectItem value="reading_writing">
                            Reading & Writing
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {topicsLoading ? (
                    <div className="flex gap-2">
                      <Skeleton className="h-7 w-20 rounded-full" />
                      <Skeleton className="h-7 w-28 rounded-full" />
                      <Skeleton className="h-7 w-24 rounded-full" />
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {visibleDomains.map((d) => {
                        const active = selectedDomains.includes(d.domain);
                        return (
                          <button
                            key={d.domain}
                            type="button"
                            onClick={() => toggleDomain(d.domain)}
                            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                              active
                                ? "border-primary bg-primary/10 text-primary ring-2 ring-offset-1 ring-primary/50"
                                : "border-border text-muted-foreground hover:border-foreground/30 bg-background"
                            }`}
                          >
                            {d.domain}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Select none to include all domains
                  </p>
                </div>

                {/* Skill Filter */}
                {visibleSkills.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Skill
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {visibleSkills.map((skill) => {
                        const active = selectedSkills.includes(skill);
                        return (
                          <button
                            key={skill}
                            type="button"
                            onClick={() => toggleSkill(skill)}
                            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                              active
                                ? "border-primary bg-primary/10 text-primary ring-2 ring-offset-1 ring-primary/50"
                                : "border-border text-muted-foreground hover:border-foreground/30 bg-background"
                            }`}
                          >
                            {skill}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Select none to include all skills
                    </p>
                  </div>
                )}

                {/* Active filter summary + clear */}
                {hasActiveFilters && (
                  <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <span className="text-xs text-muted-foreground">
                      Active filters:
                    </span>
                    {selectedDifficulties.map((d) => (
                      <Badge
                        key={d}
                        variant="secondary"
                        className="text-[10px] gap-1"
                      >
                        {d}
                        <button
                          onClick={() => toggleDifficulty(d)}
                          className="ml-0.5 hover:text-destructive"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                    {selectedDomains.map((domain) => (
                      <Badge
                        key={domain}
                        variant="secondary"
                        className="text-[10px] gap-1 max-w-[140px] truncate"
                      >
                        {domain}
                        <button
                          onClick={() => toggleDomain(domain)}
                          className="ml-0.5 hover:text-destructive flex-shrink-0"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                    {selectedSkills.map((skill) => (
                      <Badge
                        key={skill}
                        variant="secondary"
                        className="text-[10px] gap-1 max-w-[140px] truncate"
                      >
                        {skill}
                        <button
                          onClick={() => toggleSkill(skill)}
                          className="ml-0.5 hover:text-destructive flex-shrink-0"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                    <button
                      onClick={clearFilters}
                      className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline"
                    >
                      Clear all
                    </button>
                  </div>
                )}

                {/* Section buttons */}
                <div className="grid sm:grid-cols-2 gap-4">
                  {quickFocus.map((focus) => {
                    const isLimitReached = activeSessions.length >= 5;
                    return (
                      <Button
                        key={focus.title}
                        size="lg"
                        variant={focus.variant}
                        className="h-auto justify-start py-5 px-5"
                        data-testid={focus.testId}
                        disabled={isLimitReached || isStarting}
                        onClick={() => handleStartSession(focus.section)}
                      >
                        <div className="w-full flex items-start justify-between gap-4 text-left">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <focus.icon className="h-4 w-4" />
                              <span className="font-semibold">
                                {focus.title}
                              </span>
                            </div>
                            <p className="text-xs opacity-85">
                              {isLimitReached
                                ? "Limit reached (5 sessions)"
                                : focus.subtitle}
                            </p>
                          </div>
                          <ArrowRight className="h-4 w-4 shrink-0" />
                        </div>
                      </Button>
                    );
                  })}
                </div>

                {activeSessions.length >= 5 && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-3 text-amber-800 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    You've reached the limit of 5 active sessions. Complete or
                    delete an existing session to start a new one.
                  </div>
                )}

                {practiceHook.quotaExhausted && (
                  <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 flex items-center gap-3 text-orange-800 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    Your practice quota is exhausted. Upgrade your plan to
                    continue practicing.
                    <Link href="/upgrade">
                      <Button variant="outline" size="sm" className="ml-auto">
                        Upgrade
                      </Button>
                    </Link>
                  </div>
                )}

                {practiceHook.error && !practiceHook.quotaExhausted && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3 text-red-800 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    {practiceHook.error}
                  </div>
                )}

                {statsError && (
                  <RecoveryNotice
                    title="We couldn't load question totals."
                    message={
                      (statsErrorObj as Error)?.message ??
                      "Try again. If this keeps happening, refresh the page."
                    }
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
                  message={
                    (topicsErrorObj as Error)?.message ??
                    "Try again. If this keeps happening, refresh the page."
                  }
                  onRetry={() => void refetchTopics()}
                  retryLabel="Retry"
                />
              ) : (
                <div className="space-y-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                      Math Domains
                    </p>
                    {mathDomains.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No math domains published yet.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {mathDomains.map((domain: any) => (
                          <Badge
                            key={`math-${domain.domain}`}
                            variant="outline"
                            className="px-3 py-1"
                          >
                            {domain.domain}
                            {domain.skills.length > 0
                              ? ` · ${domain.skills.length}`
                              : ""}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                      Reading & Writing Domains
                    </p>
                    {readingDomains.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No reading & writing domains published yet.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {readingDomains.map((domain: any) => (
                          <Badge
                            key={`rw-${domain.domain}`}
                            variant="outline"
                            className="px-3 py-1"
                          >
                            {domain.domain}
                            {domain.skills.length > 0
                              ? ` · ${domain.skills.length}`
                              : ""}
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
            <PageCard
              title="Weekly Activity"
              className="bg-card/80 border-border/50"
            >
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
                  <span className="text-xl font-semibold">
                    {streakLoading
                      ? "—"
                      : streakError
                        ? "—"
                        : streakEmpty
                          ? "0"
                          : streakCurrent}
                  </span>
                </div>

                <div className="rounded-lg bg-secondary/60 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-foreground/80">
                    <Clock className="h-4 w-4" />
                    Questions (7d)
                  </div>
                  <span className="text-xl font-semibold">
                    {kpiLoading
                      ? "—"
                      : kpiError
                        ? "—"
                        : kpiEmpty
                          ? "0"
                          : weekQuestions}
                  </span>
                </div>

                <div className="rounded-lg bg-secondary/60 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-foreground/80">
                    <Award className="h-4 w-4" />
                    Accuracy
                  </div>
                  <span className="text-xl font-semibold">
                    {kpiLoading
                      ? "—"
                      : kpiError
                        ? "—"
                        : kpiData?.week?.questionsSolved === 0
                          ? "—"
                          : `${weekAccuracy}%`}
                  </span>
                </div>

                {kpiEmpty && (
                  <p className="text-xs text-muted-foreground">
                    No weekly KPI activity recorded yet.
                  </p>
                )}
                {streakEmpty && (
                  <p className="text-xs text-muted-foreground">
                    No streak data for this month yet.
                  </p>
                )}
              </div>
            </PageCard>

            <PageCard className="bg-primary-container text-primary-foreground border-transparent">
              <div className="space-y-2 text-center py-2">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70">
                  Question Bank
                </p>
                <p className="text-5xl font-bold">
                  {statsError ? "—" : statsLoading ? "--" : stats?.total || 0}
                </p>
                <p className="text-sm text-primary-foreground/80">
                  {statsEmpty
                    ? "No questions available yet"
                    : "Total questions currently available"}
                </p>
              </div>
            </PageCard>

            <PageCard
              title="Quick Actions"
              className="bg-card/80 border-border/50"
            >
              <div className="space-y-3">
                {secondaryActions.map((item) => (
                  <Button
                    key={item.href}
                    asChild
                    variant="ghost"
                    className="h-auto w-full justify-between px-3 py-3"
                  >
                    <Link href={item.href}>
                      <span className="flex items-center gap-2 text-sm">
                        <item.icon className="h-4 w-4" />
                        {item.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.caption}
                      </span>
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
