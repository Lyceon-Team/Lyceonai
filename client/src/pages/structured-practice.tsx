import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Timer, Clock, CheckCircle, XCircle, ArrowLeft, ArrowRight, Flag } from 'lucide-react';
import { useAdaptivePractice, SectionType } from '@/hooks/use-adaptive-practice';
import { useTimer } from '@/hooks/useTimer';
import { useToast } from '@/hooks/use-toast';
import { PracticeErrorBoundary } from '@/components/PracticeErrorBoundary';
import { QuestionRenderer } from '@/components/question-renderer';

interface StructuredPracticeProps {
  section?: string;
  difficulty?: string;
}

function StructuredPractice({ section = 'rw', difficulty = 'medium' }: StructuredPracticeProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [freeResponseAnswer, setFreeResponseAnswer] = useState("");
  const [showExplanation, setShowExplanation] = useState(false);
  const [isAnswered, setIsAnswered] = useState(false);
  const [startTime, setStartTime] = useState<number>(Date.now());

  const sectionNormalized: SectionType = section.toLowerCase().includes('math') ? 'math' : 'rw';

  const timer = useTimer({ 
    duration: 20 * 60 * 1000,
    autoStart: false,
    onExpire: () => {
      if (isSessionActive) {
        handleEndSession();
      }
    }
  });
  
  const {
    sessionId,
    currentQuestion,
    isLoading,
    isSubmitting,
    error,
    validationResult,
    score,
    exhausted,
    fetchNextQuestion,
    submitAnswer,
    skipQuestion,
    startSession,
    endSession,
  } = useAdaptivePractice({
    section: sectionNormalized,
    mode: 'structured',
  });

  const handleStartSession = async () => {
    try {
      await startSession();
      setIsSessionActive(true);
      timer.start();
      setStartTime(Date.now());
      toast({
        title: "Practice session started!",
        description: "You have 20 minutes to complete as many questions as possible."
      });
    } catch (error) {
      console.error('Session start failed:', error);
      toast({
        title: "Failed to start session",
        description: "Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleSubmitAnswer = async () => {
    if (!currentQuestion) return;

    const timeSpent = Date.now() - startTime;
    await submitAnswer(selectedAnswer || undefined, freeResponseAnswer || undefined, timeSpent);
    setIsAnswered(true);
    setShowExplanation(true);
  };


  const handleNextQuestion = async () => {
    await fetchNextQuestion(sessionId || undefined);
    setSelectedAnswer(null);
    setFreeResponseAnswer("");
    setShowExplanation(false);
    setIsAnswered(false);
    setStartTime(Date.now());
  };

  const handleSkip = async () => {
    if (!currentQuestion || !sessionId) return;
    // Use real skipQuestion and fetchNextQuestion logic
    await skipQuestion(0);
    await fetchNextQuestion(sessionId);
    setSelectedAnswer(null);
    setFreeResponseAnswer("");
    setShowExplanation(false);
    setIsAnswered(false);
    setStartTime(Date.now());
  };

  const handleEndSession = async () => {
    timer.pause();
    setIsSessionActive(false);
    await endSession();
    toast({
      title: "Session Complete!",
      description: `You answered ${score.correct} out of ${score.total} questions correctly.`
    });
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isSessionActive) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-[#0F2E48]">Structured Practice</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center space-y-2">
              <Clock className="w-12 h-12 text-[#0F2E48] mx-auto" />
              <p className="text-gray-600">
                Complete as many questions as you can in 20 minutes.
              </p>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Section:</span>
                <Badge>{sectionNormalized === 'math' ? 'Math' : 'Reading & Writing'}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Time Limit:</span>
                <span className="font-medium">20 minutes</span>
              </div>
            </div>
            
            <Button 
              onClick={handleStartSession} 
              className="w-full bg-[#0F2E48] text-white"
              disabled={isLoading}
            >
              {isLoading ? 'Starting...' : 'Start Practice'}
            </Button>
            
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => setLocation('/practice')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Practice
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (exhausted) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center p-8">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-[#0F2E48] mb-2">All Done!</h2>
          <p className="text-gray-600 mb-4">
            You've completed all available questions.
          </p>
          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <p className="text-lg font-medium text-[#0F2E48]">
              Final Score: {score.correct}/{score.total}
            </p>
            <p className="text-gray-600">
              Accuracy: {score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0}%
            </p>
          </div>
          <Button onClick={() => setLocation('/practice')} className="bg-[#0F2E48]">
            Back to Practice
          </Button>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center p-8">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#0F2E48] mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={handleStartSession} className="bg-[#0F2E48]">
            Try Again
          </Button>
        </Card>
      </div>
    );
  }

  if (isLoading && !currentQuestion) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0F2E48] mx-auto mb-4"></div>
          <p className="text-[#0F2E48]">Loading question...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFAEF]">
      <header className="bg-white border-b border-gray-200 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setLocation('/practice')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="font-semibold text-[#0F2E48]">Structured Practice</h1>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Timer className={`w-5 h-5 ${timer.remainingMs < 60000 ? 'text-red-500' : 'text-[#0F2E48]'}`} />
              <span className={`font-mono font-medium ${timer.remainingMs < 60000 ? 'text-red-500' : 'text-[#0F2E48]'}`}>
                {formatTime(timer.remainingMs)}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="font-medium text-[#0F2E48]">{score.correct}/{score.total}</span>
            </div>
            
            <Button variant="outline" size="sm" onClick={handleEndSession}>
              <Flag className="w-4 h-4 mr-1" /> End
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <div className="mb-4">
          <Progress value={(score.total / 15) * 100} className="h-2" />
          <p className="text-sm text-gray-500 mt-1">Question {score.total + 1} of ~15</p>
        </div>

        {currentQuestion && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <Badge variant={sectionNormalized === 'math' ? 'default' : 'secondary'}>
                  {sectionNormalized === 'math' ? 'Math' : 'Reading & Writing'}
                </Badge>
                {(currentQuestion as any).difficulty && (
                  <Badge variant="outline">{(currentQuestion as any).difficulty}</Badge>
                )}
              </div>
            </CardHeader>
            
            <CardContent className="space-y-6">
              <QuestionRenderer
                question={currentQuestion}
                selectedAnswer={selectedAnswer}
                onSelectAnswer={(answer) => { if (!isAnswered) setSelectedAnswer(answer); }}
                freeResponseAnswer={freeResponseAnswer}
                onFreeResponseAnswerChange={(answer) => { if (!isAnswered) setFreeResponseAnswer(answer); }}
                showResult={showExplanation}
              />

              {showExplanation && validationResult && (
                <div className={`p-4 rounded-lg ${validationResult.isCorrect ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {validationResult.isCorrect ? (
                      <><CheckCircle className="w-5 h-5 text-green-600" /> <span className="font-medium text-green-800">Correct!</span></>
                    ) : (
                      <><XCircle className="w-5 h-5 text-red-600" /> <span className="font-medium text-red-800">Incorrect</span></>
                    )}
                  </div>
                  {validationResult.correctAnswerKey && !validationResult.isCorrect && (
                    <p className="text-sm text-gray-700 mb-2">
                      The correct answer is: <strong>{validationResult.correctAnswerKey}</strong>
                    </p>
                  )}
                  {validationResult.explanation && (
                    <p className="text-sm text-gray-600">{validationResult.explanation}</p>
                  )}
                </div>
              )}

              <div className="flex gap-4">
                {!isAnswered ? (
                  <>
                    <Button 
                      variant="outline" 
                      onClick={handleSkip}
                      disabled={isSubmitting}
                      className="flex-1"
                    >
                      Skip
                    </Button>
                    <Button 
                      onClick={handleSubmitAnswer}
                      disabled={!selectedAnswer && !freeResponseAnswer.trim() || isSubmitting}
                      className="flex-1 bg-[#0F2E48]"
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit'}
                    </Button>
                  </>
                ) : (
                  <Button 
                    onClick={handleNextQuestion}
                    className="w-full bg-[#0F2E48]"
                    disabled={isLoading}
                  >
                    Next Question <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

export default function StructuredPracticePage() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get('section') || 'rw';
  const difficulty = params.get('difficulty') || 'medium';
  
  return (
    <PracticeErrorBoundary>
      <StructuredPractice section={section} difficulty={difficulty} />
    </PracticeErrorBoundary>
  );
}
