import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import Navigation from "@/components/navigation";
import TestOptions from "@/components/test-options";
import FloatingActions from "@/components/floating-actions";
import QuestionCard from "@/components/question-card";
import ProgressSidebar from "@/components/progress-sidebar";
import { AnalyticsModal } from "@/components/AnalyticsModal";
import { ScoreProjectionCard } from "@/components/progress/ScoreProjectionCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Award, Clock, BookOpen, Flame } from "lucide-react";
import { getCalendarMonth } from "@/lib/calendarApi";
import { DateTime } from "luxon";

interface Question {
  id: string;
  questionNumber: number;
  section: string;
  stem: string;
  difficulty: string;
  pageNumber?: number;
  documentName: string;
}

interface ProgressData {
  totalQuestions: number;
  mathProgress: number;
  readingProgress: number;
  currentScore: number;
  improvement: number;
  overallProgress: number;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [isAnalyticsModalOpen, setIsAnalyticsModalOpen] = useState(false);

  // Handle hash-based modal opening for Progress navigation
  useEffect(() => {
    if (window.location.hash === '#analytics') {
      setIsAnalyticsModalOpen(true);
      // Clear the hash to clean up URL
      window.history.replaceState(null, '', '/');
    }
  }, []);

  const { data: recentQuestions, isLoading: questionsLoading } = useQuery<Question[]>({
    queryKey: ['/api/questions/recent'],
    refetchInterval: 10000, // Refetch every 10 seconds to pick up newly processed questions
  });
  
  const { data: progressData, isLoading: progressLoading } = useQuery<ProgressData>({
    queryKey: ['/api/progress'],
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const { data: calendarData, isLoading: streakLoading } = useQuery({
    queryKey: ['calendar-streak'],
    queryFn: async () => {
      const now = DateTime.local();
      const start = now.startOf('month').toISODate() ?? now.toISODate()!;
      const end = now.endOf('month').toISODate() ?? now.toISODate()!;
      return getCalendarMonth(start, end);
    },
    refetchInterval: 60000,
  });

  const handleQuestionClick = (question: Question) => {
    console.log('Question clicked:', question);
    navigate(`/practice?question=${question.id}`);
  };

  const handleViewDetailsClick = () => {
    setIsAnalyticsModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-foreground mb-4" data-testid="text-welcome">
            Ready to ace your SAT?
          </h1>
          <p className="text-xl text-muted-foreground mb-8">
            Choose your preparation method and start improving your score today.
          </p>
          
          {/* Quick Stats */}
          <div className="flex justify-center gap-8 mb-8">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {progressLoading ? "--" : (progressData?.currentScore || 1200)}
              </div>
              <div className="text-sm text-muted-foreground">Current Score</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {progressLoading ? "--" : `+${progressData?.improvement || 0}`}
              </div>
              <div className="text-sm text-muted-foreground">Improvement</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {progressLoading ? "--" : `${Math.round((progressData?.overallProgress || 0) * 100)}%`}
              </div>
              <div className="text-sm text-muted-foreground">Progress</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-2xl font-bold text-orange-500">
                <Flame className="h-5 w-5" />
                {streakLoading ? "--" : (calendarData?.streak?.current || 0)}
              </div>
              <div className="text-sm text-muted-foreground">Day Streak</div>
            </div>
          </div>
        </div>

        {/* Main Test Options */}
        <div className="mb-12">
          <TestOptions />
        </div>

        {/* Score Projection */}
        <div className="mb-8">
          <ScoreProjectionCard />
        </div>

        {/* Secondary Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Performance Overview */}
          <div className="lg:col-span-2">
            <Card data-testid="card-performance-overview">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-card-foreground">
                    Performance Overview
                  </h3>
                  <Button variant="outline" size="sm" data-testid="button-view-detailed-stats" onClick={handleViewDetailsClick}>
                    <TrendingUp className="h-4 w-4 mr-2" />
                    View Details
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Math Score</span>
                      <span className="text-sm font-bold">
                        {progressLoading ? "--" : Math.round((progressData?.mathProgress || 0) * 800)}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className="bg-foreground h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(progressData?.mathProgress || 0) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Reading & Writing</span>
                      <span className="text-sm font-bold">
                        {progressLoading ? "--" : Math.round((progressData?.readingProgress || 0) * 800)}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className="bg-foreground/70 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(progressData?.readingProgress || 0) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="border-t pt-6">
                  <h4 className="text-sm font-semibold text-card-foreground mb-4">Recent Activity</h4>
                  {recentQuestions && recentQuestions.length > 0 ? (
                    <div className="space-y-3">
                      {recentQuestions.slice(0, 3).map((question) => (
                        <div key={question.id} className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
                             onClick={() => handleQuestionClick(question)}
                             data-testid={`recent-question-${question.id}`}>
                          <div className="p-2 bg-primary/10 rounded">
                            <BookOpen className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium">{question.section} - Question {question.questionNumber}</div>
                            <div className="text-xs text-muted-foreground">{question.documentName}</div>
                          </div>
                          <div className="text-xs px-2 py-1 bg-muted rounded">{question.difficulty}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6" data-testid="empty-state-recent-activity">
                      <div className="p-3 bg-muted rounded-full w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                        <Clock className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">No recent activity</p>
                      <p className="text-xs text-muted-foreground">Upload practice materials or start a test to track your progress</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <ProgressSidebar />
          </div>
        </div>
      </div>

      {/* Floating Actions */}
      <FloatingActions />

      {/* Analytics Modal */}
      <AnalyticsModal 
        isOpen={isAnalyticsModalOpen}
        onClose={() => setIsAnalyticsModalOpen(false)}
      />

      {/* Footer */}
      <footer className="bg-card border-t border-border mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Platform</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/" className="hover:text-foreground transition-colors">Dashboard</Link></li>
                <li><Link href="/practice" className="hover:text-foreground transition-colors">Practice Tests</Link></li>
                <li><button onClick={() => setIsAnalyticsModalOpen(true)} className="hover:text-foreground transition-colors text-left">Analytics</button></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/chat" className="hover:text-foreground transition-colors">AI Tutor</Link></li>
                <li><Link href="/practice/math" className="hover:text-foreground transition-colors">Math Practice</Link></li>
                <li><Link href="/practice/reading" className="hover:text-foreground transition-colors">Reading Practice</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Support</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/chat" className="hover:text-foreground transition-colors">Help Center</Link></li>
                <li><Link href="/chat" className="hover:text-foreground transition-colors">Contact Us</Link></li>
                <li><Link href="/practice" className="hover:text-foreground transition-colors">Practice Hub</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/" className="hover:text-foreground transition-colors">About</Link></li>
                <li><Link href="/" className="hover:text-foreground transition-colors">Privacy</Link></li>
                <li><Link href="/" className="hover:text-foreground transition-colors">Terms</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border mt-8 pt-8 text-center">
            <p className="text-sm text-muted-foreground">
              © 2024 SAT Learning Copilot. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
