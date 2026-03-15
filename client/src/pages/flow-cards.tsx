import { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Heart, BookOpen, Calculator, Zap, CheckCircle, XCircle, Flame, RotateCcw, ChevronLeft, MessageCircle } from "lucide-react";
import { Link } from "wouter";
import { QuestionRenderer } from "@/components/question-renderer";
import { useAdaptivePractice } from "@/hooks/use-adaptive-practice";
import { PracticeErrorBoundary } from "@/components/PracticeErrorBoundary";
import type { StudentQuestion, StudentMcQuestion } from "@shared/schema";

interface FlowCardsProps {
  section?: string;
  difficulty?: string;
}

function FlowCards({ section = 'mixed', difficulty = 'adaptive' }: FlowCardsProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [freeResponseAnswer, setFreeResponseAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [isFlipped, setIsFlipped] = useState(false);
  const [isAutoSubmitting, setIsAutoSubmitting] = useState(false);
  const [autoSubmitTimer, setAutoSubmitTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [touchEnd, setTouchEnd] = useState<{ x: number; y: number } | null>(null);
  const [showTutorial, setShowTutorial] = useState(true);
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'none' | 'up' | 'down'>('none');
  const [started, setStarted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const sectionNormalized = section === 'math' ? 'math' : 'rw';
  
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
  } = useAdaptivePractice({
    section: sectionNormalized,
    mode: 'flow',
  });

  useEffect(() => {
    if (!started) {
      const timer = setTimeout(() => {
        startSession().then(() => setStarted(true));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [started, startSession]);

  useEffect(() => {
    return () => {
      if (autoSubmitTimer) {
        clearTimeout(autoSubmitTimer);
      }
    };
  }, [autoSubmitTimer]);

  const handleAnswerSelect = (answerKey: string) => {
    if (showResult || isAutoSubmitting) return;
    
    if (autoSubmitTimer) {
      clearTimeout(autoSubmitTimer);
    }
    
    setSelectedAnswer(answerKey);
    setIsAutoSubmitting(true);
    
    const timer = setTimeout(() => {
      handleSubmit();
    }, 500);
    
    setAutoSubmitTimer(timer);
  };

  const handleFreeResponseChange = (answer: string) => {
    if (showResult || isAutoSubmitting) return;
    setFreeResponseAnswer(answer);
    
    if (autoSubmitTimer) {
      clearTimeout(autoSubmitTimer);
    }
    
    if (answer.trim().length > 0) {
      setIsAutoSubmitting(true);
      const timer = setTimeout(() => {
        handleSubmit();
      }, 700);
      setAutoSubmitTimer(timer);
    } else {
      setIsAutoSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!currentQuestion || showResult) return;
    
    if (autoSubmitTimer) {
      clearTimeout(autoSubmitTimer);
      setAutoSubmitTimer(null);
    }
    
    const timeSpent = Date.now() - startTime;
    
    await submitAnswer(
      selectedAnswer || undefined,
      freeResponseAnswer || undefined,
      timeSpent
    );
    
    setShowResult(true);
    setIsAutoSubmitting(false);
    
    setTimeout(() => setIsFlipped(true), 100);
  };

  const handleNext = async () => {
    if (isTransitioning) return;
    
    setIsTransitioning(true);
    setSlideDirection('up');
    
    setTimeout(async () => {
      await fetchNextQuestion(sessionId || undefined);
      
      setSelectedAnswer(null);
      setFreeResponseAnswer("");
      setShowResult(false);
      setIsFlipped(false);
      setStartTime(Date.now());
      setSlideDirection('none');
      setIsTransitioning(false);
    }, 300);
  };

  const handleSkip = async () => {
    if (isTransitioning || !currentQuestion) return;
    
    setIsTransitioning(true);
    setSlideDirection('down');
    
    const timeSpent = Date.now() - startTime;
    await skipQuestion(timeSpent);
    
    setTimeout(async () => {
      await fetchNextQuestion(sessionId || undefined);
      
      setSelectedAnswer(null);
      setFreeResponseAnswer("");
      setShowResult(false);
      setIsFlipped(false);
      setStartTime(Date.now());
      setSlideDirection('none');
      setIsTransitioning(false);
    }, 300);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart) return;
    setTouchEnd({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    
    const deltaY = touchStart.y - e.touches[0].clientY;
    const progress = Math.min(Math.abs(deltaY) / 100, 1);
    setSwipeProgress(progress * (deltaY > 0 ? 1 : -1));
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) {
      setSwipeProgress(0);
      return;
    }
    
    const deltaY = touchStart.y - touchEnd.y;
    const minSwipeDistance = 50;
    
    if (Math.abs(deltaY) > minSwipeDistance) {
      if (deltaY > 0 && showResult) {
        handleNext();
      } else if (deltaY < 0 && !showResult) {
        handleSkip();
      }
    }
    
    setTouchStart(null);
    setTouchEnd(null);
    setSwipeProgress(0);
  };

  if (exhausted) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center p-8">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-[#0F2E48] mb-2">All Done!</h2>
          <p className="text-gray-600 mb-4">
            You've completed all available questions in this section.
          </p>
          <div className="flex gap-4 justify-center">
            <p className="text-lg">
              Score: {score.correct}/{score.total} ({score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0}%)
            </p>
          </div>
          <Link href="/practice">
            <Button className="mt-6 bg-[#0F2E48]">Back to Practice</Button>
          </Link>
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

  if (error) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center p-8">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#0F2E48] mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={() => startSession()} className="bg-[#0F2E48]">
            <RotateCcw className="w-4 h-4 mr-2" /> Try Again
          </Button>
        </Card>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#0F2E48]">No question available</p>
          <Button onClick={() => startSession()} className="mt-4 bg-[#0F2E48]">
            Start Practice
          </Button>
        </div>
      </div>
    );
  }

  const isMcQuestion = currentQuestion.question_type === 'multiple_choice' || (Array.isArray((currentQuestion as any).options) && (currentQuestion as any).options.length > 0);

  return (
    <div 
      className="min-h-screen bg-[#FFFAEF] flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <header className="p-4 flex items-center justify-between border-b border-gray-200">
        <Link href="/practice">
          <Button variant="ghost" size="sm">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </Link>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Flame className="w-5 h-5 text-orange-500" />
            <span className="font-semibold text-[#0F2E48]">{score.streak}</span>
          </div>
          <div className="flex items-center gap-1">
            <Heart className="w-5 h-5 text-red-500" />
            <span className="font-semibold text-[#0F2E48]">{score.correct}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div
          ref={cardRef}
          className={`w-full max-w-lg transition-transform duration-300 ${
            slideDirection === 'up' ? '-translate-y-full opacity-0' :
            slideDirection === 'down' ? 'translate-y-full opacity-0' : ''
          }`}
          style={{
            transform: swipeProgress !== 0 ? `translateY(${-swipeProgress * 50}px)` : undefined
          }}
        >
          <Card className={`overflow-hidden transition-all duration-500 ${isFlipped ? 'bg-[#0F2E48] text-white' : 'bg-white'}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Badge variant={sectionNormalized === 'math' ? 'default' : 'secondary'}>
                  {sectionNormalized === 'math' ? (
                    <><Calculator className="w-3 h-3 mr-1" /> Math</>
                  ) : (
                    <><BookOpen className="w-3 h-3 mr-1" /> Reading & Writing</>
                  )}
                </Badge>
                {(currentQuestion as any).difficulty && (
                  <Badge variant="outline">{(currentQuestion as any).difficulty}</Badge>
                )}
              </div>
            </CardHeader>
            
            <CardContent className="pt-4">
              {!isFlipped ? (
                <div className="space-y-4">
                  <QuestionRenderer
                    question={currentQuestion}
                    questionIndex={score.total}
                    selectedAnswer={selectedAnswer}
                    freeResponseAnswer={freeResponseAnswer}
                    onAnswerSelect={handleAnswerSelect}
                    onFreeResponseChange={handleFreeResponseChange}
                    showResult={false}
                    validationResult={null}
                    hideActions={true}
                  />
                  
                  {!isMcQuestion && freeResponseAnswer.trim() && !isAutoSubmitting && (
                    <Button 
                      onClick={handleSubmit} 
                      className="w-full bg-[#0F2E48]"
                      disabled={isSubmitting}
                    >
                      Submit Answer
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    {validationResult?.isCorrect ? (
                      <><CheckCircle className="w-6 h-6 text-green-400" /> <span className="font-bold">Correct!</span></>
                    ) : (
                      <><XCircle className="w-6 h-6 text-red-400" /> <span className="font-bold">Incorrect</span></>
                    )}
                  </div>
                  
                  {validationResult?.correctAnswerKey && (
                    <p className="text-sm opacity-90">
                      Correct answer: <strong>{validationResult.correctAnswerKey}</strong>
                    </p>
                  )}
                  
                  {validationResult?.explanation && (
                    <div className="mt-4 p-4 bg-white/10 rounded-lg">
                      <p className="text-sm">{validationResult.explanation}</p>
                    </div>
                  )}
                  
                  <Button 
                    onClick={handleNext}
                    className="w-full bg-white text-[#0F2E48] hover:bg-gray-100 mt-4"
                    disabled={isTransitioning}
                  >
                    Next Question <Zap className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {showTutorial && !showResult && (
        <div className="fixed bottom-20 left-0 right-0 flex justify-center">
          <div className="bg-[#0F2E48] text-white px-4 py-2 rounded-full text-sm animate-bounce">
            Swipe down to skip
          </div>
        </div>
      )}

      <footer className="p-4 border-t border-gray-200">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <span className="text-sm text-gray-600">
            Question {score.total + 1}
          </span>
          <span className="text-sm text-gray-600">
            {score.correct}/{score.total} correct
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function FlowCardsPage() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get('section') || 'mixed';
  const difficulty = params.get('difficulty') || 'adaptive';
  
  return (
    <PracticeErrorBoundary>
      <FlowCards section={section} difficulty={difficulty} />
    </PracticeErrorBoundary>
  );
}

