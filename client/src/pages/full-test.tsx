import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Clock, FileText, Users, Info, TrendingUp, Play, CheckCircle2, Search, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { csrfFetch } from "@/lib/csrf";
import ExamRunner from "@/components/full-length-exam/ExamRunner";
import FullLengthResultsView, { type FullLengthResultsData } from "@/components/full-length-exam/FullLengthResultsView";
import FullLengthReviewView, { type FullLengthReviewData } from "@/components/full-length-exam/FullLengthReviewView";
import RuntimeContractDisabledCard from "@/components/RuntimeContractDisabledCard";
import { PremiumUpgradePrompt, type PremiumPromptReason } from "@/components/billing/PremiumUpgradePrompt";
import {
  parseRuntimeContractDisabledFromError,
  parseRuntimeContractDisabledFromPayload,
  type RuntimeContractDisabledState,
} from "@/lib/runtime-contract-disable";
import { getPremiumDenialReason, parseApiErrorFromResponse } from "@/lib/api-error";

interface FullLengthHistorySession {
  sessionId: string;
  status: string;
  currentSection: string | null;
  currentModule: number | null;
  testFormId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reportAvailable: boolean;
  reviewAvailable: boolean;
}

interface FullLengthHistoryData {
  sessions: FullLengthHistorySession[];
  reportAccess: {
    hasPaidAccess: boolean;
    reason?: string | null;
  };
}

export default function FullTest() {
  const { user, authLoading } = useSupabaseAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStarted, setIsStarted] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [reportLookupSessionId, setReportLookupSessionId] = useState("");
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [contractDisabled, setContractDisabled] = useState<RuntimeContractDisabledState | null>(null);
  const [fullTestPremiumReason, setFullTestPremiumReason] = useState<PremiumPromptReason | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sessionId");
    const reportSid = params.get("reportSessionId");
    const reviewSid = params.get("reviewSessionId");
    if (sid) {
      setActiveSessionId(sid);
      setIsStarted(true);
      return;
    }

    if (reportSid) {
      const normalized = reportSid.trim();
      setReportSessionId(normalized);
      setReportLookupSessionId(normalized);
      if (reviewSid) {
        setReviewSessionId(reviewSid.trim());
      }
      return;
    }

    if (reviewSid) {
      const normalized = reviewSid.trim();
      setReportSessionId(normalized);
      setReportLookupSessionId(normalized);
      setReviewSessionId(normalized);
      return;
    }

    try {
      const lastSession = window.localStorage.getItem("lyceon:lastFullLengthSessionId");
      if (lastSession) {
        setReportSessionId(lastSession);
        setReportLookupSessionId(lastSession);
      }
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const {
    data: reportData,
    isLoading: reportLoading,
    error: reportError,
  } = useQuery<FullLengthResultsData>({
    queryKey: ["full-length-report", reportSessionId],
    enabled: !!reportSessionId && !!user && !isStarted && !contractDisabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      if (!reportSessionId) {
        throw new Error("Session ID is required");
      }

      const res = await csrfFetch(`/api/full-length/sessions/${encodeURIComponent(reportSessionId)}/report`, {
        method: "GET",
        credentials: "include",
      });

      const payload = await res.json().catch(() => null);
      const disabled = parseRuntimeContractDisabledFromPayload("full-length", res.status, payload);
      if (disabled) {
        setContractDisabled(disabled);
        throw new Error(`${res.status}: ${disabled.code}: ${disabled.message}`);
      }

      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, "Failed to load exam report");
      }

      return payload as FullLengthResultsData;
    },
  });

  const {
    data: reviewData,
    isLoading: reviewLoading,
    error: reviewError,
  } = useQuery<FullLengthReviewData>({
    queryKey: ["full-length-review", reviewSessionId],
    enabled: !!reviewSessionId && !!user && !isStarted && !contractDisabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      if (!reviewSessionId) {
        throw new Error("Session ID is required");
      }

      const res = await csrfFetch(`/api/full-length/sessions/${encodeURIComponent(reviewSessionId)}/review`, {
        method: "GET",
        credentials: "include",
      });

      const payload = await res.json().catch(() => null);
      const disabled = parseRuntimeContractDisabledFromPayload("full-length", res.status, payload);
      if (disabled) {
        setContractDisabled(disabled);
        throw new Error(`${res.status}: ${disabled.code}: ${disabled.message}`);
      }

      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, "Failed to load exam review");
      }

      return payload as FullLengthReviewData;
    },
  });
  const {
    data: historyData,
    isLoading: historyLoading,
    error: historyError,
  } = useQuery<FullLengthHistoryData>({
    queryKey: ["full-length-history"],
    enabled: !!user && !isStarted && !contractDisabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const res = await csrfFetch("/api/full-length/sessions?limit=15", {
        method: "GET",
        credentials: "include",
      });
      const payload = await res.json().catch(() => null);
      const disabled = parseRuntimeContractDisabledFromPayload("full-length", res.status, payload);
      if (disabled) {
        setContractDisabled(disabled);
        throw new Error(`${res.status}: ${disabled.code}: ${disabled.message}`);
      }

      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, "Failed to load full-length history");
      }
      return payload as FullLengthHistoryData;
    },
  });

  const reportPremiumReason = getPremiumDenialReason(reportError);
  const reviewPremiumReason = getPremiumDenialReason(reviewError);
  const historyPremiumReason = getPremiumDenialReason(historyError);
  const accessPremiumReason =
    historyData && !historyData.reportAccess.hasPaidAccess ? "premium_required" : null;
  const activePremiumReason =
    fullTestPremiumReason || reportPremiumReason || reviewPremiumReason || historyPremiumReason || accessPremiumReason;

  const reportErrorMessage = reportError instanceof Error ? reportError.message : "";
  const reportPremiumLocked = Boolean(reportPremiumReason);
  const reportLocked = reportErrorMessage.includes("423") || reportErrorMessage.toLowerCase().includes("locked");
  const reportNotFound = reportErrorMessage.includes("404");
  const reviewErrorMessage = reviewError instanceof Error ? reviewError.message : "";
  const reviewLocked = reviewErrorMessage.includes("423") || reviewErrorMessage.toLowerCase().includes("locked");
  const reviewNotFound = reviewErrorMessage.includes("404");
  const historyErrorMessage = historyError instanceof Error ? historyError.message : "";

  useEffect(() => {
    if (contractDisabled) return;
    const fromReport = parseRuntimeContractDisabledFromError("full-length", reportError);
    const fromReview = parseRuntimeContractDisabledFromError("full-length", reviewError);
    const fromHistory = parseRuntimeContractDisabledFromError("full-length", historyError);
    setContractDisabled(fromReport ?? fromReview ?? fromHistory ?? null);
  }, [contractDisabled, historyError, reportError, reviewError]);

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch("/api/full-length/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      const payload = await res.json().catch(() => null);
      const disabled = parseRuntimeContractDisabledFromPayload("full-length", res.status, payload);
      if (disabled) {
        setContractDisabled(disabled);
        throw new Error(`${disabled.code}: ${disabled.message}`);
      }

      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, "Failed to create exam session");
      }

      return payload;
    },
    onSuccess: (data) => {
      setFullTestPremiumReason(null);
      setSessionId(data.session.id);
      toast({
        title: "Exam Session Created",
        description: "Your full-length SAT exam is ready to begin.",
      });
    },
    onError: (error: Error) => {
      const disabled = parseRuntimeContractDisabledFromError("full-length", error);
      if (disabled) {
        setContractDisabled(disabled);
        return;
      }
      const premiumReason = getPremiumDenialReason(error);
      if (premiumReason) {
        setFullTestPremiumReason(premiumReason);
        return;
      }
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create exam session",
      });
    },
  });

  const startExamMutation = useMutation({
    mutationFn: async (sid: string) => {
      const res = await csrfFetch(`/api/full-length/sessions/${sid}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      const payload = await res.json().catch(() => null);
      const disabled = parseRuntimeContractDisabledFromPayload("full-length", res.status, payload);
      if (disabled) {
        setContractDisabled(disabled);
        throw new Error(`${disabled.code}: ${disabled.message}`);
      }

      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, "Failed to start exam");
      }

      return payload;
    },
    onSuccess: (_, sid) => {
      setFullTestPremiumReason(null);
      setIsStarted(true);
      setActiveSessionId(sid);
      window.history.pushState({}, "", `/full-test?sessionId=${sid}`);
      toast({
        title: "Exam Started",
        description: "Good luck. Begin with Reading & Writing Module 1.",
      });
    },
    onError: (error: Error) => {
      const disabled = parseRuntimeContractDisabledFromError("full-length", error);
      if (disabled) {
        setContractDisabled(disabled);
        return;
      }
      const premiumReason = getPremiumDenialReason(error);
      if (premiumReason) {
        setFullTestPremiumReason(premiumReason);
        return;
      }
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to start exam",
      });
    },
  });

  const handleCreateSession = () => {
    setFullTestPremiumReason(null);
    setReportSessionId(null);
    setReviewSessionId(null);
    createSessionMutation.mutate();
  };

  const handleStartExam = () => {
    if (sessionId) {
      startExamMutation.mutate(sessionId);
    }
  };

  const handleExitExam = () => {
    setIsStarted(false);
    setActiveSessionId(null);
    setSessionId(null);
    window.history.pushState({}, "", "/full-test");
  };

  const loadReportSessionById = (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      toast({
        variant: "destructive",
        title: "Session ID required",
        description: "Enter a full-length session ID to load report truth.",
      });
      return;
    }

    setReportSessionId(normalized);
    setReviewSessionId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("sessionId");
    params.set("reportSessionId", normalized);
    params.delete("reviewSessionId");
    window.history.pushState({}, "", `/full-test?${params.toString()}`);
  };

  const handleLoadReport = (event: React.FormEvent) => {
    event.preventDefault();
    loadReportSessionById(reportLookupSessionId);
  };

  const handleLoadReview = (sourceSessionId?: string) => {
    const sessionToLoad = (sourceSessionId ?? reportLookupSessionId).trim();
    if (!sessionToLoad) {
      toast({
        variant: "destructive",
        title: "Session ID required",
        description: "Enter a full-length session ID to load review truth.",
      });
      return;
    }

    setReportSessionId(sessionToLoad);
    setReviewSessionId(sessionToLoad);
    setReportLookupSessionId(sessionToLoad);
    const params = new URLSearchParams(window.location.search);
    params.delete("sessionId");
    params.set("reportSessionId", sessionToLoad);
    params.set("reviewSessionId", sessionToLoad);
    window.history.pushState({}, "", `/full-test?${params.toString()}`);
  };

  const handleClearReport = () => {
    setReportSessionId(null);
    setReviewSessionId(null);
    setReportLookupSessionId("");
    const params = new URLSearchParams(window.location.search);
    params.delete("reportSessionId");
    params.delete("reviewSessionId");
    params.delete("sessionId");
    const query = params.toString();
    window.history.pushState({}, "", query ? `/full-test?${query}` : "/full-test");
  };

  if (!authLoading && !user) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
          <div className="text-center py-14">
            <h1 className="text-3xl font-bold text-foreground mb-3">Full-Length SAT Exam</h1>
            <p className="text-muted-foreground mb-8">Please sign in to access full-length exam sessions.</p>
            <Button asChild>
              <Link href="/login">Log In</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (contractDisabled) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
          <RuntimeContractDisabledCard domain="full-length" code={contractDisabled.code} />
        </div>
      </AppShell>
    );
  }

  if (isStarted && activeSessionId) {
    return <ExamRunner sessionId={activeSessionId} onExit={handleExitExam} />;
  }

  if (sessionId && !isStarted) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
          <header className="mb-8">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Full-Length Exam Runner</p>
            <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
              Ready to Begin
            </h1>
            <p className="text-muted-foreground">Your server-authoritative exam session has been created.</p>
          </header>

          <PageCard title="Pre-Exam Checklist" className="bg-card/80 border-border/50 mb-8">
            <div className="rounded-xl bg-secondary/60 p-5 mb-6 text-sm text-foreground/90">
              <ul className="space-y-2">
                <li>Use a quiet environment and keep focus for the full run.</li>
                <li>Allow 2+ hours with a short break between sections.</li>
                <li>Keep scratch paper available; calculator appears in math modules.</li>
                <li>Your timing and progression are controlled by backend session truth.</li>
              </ul>
            </div>

            <div className="flex flex-wrap gap-3 justify-center">
              <Button
                size="lg"
                onClick={handleStartExam}
                disabled={startExamMutation.isPending}
                data-testid="button-confirm-start"
              >
                <Play className="h-5 w-5 mr-2" />
                {startExamMutation.isPending ? "Starting..." : "Start Exam Now"}
              </Button>
              <Button size="lg" variant="outline" onClick={() => setSessionId(null)} disabled={startExamMutation.isPending}>
                Cancel
              </Button>
            </div>
          </PageCard>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Assessment</p>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
            Full-Length SAT Test
          </h1>
          <p className="text-muted-foreground">Take a complete timed run under official structure and session controls.</p>
        </header>

        <section className="mb-8">
          <PageCard title="Exam Results Surface" className="bg-card/80 border-border/50">
            <p className="text-sm text-muted-foreground mb-4">
              Reopen full-length report truth by session ID or select from canonical runtime-backed history.
            </p>
            {historyLoading && (
              <p className="text-xs text-muted-foreground mb-4">Loading session history...</p>
            )}
            {historyError && !historyPremiumReason && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{historyErrorMessage}</AlertDescription>
              </Alert>
            )}
            {historyData && historyData.sessions.length > 0 && (
              <div className="mb-4 rounded-lg border border-border/50 bg-secondary/35 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-3">Recent completed sessions</p>
                <div className="space-y-2">
                  {historyData.sessions.map((session) => (
                    <div key={session.sessionId} className="flex flex-col gap-2 rounded-md border border-border/40 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium break-all">{session.sessionId}</p>
                        <p className="text-xs text-muted-foreground">
                          Status: {session.status} {session.completedAt ? `• Completed ${new Date(session.completedAt).toLocaleString()}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setReportLookupSessionId(session.sessionId);
                            loadReportSessionById(session.sessionId);
                          }}
                          disabled={!session.reportAvailable}
                        >
                          {session.reportAvailable ? "Open Report" : "Report Locked"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setReportLookupSessionId(session.sessionId);
                            handleLoadReview(session.sessionId);
                          }}
                          disabled={!session.reviewAvailable}
                        >
                          {session.reviewAvailable ? "Open Review" : "Review Locked"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {historyData && historyData.sessions.length === 0 && (
              <p className="text-xs text-muted-foreground mb-4">
                No completed sessions found yet. Complete one full-length exam to populate history.
              </p>
            )}
            <form onSubmit={handleLoadReport} className="flex flex-col sm:flex-row gap-3 mb-4">
              <Input
                value={reportLookupSessionId}
                onChange={(event) => setReportLookupSessionId(event.target.value.trim())}
                placeholder="Paste completed exam session ID"
                aria-label="Full-length report session ID"
              />
              <Button type="submit" variant="outline" disabled={!reportLookupSessionId || reportLoading}>
                {reportLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Load Report
                  </>
                )}
              </Button>
              <Button type="button" variant="outline" onClick={() => handleLoadReview()} disabled={!reportLookupSessionId || reviewLoading}>
                {reviewLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading Review...
                  </>
                ) : (
                  "Load Review"
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={handleClearReport} disabled={!reportSessionId && !reportLookupSessionId}>
                Clear
              </Button>
            </form>
            {activePremiumReason && (
              <div className="mb-4">
                <PremiumUpgradePrompt reason={activePremiumReason} mode="inline" />
              </div>
            )}

            {reportLocked && !reportPremiumLocked && (
              <Alert className="mb-4 border-amber-200 bg-amber-50">
                <AlertDescription className="text-amber-800">
                  This session is not completed yet. Reports unlock only after exam completion.
                </AlertDescription>
              </Alert>
            )}

            {reportNotFound && !reportPremiumLocked && !reportLocked && (
              <Alert className="mb-4">
                <AlertDescription>
                  No report was found for that session ID under your account. Verify the ID and try again.
                </AlertDescription>
              </Alert>
            )}

            {reportError && !reportPremiumLocked && !reportLocked && !reportNotFound && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  {(reportError as Error).message}
                </AlertDescription>
              </Alert>
            )}

            {reviewLocked && (
              <Alert className="mb-4 border-amber-200 bg-amber-50">
                <AlertDescription className="text-amber-800">
                  Review unlocks only after completion. This session does not have an unlocked review payload yet.
                </AlertDescription>
              </Alert>
            )}

            {reviewNotFound && !reviewLocked && (
              <Alert className="mb-4">
                <AlertDescription>
                  No review payload was found for that session ID under your account.
                </AlertDescription>
              </Alert>
            )}

            {reviewError && !reviewLocked && !reviewNotFound && !reviewPremiumReason && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  {(reviewError as Error).message}
                </AlertDescription>
              </Alert>
            )}

            {reportData && (
              <FullLengthResultsView
                data={reportData}
                title="Reusable Full-Length Report"
                description="This view reuses the same results surface as completion and is sourced from the persisted report endpoint."
                shareEnabled
                actions={
                  <>
                    <Button variant="outline" onClick={() => handleLoadReview(reportData.sessionId)}>
                      Open Review
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/dashboard">Open Dashboard KPIs</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/mastery">Open Mastery</Link>
                    </Button>
                  </>
                }
              />
            )}

            {reviewData && (
              <div className="mt-5">
                <FullLengthReviewView data={reviewData} />
              </div>
            )}
          </PageCard>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
          <PageCard title="Exam Overview" className="lg:col-span-8 bg-card/80 border-border/50">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-7">
              <div className="rounded-xl bg-secondary/60 p-4 text-center">
                <Clock className="h-5 w-5 mx-auto mb-2" />
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Duration</p>
                <p className="font-semibold">2h 14m + break</p>
              </div>
              <div className="rounded-xl bg-secondary/60 p-4 text-center">
                <FileText className="h-5 w-5 mx-auto mb-2" />
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Questions</p>
                <p className="font-semibold">98 total</p>
              </div>
              <div className="rounded-xl bg-secondary/60 p-4 text-center">
                <Users className="h-5 w-5 mx-auto mb-2" />
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Format</p>
                <p className="font-semibold">Adaptive digital</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-4 py-3">
                <div>
                  <p className="font-medium">Reading & Writing Module 1</p>
                  <p className="text-xs text-muted-foreground">27 questions</p>
                </div>
                <Badge>32 min</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-4 py-3">
                <div>
                  <p className="font-medium">Reading & Writing Module 2</p>
                  <p className="text-xs text-muted-foreground">27 questions (adaptive)</p>
                </div>
                <Badge>32 min</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-4 py-3">
                <div>
                  <p className="font-medium">Math Module 1</p>
                  <p className="text-xs text-muted-foreground">22 questions</p>
                </div>
                <Badge>35 min</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-4 py-3">
                <div>
                  <p className="font-medium">Math Module 2</p>
                  <p className="text-xs text-muted-foreground">22 questions (adaptive)</p>
                </div>
                <Badge>35 min</Badge>
              </div>
            </div>
          </PageCard>

          <PageCard title="Before You Begin" className="lg:col-span-4 bg-card/80 border-border/50">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 mb-5">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5" />
                <p className="text-sm">Complete the exam in one uninterrupted sitting whenever possible for the most reliable signal.</p>
              </div>
            </div>

            <Button
              size="lg"
              className="w-full"
              data-testid="button-start-full-test"
              onClick={handleCreateSession}
              disabled={createSessionMutation.isPending}
            >
              <Play className="h-5 w-5 mr-2" />
              {createSessionMutation.isPending ? "Creating Session..." : "Begin Full Test"}
            </Button>
          </PageCard>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          <PageCard title="Section Practice" className="bg-card/80 border-border/50">
            <p className="text-sm text-muted-foreground mb-4">Run shorter section-specific practice sessions when you do not have time for a full exam.</p>
            <div className="flex gap-2 mb-4">
              <Badge variant="outline">Math</Badge>
              <Badge variant="outline">Reading & Writing</Badge>
            </div>
            <Button asChild variant="outline" className="w-full" data-testid="button-section-practice">
              <Link href="/practice">Practice Sections</Link>
            </Button>
          </PageCard>

          <PageCard title="Performance Review" className="bg-card/80 border-border/50">
            <p className="text-sm text-muted-foreground mb-4">After completion, review section-level performance and progress trajectory in dashboard and mastery views.</p>
            <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              Live reporting sourced from exam runtime session records
            </div>
            <Button asChild variant="outline" className="w-full" data-testid="button-view-scores">
              <Link href="/dashboard">
                <CheckCircle2 className="h-4 w-4 mr-2" />
                View Dashboard
              </Link>
            </Button>
          </PageCard>
        </div>
      </div>
    </AppShell>
  );
}
