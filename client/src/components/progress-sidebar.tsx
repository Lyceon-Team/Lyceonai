import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, Shuffle, TrendingUp, Check, Upload, MessageSquare, Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { ProgressStats } from "@shared/schema";

export default function ProgressSidebar() {
  // Progress stats API - DISABLED (endpoint not implemented)
  const { data: progressStats } = useQuery<ProgressStats>({
    queryKey: ['/api/progress'],
    enabled: false, // Disable until endpoint is implemented
  });
  
  // Check if user is authenticated for admin access
  const { data: authData } = useQuery({
    queryKey: ['/auth/user'],
    queryFn: async () => {
      const response = await fetch('/auth/user');
      return response.json();
    }
  });

  const recentActivities = [
    {
      id: '1',
      type: 'complete',
      title: 'Completed Math Section 3',
      time: '2 hours ago',
      icon: Check
    },
    {
      id: '2',
      type: 'upload',
      title: 'Uploaded new practice test',
      time: 'Yesterday',
      icon: Upload
    },
    {
      id: '3',
      type: 'chat',
      title: 'Asked tutor about geometry',
      time: '2 days ago',
      icon: MessageSquare
    }
  ];

  const getActivityIconColor = (type: string) => {
    switch (type) {
      case 'complete':
        return 'bg-primary/10 text-primary';
      case 'upload':
        return 'bg-secondary/10 text-secondary';
      case 'chat':
        return 'bg-accent/10 text-accent';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card data-testid="card-progress-overview">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-card-foreground mb-4">
            Your Progress
          </h3>
          
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-foreground">Math Section</span>
                <span 
                  className="text-sm text-muted-foreground"
                  data-testid="text-math-progress"
                >
                  {Math.round(progressStats?.mathProgress || 0)}%
                </span>
              </div>
              <Progress 
                value={progressStats?.mathProgress || 0} 
                className="h-2"
                data-testid="progress-math"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-foreground">Reading & Writing</span>
                <span 
                  className="text-sm text-muted-foreground"
                  data-testid="text-reading-progress"
                >
                  {Math.round(progressStats?.readingProgress || 0)}%
                </span>
              </div>
              <Progress 
                value={progressStats?.readingProgress || 0} 
                className="h-2 [&>div]:bg-secondary"
                data-testid="progress-reading"
              />
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-border">
            <div className="text-center">
              <div 
                className="text-2xl font-bold text-foreground"
                data-testid="text-total-questions"
              >
                {progressStats?.totalQuestions?.toLocaleString() || '0'}
              </div>
              <div className="text-sm text-muted-foreground">Questions Practiced</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card data-testid="card-quick-actions">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-card-foreground mb-4">
            Quick Actions
          </h3>
          
          <div className="space-y-3">
            <Button asChild className="w-full justify-center space-x-2">
              <Link href="/practice" data-testid="button-start-practice-test">
                <Play className="h-4 w-4" />
                <span>Start Practice Test</span>
              </Link>
            </Button>
            
            <Button 
              variant="secondary"
              className="w-full justify-center space-x-2"
              asChild
            >
              <Link href="/practice/random" data-testid="button-random-questions">
                <Shuffle className="h-4 w-4" />
                <span>Random Questions</span>
              </Link>
            </Button>
            
            <Button 
              variant="outline"
              className="w-full justify-center space-x-2"
              data-testid="button-view-analytics"
            >
              <TrendingUp className="h-4 w-4" />
              <span>View Analytics</span>
            </Button>
            
            {/* Admin Panel - only show for authenticated users */}
            {authData?.authenticated && (
              <Button 
                variant="ghost"
                className="w-full justify-center space-x-2 text-muted-foreground hover:text-foreground"
                asChild
              >
                <Link href="/admin" data-testid="button-admin-questions">
                  <Settings className="h-4 w-4" />
                  <span>Admin Panel</span>
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card data-testid="card-recent-activity">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-card-foreground mb-4">
            Recent Activity
          </h3>
          
          <div className="space-y-3">
            {recentActivities.map((activity) => {
              const IconComponent = activity.icon;
              return (
                <div 
                  key={activity.id}
                  className="flex items-center space-x-3"
                  data-testid={`activity-item-${activity.id}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getActivityIconColor(activity.type)}`}>
                    <IconComponent className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p 
                      className="text-sm font-medium text-foreground"
                      data-testid={`text-activity-title-${activity.id}`}
                    >
                      {activity.title}
                    </p>
                    <p 
                      className="text-xs text-muted-foreground"
                      data-testid={`text-activity-time-${activity.id}`}
                    >
                      {activity.time}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
