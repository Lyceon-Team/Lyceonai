import { useState, useEffect } from 'react';
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
import { Users, Plus, Clock, Target, AlertCircle, CheckCircle, UserMinus, RefreshCw, AlertTriangle, Calendar, CreditCard } from 'lucide-react';
import { Link } from 'wouter';
import { SubscriptionPaywall, ManageSubscriptionButton } from '@/components/guardian/SubscriptionPaywall';

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
    email: string;
  };
  progress: {
    practiceMinutesLast7Days: number;
    sessionsLast7Days: number;
    questionsAttempted: number;
    accuracy: number | null;
  };
}

export default function GuardianDashboard() {
  const { user, isGuardian, isAuthenticated, authLoading } = useSupabaseAuth();
  const queryClient = useQueryClient();
  const [linkCode, setLinkCode] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [unlinkStudentId, setUnlinkStudentId] = useState<string | null>(null);
  const [unlinkStudentName, setUnlinkStudentName] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);

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

  return (
    <SubscriptionPaywall>
      <div className="min-h-screen bg-[#FFFAEF] p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3 mb-8">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-[#0F2E48]" />
              <div>
                <h1 className="text-3xl font-bold text-[#0F2E48]">Guardian Dashboard</h1>
                <p className="text-[#0F2E48]/60 text-sm">Monitor your student's SAT preparation progress</p>
              </div>
            </div>
            <ManageSubscriptionButton />
          </div>

        <Card className="bg-white border-[#0F2E48]/10">
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
            <form onSubmit={handleLink} className="flex gap-4">
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
                className="bg-[#0F2E48] hover:bg-[#0F2E48]/90"
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

        <Card className="bg-white border-[#0F2E48]/10">
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
                        : 'bg-[#FFFAEF] border-[#0F2E48]/20 hover:border-[#0F2E48]/40'
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
          <Card className="bg-white border-[#0F2E48]/10">
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
                  {summaryData.progress.sessionsLast7Days === 0 && (
                    <div className="text-center py-4 px-6 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-amber-800 text-sm">
                        No practice activity in the last 7 days. Encourage your student to start a practice session!
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
