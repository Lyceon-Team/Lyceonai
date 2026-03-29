import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Redirect } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Users, Plus, Clock, Target, AlertCircle, CheckCircle, UserMinus, RefreshCw, AlertTriangle, Calendar, CreditCard, Search, Loader2 } from 'lucide-react';
import { Link } from 'wouter';
import { SubscriptionPaywall, ManageSubscriptionButton } from '@/components/guardian/SubscriptionPaywall';
import FullLengthResultsView, { type FullLengthResultsData } from '@/components/full-length-exam/FullLengthResultsView';

interface LinkedStudent {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

interface StudentSummary {
  student: {
    id: string;
    displayName: string | null;
  };
  progress: {
    practiceMinutesLast7Days: number;
    sessionsLast7Days: number;
    questionsAttempted: number;
    accuracy: number | null;
  };
  metrics?: Array<{
    id: string;
    label: string;
    kind: 'official' | 'weighted' | 'diagnostic';
    unit: 'count' | 'percent' | 'minutes' | 'seconds' | 'score';
    value: number | null;
    explanation?: {
      whatThisMeans?: string;
    };
  }>;
}

interface GuardianWeaknessResponse {
  ok: true;
  count: number;
  skills: Array<{
    section: string;
    domain: string | null;
    skill: string;
    attempts: number;
    correct: number;
    accuracy: number;
    mastery_score: number;
  }>;
}

interface GuardianFullLengthReportResponse {
  studentId: string;
  sessionId: string;
  report: FullLengthResultsData;
}

interface GuardianFullLengthHistorySession {
  sessionId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  reportAvailable: boolean;
  reviewAvailable: boolean;
}

interface GuardianFullLengthHistoryResponse {
  studentId: string;
  sessions: GuardianFullLengthHistorySession[];
}

interface GuardianBillingStatus {
  isPaid: boolean;
  effectiveAccess: boolean;
  hasLinkedStudent?: boolean;
  linkRequiredForPremium?: boolean;
}

export default function GuardianDashboard() {
  const { isGuardian, isAuthenticated, authLoading } = useSupabaseAuth();
  const queryClient = useQueryClient();
  const [linkCode, setLinkCode] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [unlinkStudentId, setUnlinkStudentId] = useState<string | null>(null);
  const [unlinkStudentName, setUnlinkStudentName] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [reportSessionInput, setReportSessionInput] = useState('');
  const [requestedReportSessionId, setRequestedReportSessionId] = useState<string | null>(null);

  const { data: studentsData, isLoading: studentsLoading, error: studentsError, refetch: refetchStudents } = useQuery({
    queryKey: ['guardian-students'],
    queryFn: async () => {
      const res = await fetch('/api/guardian/students', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch students');
      return res.json() as Promise<{ students: LinkedStudent[] }>;
    },
    enabled: isGuardian && isAuthenticated,
  });

  const { data: summaryData, isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ['guardian-student-summary', selectedStudentId],
    queryFn: async () => {
      const res = await fetch(`/api/guardian/students/${selectedStudentId}/summary`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch summary');
      }
      return res.json() as Promise<StudentSummary>;
    },
    enabled: !!selectedStudentId,
  });

  const {
    data: weaknessData,
    isLoading: weaknessLoading,
    error: weaknessError,
    refetch: refetchWeakness,
  } = useQuery({
    queryKey: ['guardian-weaknesses', selectedStudentId],
    queryFn: async () => {
      const res = await fetch(`/api/guardian/weaknesses/${selectedStudentId}?limit=8&minAttempts=1`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load weaknesses');
      }
      return res.json() as Promise<GuardianWeaknessResponse>;
    },
    enabled: !!selectedStudentId,
  });

  const {
    data: guardianExamHistoryData,
    isLoading: guardianExamHistoryLoading,
    error: guardianExamHistoryError,
  } = useQuery<GuardianFullLengthHistoryResponse>({
    queryKey: ['guardian-full-length-history', selectedStudentId],
    queryFn: async () => {
      if (!selectedStudentId) {
        throw new Error('Select student first');
      }

      const res = await fetch(
        `/api/guardian/students/${selectedStudentId}/exams/full-length/sessions?limit=12&include_incomplete=true`,
        { credentials: 'include' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`${res.status}: ${data.error || 'Failed to load full-length history'}`);
      }
      return data as GuardianFullLengthHistoryResponse;
    },
    enabled: !!selectedStudentId,
    retry: false,
  });

  const {
    data: guardianExamReportData,
    isLoading: guardianExamReportLoading,
    error: guardianExamReportError,
  } = useQuery<GuardianFullLengthReportResponse>({
    queryKey: ['guardian-full-length-report', selectedStudentId, requestedReportSessionId],
    queryFn: async () => {
      if (!selectedStudentId || !requestedReportSessionId) {
        throw new Error('Select student and session ID first');
      }

      const res = await fetch(
        `/api/guardian/students/${selectedStudentId}/exams/full-length/${encodeURIComponent(requestedReportSessionId)}/report`,
        { credentials: 'include' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`${res.status}: ${data.error || 'Failed to load full-length report'}`);
      }
      return data as GuardianFullLengthReportResponse;
    },
    enabled: !!selectedStudentId && !!requestedReportSessionId,
    retry: false,
  });

  useEffect(() => {
    setRequestedReportSessionId(null);
    setReportSessionInput('');
  }, [selectedStudentId]);

  const { data: billingStatus } = useQuery({
    queryKey: ['guardian-billing-status'],
    queryFn: async () => {
      const res = await fetch('/api/billing/status', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch billing status');
      return res.json() as Promise<GuardianBillingStatus>;
    },
    enabled: isGuardian && isAuthenticated,
    retry: 1,
  });
  const linkMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch('/api/guardian/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to link student');
      return data;
    },
    onSuccess: (data) => {
      setLinkSuccess(`Successfully linked to ${data.student?.display_name || 'student'}!`);
      setLinkCode('');
      setLinkError(null);
      setIsRateLimited(false);
      setLastUpdated(new Date());
      queryClient.invalidateQueries({ queryKey: ['guardian-students'] });
    },
    onError: (err: Error) => {
      if (err.message.includes('Too many') || err.message.includes('rate limit')) {
        setIsRateLimited(true);
        setLinkError('Too many link attempts. Please wait 15 minutes before trying again.');
      } else {
        setLinkError(err.message);
      }
      setLinkSuccess(null);
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const res = await fetch(`/api/guardian/link/${studentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to unlink student');
      return data;
    },
    onSuccess: () => {
      setUnlinkStudentId(null);
      setUnlinkStudentName('');
      if (selectedStudentId === unlinkStudentId) {
        setSelectedStudentId(null);
      }
      queryClient.invalidateQueries({ queryKey: ['guardian-students'] });
    },
    onError: (err: Error) => {
      setLinkError(err.message);
      setUnlinkStudentId(null);
    },
  });

  const handleLink = (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError(null);
    setLinkSuccess(null);
    if (!linkCode.trim()) {
      setLinkError('Please enter a student link code');
      return;
    }
    linkMutation.mutate(linkCode.trim());
  };

  const handleUnlinkClick = (student: LinkedStudent) => {
    setUnlinkStudentId(student.id);
    setUnlinkStudentName(student.display_name || student.email.split('@')[0]);
  };

  const confirmUnlink = () => {
    if (unlinkStudentId) {
      unlinkMutation.mutate(unlinkStudentId);
    }
  };

  const handleLoadGuardianExamReport = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = reportSessionInput.trim();
    if (!normalized) {
      setRequestedReportSessionId(null);
      return;
    }
    setRequestedReportSessionId(normalized);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center">
        <div className="text-[#0F2E48]">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (!isGuardian) {
    return <Redirect to="/dashboard" />;
  }

  const students = studentsData?.students || [];
  const showPaidUnlinkedCta = !!billingStatus?.linkRequiredForPremium && !!billingStatus?.isPaid;
  const showUnlinkedLinkFirstHint = !!billingStatus?.linkRequiredForPremium && !billingStatus?.isPaid;
  const guardianExamReportErrorMessage = guardianExamReportError instanceof Error ? guardianExamReportError.message : '';
  const guardianReportNotFound = guardianExamReportErrorMessage.includes('404');
  const guardianReportLocked = guardianExamReportErrorMessage.includes('423');
  const guardianExamHistoryErrorMessage = guardianExamHistoryError instanceof Error ? guardianExamHistoryError.message : '';

  return (
    <SubscriptionPaywall>
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-8">
            <div className="flex items-center gap-3 min-w-0">
              <Users className="h-8 w-8 text-[#0F2E48]" />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0F2E48]/60 mb-1">Guardian Portal</p>
                <h1 className="text-3xl font-bold text-[#0F2E48] tracking-tight">Student Performance Data</h1>
                <p className="text-[#0F2E48]/60 text-sm">Read-only reporting from linked student runtime records.</p>
              </div>
            </div>
            <ManageSubscriptionButton />
          </div>

          {showPaidUnlinkedCta && (
            <Alert className="border-[#0F2E48]/20 bg-[#0F2E48]/5">
              <CreditCard className="h-4 w-4 text-[#0F2E48]" />
              <AlertDescription className="text-[#0F2E48]">
                <div className="font-medium">Your subscription is active.</div>
                <div className="text-sm text-[#0F2E48]/80">
                  Link your student to unlock guardian progress, KPI, and calendar views.
                </div>
              </AlertDescription>
            </Alert>
          )}

          {showUnlinkedLinkFirstHint && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-800">
                Link your student first, then choose a subscription to unlock premium guardian views.
              </AlertDescription>
            </Alert>
          )}

          {students.length === 0 && (
            <Card className="bg-card border-border/60">
              <CardHeader>
                <CardTitle className="text-[#0F2E48]">Connection Required</CardTitle>
                <CardDescription>
                  Enter a valid 8-character student link code to activate guardian reporting.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-3 text-sm text-[#0F2E48]/80">
                <div className="rounded-lg bg-secondary/50 p-3">
                  Progress summaries appear after a student is linked.
                </div>
                <div className="rounded-lg bg-secondary/50 p-3">
                  Calendar access is read-only and respects student ownership.
                </div>
              </CardContent>
            </Card>
          )}

        <Card className="bg-card border-border/60">
          <CardHeader>
            <CardTitle className="text-[#0F2E48] flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Link a Student
            </CardTitle>
            <CardDescription>
              Enter the 8-character code from your student's profile page to connect
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLink} className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <Label htmlFor="linkCode" className="sr-only">Student Link Code</Label>
                <Input
                  id="linkCode"
                  placeholder="Enter 8-character code (e.g., ABC12345)"
                  value={linkCode}
                  onChange={(e) => setLinkCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                  className="uppercase font-mono tracking-wider"
                  maxLength={8}
                />
              </div>
              <Button 
                type="submit" 
                disabled={linkMutation.isPending || linkCode.length !== 8}
                className="bg-[#0F2E48] hover:bg-[#0F2E48]/90 sm:w-auto w-full"
              >
                {linkMutation.isPending ? 'Linking...' : 'Link Student'}
              </Button>
            </form>
            {linkError && (
              <Alert variant={isRateLimited ? 'default' : 'destructive'} className={`mt-4 ${isRateLimited ? 'bg-amber-50 border-amber-200' : ''}`}>
                {isRateLimited ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <AlertDescription className={isRateLimited ? 'text-amber-800' : ''}>
                  {linkError}
                </AlertDescription>
              </Alert>
            )}
            {linkSuccess && (
              <Alert className="mt-4 bg-green-50 border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">{linkSuccess}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/60">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-[#0F2E48]">Linked Students</CardTitle>
              <div className="flex items-center gap-2">
                {lastUpdated && (
                  <span className="text-xs text-[#0F2E48]/50">
                    Updated {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    refetchStudents();
                    setLastUpdated(new Date());
                  }}
                  className="text-[#0F2E48]/60 hover:text-[#0F2E48]"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <CardDescription>
              {students.length === 0 
                ? 'No students linked yet. Use the form above to link a student.'
                : `${students.length} student${students.length !== 1 ? 's' : ''} linked`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {studentsLoading ? (
              <div className="text-center py-8 text-[#0F2E48]/60">Loading students...</div>
            ) : studentsError ? (
              <div className="text-center py-8">
                <p className="text-red-600 mb-4">Failed to load students</p>
                <Button variant="outline" onClick={() => refetchStudents()}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Retry
                </Button>
              </div>
            ) : students.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Users className="h-12 w-12 text-[#0F2E48]/30 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-[#0F2E48] mb-2">No students linked yet</h3>
                <p className="text-[#0F2E48]/60 max-w-sm mx-auto">
                  Ask your student for their 8-character link code from their Profile page, then enter it above.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {students.map((student) => (
                  <div
                    key={student.id}
                    className={`p-4 rounded-lg border transition-colors ${
                      selectedStudentId === student.id
                        ? 'bg-[#0F2E48] text-white border-[#0F2E48]'
                        : 'bg-secondary/50 border-[#0F2E48]/20 hover:border-[#0F2E48]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setSelectedStudentId(student.id)}
                        className="flex-1 text-left"
                      >
                        <div className="font-medium">
                          {student.display_name || student.email.split('@')[0]}
                        </div>
                        <div className={`text-sm ${selectedStudentId === student.id ? 'text-white/70' : 'text-[#0F2E48]/60'}`}>
                          {student.email}
                        </div>
                      </button>
                      <Link href={`/guardian/students/${student.id}/calendar`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => e.stopPropagation()}
                          className={`ml-1 ${selectedStudentId === student.id ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-[#0F2E48]/60 hover:text-[#0F2E48]'}`}
                          title="View Calendar"
                        >
                          <Calendar className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnlinkClick(student);
                        }}
                        className={`ml-1 ${selectedStudentId === student.id ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-[#0F2E48]/60 hover:text-red-600'}`}
                        title="Unlink Student"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedStudentId && (
          <>
            <Card className="bg-card border-border/60">
              <CardHeader>
                <CardTitle className="text-[#0F2E48]">Student Progress</CardTitle>
                <CardDescription>
                  {summaryData?.student?.displayName || 'Student'}'s activity in the last 7 days
                </CardDescription>
              </CardHeader>
              <CardContent>
                {summaryLoading ? (
                  <div className="text-center py-8 text-[#0F2E48]/60">Loading progress...</div>
                ) : summaryError ? (
                  <div className="text-center py-8">
                    <p className="text-red-600 mb-4">Failed to load progress data</p>
                    <Button variant="outline" onClick={() => refetchSummary()}>
                      <RefreshCw className="h-4 w-4 mr-2" /> Retry
                    </Button>
                  </div>
                ) : summaryData ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-[#FFFAEF] p-4 rounded-lg text-center">
                        <Clock className="h-5 w-5 text-[#0F2E48]/60 mx-auto mb-2" />
                        <div className="text-2xl font-bold text-[#0F2E48]">
                          {summaryData.progress.practiceMinutesLast7Days}
                        </div>
                        <div className="text-xs text-[#0F2E48]/60">Minutes Practiced</div>
                      </div>
                      <div className="bg-[#FFFAEF] p-4 rounded-lg text-center">
                        <Target className="h-5 w-5 text-[#0F2E48]/60 mx-auto mb-2" />
                        <div className="text-2xl font-bold text-[#0F2E48]">
                          {summaryData.progress.sessionsLast7Days}
                        </div>
                        <div className="text-xs text-[#0F2E48]/60">Practice Sessions</div>
                      </div>
                      <div className="bg-[#FFFAEF] p-4 rounded-lg text-center">
                        <div className="h-5 w-5 text-[#0F2E48]/60 mx-auto mb-2 flex items-center justify-center font-bold">Q</div>
                        <div className="text-2xl font-bold text-[#0F2E48]">
                          {summaryData.progress.questionsAttempted}
                        </div>
                        <div className="text-xs text-[#0F2E48]/60">Questions Attempted</div>
                      </div>
                      <div className="bg-[#FFFAEF] p-4 rounded-lg text-center">
                        <div className="h-5 w-5 text-[#0F2E48]/60 mx-auto mb-2 flex items-center justify-center font-bold">%</div>
                        <div className="text-2xl font-bold text-[#0F2E48]">
                          {summaryData.progress.accuracy !== null ? `${summaryData.progress.accuracy}%` : '--'}
                        </div>
                        <div className="text-xs text-[#0F2E48]/60">Accuracy</div>
                      </div>
                    </div>
                    {summaryData.metrics && summaryData.metrics.length > 0 && (
                      <div className="grid sm:grid-cols-2 gap-3">
                        {summaryData.metrics.slice(0, 4).map((metric) => (
                          <div key={metric.id} className="rounded-lg border border-border/60 bg-secondary/35 p-3">
                            <p className="text-sm font-medium text-[#0F2E48]">{metric.label}</p>
                            <p className="text-xs text-[#0F2E48]/65 mt-1">{metric.explanation?.whatThisMeans || 'Runtime-backed KPI metric'}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {summaryData.progress.sessionsLast7Days === 0 && (
                      <div className="text-center py-4 px-6 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-amber-800 text-sm">
                          No practice activity in the last 7 days. Encourage your student to start a practice session.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 px-4">
                    <AlertCircle className="h-12 w-12 text-[#0F2E48]/30 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-[#0F2E48] mb-2">No Progress Data Available</h3>
                    <p className="text-[#0F2E48]/60 max-w-sm mx-auto">
                      Unable to load progress data for this student. This may be because the student hasn't started any practice sessions yet.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border/60">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-[#0F2E48]">Weakest Skills (Live)</CardTitle>
                    <CardDescription>
                      Runtime-backed weaknesses from `/api/guardian/weaknesses/:studentId`.
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => refetchWeakness()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {weaknessLoading ? (
                  <div className="text-center py-8 text-[#0F2E48]/60">Loading weaknesses...</div>
                ) : weaknessError ? (
                  <div className="text-center py-8">
                    <p className="text-red-600 mb-4">Failed to load weakness data</p>
                    <Button variant="outline" onClick={() => refetchWeakness()}>
                      <RefreshCw className="h-4 w-4 mr-2" /> Retry
                    </Button>
                  </div>
                ) : !weaknessData || weaknessData.count === 0 ? (
                  <div className="rounded-lg bg-[#FFFAEF] p-4 text-sm text-[#0F2E48]/70">
                    No weakness rows are currently available for this student.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {weaknessData.skills.map((skill) => (
                      <div key={`${skill.section}-${skill.skill}`} className="rounded-lg border border-border/60 bg-secondary/35 p-3">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <p className="text-sm font-medium text-[#0F2E48]">{skill.skill}</p>
                          <p className="text-sm font-semibold text-[#0F2E48]">{skill.mastery_score}%</p>
                        </div>
                        <div className="text-xs text-[#0F2E48]/65 flex items-center justify-between gap-2">
                          <span>{skill.section} · {skill.domain || 'Unspecified domain'}</span>
                          <span>{skill.correct}/{skill.attempts} correct</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border/60">
              <CardHeader>
                <CardTitle className="text-[#0F2E48]">Full-Length Exam Report</CardTitle>
                <CardDescription>
                  Load guardian read-only report projection using a real exam session ID.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {guardianExamHistoryLoading && (
                  <p className="text-sm text-[#0F2E48]/70">Loading full-length session history...</p>
                )}
                {guardianExamHistoryError && (
                  <Alert variant="destructive">
                    <AlertDescription>{guardianExamHistoryErrorMessage}</AlertDescription>
                  </Alert>
                )}
                {guardianExamHistoryData && guardianExamHistoryData.sessions.length > 0 && (
                  <div className="rounded-lg border border-border/60 bg-secondary/35 p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#0F2E48]/60 mb-3">Linked student session history</p>
                    <div className="space-y-2">
                      {guardianExamHistoryData.sessions.map((session) => (
                        <div key={session.sessionId} className="rounded-md border border-border/50 bg-card/80 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium text-[#0F2E48] break-all">{session.sessionId}</p>
                            <p className="text-xs text-[#0F2E48]/65">
                              Status: {session.status}{' '}
                              {session.completedAt ? `• Completed ${new Date(session.completedAt).toLocaleString()}` : ''}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReportSessionInput(session.sessionId);
                              setRequestedReportSessionId(session.sessionId);
                            }}
                            disabled={!session.reportAvailable}
                          >
                            {session.reportAvailable ? 'Open Report' : 'Report Locked'}
                          </Button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-[#0F2E48]/60 mt-3">
                      Guardian review is not mounted for full-length exams yet; history remains report-only.
                    </p>
                  </div>
                )}
                {guardianExamHistoryData && guardianExamHistoryData.sessions.length === 0 && (
                  <p className="text-sm text-[#0F2E48]/70">
                    No full-length sessions are available yet for this linked student.
                  </p>
                )}

                <form onSubmit={handleLoadGuardianExamReport} className="flex flex-col sm:flex-row gap-3">
                  <Input
                    value={reportSessionInput}
                    onChange={(event) => setReportSessionInput(event.target.value.trim())}
                    placeholder="Enter student full-length session ID"
                    aria-label="Guardian exam report session ID"
                  />
                  <Button type="submit" variant="outline" disabled={!reportSessionInput || guardianExamReportLoading}>
                    {guardianExamReportLoading ? (
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
                </form>

                {guardianReportLocked && (
                  <Alert className="border-amber-200 bg-amber-50">
                    <AlertDescription className="text-amber-800">
                      This exam session is not completed yet, so guardian report projection is still locked.
                    </AlertDescription>
                  </Alert>
                )}

                {guardianReportNotFound && !guardianReportLocked && (
                  <Alert>
                    <AlertDescription>
                      No full-length report was found for that session ID under the linked student.
                    </AlertDescription>
                  </Alert>
                )}

                {guardianExamReportError && !guardianReportNotFound && !guardianReportLocked && (
                  <Alert variant="destructive">
                    <AlertDescription>{guardianExamReportErrorMessage}</AlertDescription>
                  </Alert>
                )}

                {guardianExamReportData?.report && (
                  <FullLengthResultsView
                    data={guardianExamReportData.report}
                    title="Guardian Report Projection"
                    description="Read-only student-truth projection from `/api/guardian/students/:studentId/exams/full-length/:sessionId/report`."
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <AlertDialog open={!!unlinkStudentId} onOpenChange={() => setUnlinkStudentId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink Student</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unlink {unlinkStudentName}? You will no longer be able to view their progress. You can re-link them later using their code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinkMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmUnlink}
              disabled={unlinkMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {unlinkMutation.isPending ? 'Unlinking...' : 'Unlink'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
        </AlertDialog>
      </div>
    </SubscriptionPaywall>
  );
}

