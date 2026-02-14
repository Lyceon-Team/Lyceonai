import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Tag } from "@/components/common/tag";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, FileText, Users, Info, TrendingUp, Play, ArrowRight, CheckCircle2 } from "lucide-react";
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

  // Check for existing session on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('sessionId');
    if (sid) {
      setActiveSessionId(sid);
      setIsStarted(true);
    }
  }, []);

  // Mutation to create a new exam session
  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/full-length/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to create exam session');
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

  // Mutation to start the exam
  const startExamMutation = useMutation({
    mutationFn: async (sid: string) => {
      const res = await fetch(`/api/full-length/sessions/${sid}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to start exam');
      }
      
      return res.json();
    },
    onSuccess: (_, sid) => {
      setIsStarted(true);
      setActiveSessionId(sid);
      // Update URL to include sessionId for refresh support
      window.history.pushState({}, '', `/full-test?sessionId=${sid}`);
      toast({
        title: "Exam Started",
        description: "Good luck! Begin with Reading & Writing Module 1.",
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
    window.history.pushState({}, '', '/full-test');
  };

  // If not authenticated, show login prompt
  if (!authLoading && !user) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
          <div className="text-center py-12">
            <h1 className="text-3xl font-bold text-foreground mb-4">Full Length SAT Test</h1>
            <p className="text-muted-foreground mb-8">
              Please log in to access full-length practice tests
            </p>
            <Button asChild>
              <Link href="/login">
                Log In
              </Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // If exam is started, show exam runner
  if (isStarted && activeSessionId) {
    return <ExamRunner sessionId={activeSessionId} onExit={handleExitExam} />;
  }

  // If session created but not started, show start screen
  if (sessionId && !isStarted) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
              Ready to Begin
            </h1>
            <p className="text-muted-foreground">
              Your exam session is ready. Click Start when you're prepared.
            </p>
          </div>

          <PageCard title="Important Reminders" className="mb-8">
            <div className="p-4 rounded-lg bg-amber-50 mb-6">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-amber-600 " />
                <div>
                  <h4 className="font-semibold text-amber-800 mb-2">Before You Begin</h4>
                  <ul className="text-sm text-amber-700 space-y-1">
                    <li>• Find a quiet space with minimal distractions</li>
                    <li>• Ensure you have 3+ hours available (plus optional breaks)</li>
                    <li>• Have scratch paper and a calculator ready</li>
                    <li>• Close other browser tabs and applications</li>
                    <li>• Make sure you have a stable internet connection</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex gap-4 justify-center">
              <Button
                size="lg"
                onClick={handleStartExam}
                disabled={startExamMutation.isPending}
                data-testid="button-confirm-start"
              >
                <Play className="h-5 w-5 mr-2" />
                {startExamMutation.isPending ? 'Starting...' : 'Start Exam Now'}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setSessionId(null)}
                disabled={startExamMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </PageCard>
        </div>
      </AppShell>
    );
  }

  // Default: Show exam overview and create session button
  return (
    <AppShell>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="page-title">
            Full Length SAT Test
          </h1>
          <p className="text-muted-foreground">
            Take a complete practice test under realistic timed conditions
          </p>
        </div>

        {/* Test Information */}
        <PageCard
          title="Test Overview"
          description="Complete SAT Practice Test"
          className="mb-8"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="inline-flex p-3 rounded-full bg-blue-100 ">
                <Clock className="h-6 w-6 text-blue-600 " />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Duration</h3>
              <p className="text-sm text-muted-foreground">2 hours 14 minutes + break</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="inline-flex p-3 rounded-full bg-green-100 ">
                <FileText className="h-6 w-6 text-green-600 " />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Questions</h3>
              <p className="text-sm text-muted-foreground">98 total (54 RW + 44 Math)</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="inline-flex p-3 rounded-full bg-purple-100 ">
                <Users className="h-6 w-6 text-purple-600 " />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Format</h3>
              <p className="text-sm text-muted-foreground">Adaptive, Digital</p>
            </div>
          </div>

          {/* Test Structure */}
          <div className="mb-8">
            <h4 className="font-semibold text-foreground mb-4">Test Structure</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium text-foreground">Reading & Writing Module 1</p>
                  <p className="text-sm text-muted-foreground">27 questions</p>
                </div>
                <Badge>32 min</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium text-foreground">Reading & Writing Module 2</p>
                  <p className="text-sm text-muted-foreground">27 questions (adaptive)</p>
                </div>
                <Badge>32 min</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                <p className="font-medium text-amber-800">10-Minute Break</p>
                <Badge variant="outline">Optional</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium text-foreground">Math Module 1</p>
                  <p className="text-sm text-muted-foreground">22 questions</p>
                </div>
                <Badge>35 min</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium text-foreground">Math Module 2</p>
                  <p className="text-sm text-muted-foreground">22 questions (adaptive)</p>
                </div>
                <Badge>35 min</Badge>
              </div>
            </div>
          </div>

          {/* Before You Begin Info */}
          <div className="p-4 rounded-lg bg-amber-50 mb-6">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-amber-600 " />
              <div>
                <h4 className="font-semibold text-amber-800 mb-2">Before You Begin</h4>
                <ul className="text-sm text-amber-700 space-y-1">
                  <li>• Find a quiet space with minimal distractions</li>
                  <li>• Ensure you have 3+ hours available</li>
                  <li>• Have scratch paper and a calculator ready</li>
                  <li>• Close other browser tabs and applications</li>
                </ul>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="flex flex-col items-center gap-4">
            <Button 
              size="lg" 
              className="px-12" 
              data-testid="button-start-full-test"
              onClick={handleCreateSession}
              disabled={createSessionMutation.isPending}
            >
              <Play className="h-5 w-5 mr-2" />
              {createSessionMutation.isPending ? 'Creating Session...' : 'Begin Full Test'}
            </Button>
          </div>
        </PageCard>

        {/* Alternative Options */}
        <div className="grid sm:grid-cols-2 gap-6">
          <PageCard title="Section Practice">
            <p className="text-sm text-muted-foreground mb-4">
              Practice individual sections with timing (32-64 minutes per section)
            </p>
            <div className="flex gap-2 mb-4">
              <Tag variant="muted">Math</Tag>
              <Tag variant="muted">Reading</Tag>
              <Tag variant="muted">Writing</Tag>
            </div>
            <Button asChild variant="outline" className="w-full" data-testid="button-section-practice">
              <Link href="/practice">
                Practice Sections
              </Link>
            </Button>
          </PageCard>

          <PageCard title="Test History">
            <p className="text-sm text-muted-foreground mb-4">
              View your previous test scores and track your improvement over time
            </p>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-green-600 " />
              <span className="text-sm text-green-600 ">
                Track your progress
              </span>
            </div>
            <Button asChild variant="outline" className="w-full" data-testid="button-view-scores">
              <Link href="/dashboard">
                View Test History
              </Link>
            </Button>
          </PageCard>
        </div>
      </div>
    </AppShell>
  );
}
