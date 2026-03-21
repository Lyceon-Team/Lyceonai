import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, FileText, Users, Info, TrendingUp, Play, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import ExamRunner from "@/components/full-length-exam/ExamRunner";

export default function FullTest() {
  const { user, authLoading } = useSupabaseAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStarted, setIsStarted] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sessionId");
    if (sid) {
      setActiveSessionId(sid);
      setIsStarted(true);
    }
  }, []);

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/full-length/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create exam session");
      }

      return res.json();
    },
    onSuccess: (data) => {
      setSessionId(data.session.id);
      toast({
        title: "Exam Session Created",
        description: "Your full-length SAT exam is ready to begin.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create exam session",
      });
    },
  });

  const startExamMutation = useMutation({
    mutationFn: async (sid: string) => {
      const res = await fetch(`/api/full-length/sessions/${sid}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to start exam");
      }

      return res.json();
    },
    onSuccess: (_, sid) => {
      setIsStarted(true);
      setActiveSessionId(sid);
      window.history.pushState({}, "", `/full-test?sessionId=${sid}`);
      toast({
        title: "Exam Started",
        description: "Good luck. Begin with Reading & Writing Module 1.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to start exam",
      });
    },
  });

  const handleCreateSession = () => {
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
