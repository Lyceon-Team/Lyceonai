import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  BookOpen,
  CheckCircle,
  XCircle,
  BarChart3,
  Calendar,
  Award,
  AlertCircle,
  Lightbulb
} from "lucide-react";

interface DetailedProgressStats {
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number;
  mathStats: SectionStats;
  readingStats: SectionStats;
  writingStats: SectionStats;
  recentActivity: AttemptHistory[];
  performanceTrends: PerformanceTrend[];
  strengthsWeaknesses: StrengthsWeaknesses;
}

interface SectionStats {
  section: string;
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number;
  easyQuestions: DifficultyStats;
  mediumQuestions: DifficultyStats;
  hardQuestions: DifficultyStats;
}

interface DifficultyStats {
  difficulty: string;
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number;
}

interface AttemptHistory {
  id: string;
  questionId: string;
  questionText: string;
  section: string;
  difficulty: string;
  isCorrect: boolean;
  attemptedAt: Date;
  documentName: string;
}

interface PerformanceTrend {
  date: string;
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number;
  mathAccuracy: number;
  readingAccuracy: number;
  writingAccuracy: number;
}

interface StrengthsWeaknesses {
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AnalyticsModal({ isOpen, onClose }: AnalyticsModalProps) {
  const [activeTab, setActiveTab] = useState("overview");

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ['/api/analytics/detailed'],
    enabled: isOpen,
    staleTime: 1000 * 60 * 5 // 5 minutes
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['/api/analytics/history'],
    enabled: isOpen && activeTab === 'history',
    staleTime: 1000 * 60 * 5 // 5 minutes
  });

  const stats = (analyticsData as any)?.data as DetailedProgressStats | undefined;
  const history = (historyData as any)?.data as AttemptHistory[] | undefined;

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 80) return "text-green-600";
    if (accuracy >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getAccuracyBadgeVariant = (accuracy: number) => {
    if (accuracy >= 80) return "default";
    if (accuracy >= 60) return "secondary";
    return "destructive";
  };

  if (analyticsLoading && isOpen) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Performance Analytics
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2">Loading analytics...</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Performance Analytics
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="sections" data-testid="tab-sections">By Section</TabsTrigger>
            <TabsTrigger value="trends" data-testid="tab-trends">Trends</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[500px] w-full">
            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4">
              {stats ? (
                <>
                  {/* Overall Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Target className="h-4 w-4" />
                          Total Attempts
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold" data-testid="total-attempts">{stats.totalAttempts}</div>
                        <p className="text-xs text-muted-foreground">Questions attempted</p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <CheckCircle className="h-4 w-4" />
                          Correct Answers
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold" data-testid="correct-answers">{stats.correctAnswers}</div>
                        <p className="text-xs text-muted-foreground">Out of {stats.totalAttempts}</p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Overall Accuracy
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className={`text-2xl font-bold ${getAccuracyColor(stats.accuracyRate)}`} data-testid="overall-accuracy">
                          {stats.accuracyRate.toFixed(1)}%
                        </div>
                        <p className="text-xs text-muted-foreground">Current performance</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Strengths and Weaknesses */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Award className="h-5 w-5 text-green-600" />
                          Strengths
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {stats.strengthsWeaknesses.strengths.length > 0 ? (
                          <div className="space-y-2">
                            {stats.strengthsWeaknesses.strengths.map((strength, index) => (
                              <Badge key={index} variant="default" className="mr-2">
                                {strength}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">Work on more practice questions to identify strengths</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <AlertCircle className="h-5 w-5 text-red-600" />
                          Areas to Improve
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {stats.strengthsWeaknesses.weaknesses.length > 0 ? (
                          <div className="space-y-2">
                            {stats.strengthsWeaknesses.weaknesses.map((weakness, index) => (
                              <Badge key={index} variant="destructive" className="mr-2">
                                {weakness}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">Keep practicing to maintain strong performance</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Recommendations */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Lightbulb className="h-5 w-5 text-yellow-600" />
                        Personalized Recommendations
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {stats.strengthsWeaknesses.recommendations.length > 0 ? (
                        <ul className="space-y-2">
                          {stats.strengthsWeaknesses.recommendations.map((rec, index) => (
                            <li key={index} className="flex items-start gap-2">
                              <div className="h-1.5 w-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                              <span className="text-sm">{rec}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground text-sm">Continue practicing to get personalized recommendations</p>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No analytics data available. Start practicing to see your progress!</p>
                </div>
              )}
            </TabsContent>

            {/* Sections Tab */}
            <TabsContent value="sections" className="space-y-4">
              {stats ? (
                <div className="grid gap-4">
                  {[stats.mathStats, stats.readingStats, stats.writingStats].map((sectionStats) => (
                    <Card key={sectionStats.section}>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <BookOpen className="h-5 w-5" />
                            {sectionStats.section}
                          </span>
                          <Badge variant={getAccuracyBadgeVariant(sectionStats.accuracyRate)}>
                            {sectionStats.accuracyRate.toFixed(1)}%
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-4">
                          <div className="flex justify-between text-sm text-muted-foreground mb-1">
                            <span>Progress</span>
                            <span>{sectionStats.correctAnswers}/{sectionStats.totalAttempts}</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div 
                              className="bg-primary h-2 rounded-full transition-all duration-300"
                              style={{ width: `${sectionStats.accuracyRate}%` }}
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div className="text-center">
                            <div className="font-semibold text-green-600">Easy</div>
                            <div>{sectionStats.easyQuestions.accuracyRate.toFixed(1)}%</div>
                            <div className="text-xs text-muted-foreground">
                              {sectionStats.easyQuestions.correctAnswers}/{sectionStats.easyQuestions.totalAttempts}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="font-semibold text-yellow-600">Medium</div>
                            <div>{sectionStats.mediumQuestions.accuracyRate.toFixed(1)}%</div>
                            <div className="text-xs text-muted-foreground">
                              {sectionStats.mediumQuestions.correctAnswers}/{sectionStats.mediumQuestions.totalAttempts}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="font-semibold text-red-600">Hard</div>
                            <div>{sectionStats.hardQuestions.accuracyRate.toFixed(1)}%</div>
                            <div className="text-xs text-muted-foreground">
                              {sectionStats.hardQuestions.correctAnswers}/{sectionStats.hardQuestions.totalAttempts}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No section data available yet.</p>
                </div>
              )}
            </TabsContent>

            {/* Trends Tab */}
            <TabsContent value="trends" className="space-y-4">
              {stats && stats.performanceTrends.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      7-Day Performance Trends
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {stats.performanceTrends.map((trend, index) => (
                        <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{new Date(trend.date).toLocaleDateString()}</span>
                          </div>
                          <div className="flex gap-4 text-sm">
                            <div className="text-center">
                              <div className="font-semibold">Overall</div>
                              <div className={getAccuracyColor(trend.accuracyRate)}>{trend.accuracyRate.toFixed(1)}%</div>
                            </div>
                            <div className="text-center">
                              <div className="font-semibold text-blue-600">Math</div>
                              <div>{trend.mathAccuracy.toFixed(1)}%</div>
                            </div>
                            <div className="text-center">
                              <div className="font-semibold text-green-600">Reading</div>
                              <div>{trend.readingAccuracy.toFixed(1)}%</div>
                            </div>
                            <div className="text-center">
                              <div className="font-semibold text-purple-600">Writing</div>
                              <div>{trend.writingAccuracy.toFixed(1)}%</div>
                            </div>
                          </div>
                          <div className="text-right text-muted-foreground">
                            <div className="text-xs">Attempts</div>
                            <div className="font-semibold">{trend.totalAttempts}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No trend data available. Complete more practice sessions to see trends!</p>
                </div>
              )}
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="space-y-4">
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : history && history.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Recent Activity
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {history.map((attempt) => (
                        <div key={attempt.id} className="flex items-start gap-3 p-3 border rounded-lg" data-testid={`history-item-${attempt.id}`}>
                          <div className="mt-0.5">
                            {attempt.isCorrect ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs">
                                {attempt.section}
                              </Badge>
                              <Badge variant={attempt.difficulty === 'Easy' ? 'default' : attempt.difficulty === 'Medium' ? 'secondary' : 'destructive'} className="text-xs">
                                {attempt.difficulty}
                              </Badge>
                            </div>
                            <p className="text-sm font-medium mb-1">{attempt.questionText}</p>
                            <p className="text-xs text-muted-foreground">
                              {attempt.documentName} • {new Date(attempt.attemptedAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No recent activity found. Start practicing to see your history!</p>
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <div className="flex justify-end pt-4 border-t">
          <Button onClick={onClose} data-testid="button-close-analytics">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}