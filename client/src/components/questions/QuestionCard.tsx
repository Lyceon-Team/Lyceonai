/**
 * QuestionCard - Unified component for rendering SAT practice questions
 * 
 * Clean, consistent layout focused on student-facing practice.
 * Handles both multiple-choice and free-response questions.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, XCircle, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import MathRenderer from '@/components/MathRenderer';
import type { QuestionVM, QuestionOption, ValidationResult } from '@/types/question';

interface QuestionCardProps {
  question: QuestionVM;
  questionNumber?: number;
  selectedAnswer?: string | null;
  freeResponseAnswer?: string;
  showResult?: boolean;
  validationResult?: ValidationResult | null;
  onAnswerSelect?: (answer: string) => void;
  onFreeResponseChange?: (answer: string) => void;
  onSubmit?: () => void;
  onNext?: () => void;
  onFeedback?: (rating: 'up' | 'down') => void;
  isSubmitting?: boolean;
  feedbackSubmitted?: 'up' | 'down' | null;
  className?: string;
}

export function QuestionCard({
  question,
  questionNumber,
  selectedAnswer = null,
  freeResponseAnswer = '',
  showResult = false,
  validationResult,
  onAnswerSelect,
  onFreeResponseChange,
  onSubmit,
  onNext,
  onFeedback,
  isSubmitting = false,
  feedbackSubmitted = null,
  className = '',
}: QuestionCardProps) {
  const isMultipleChoice = question.type === 'mc' && question.options.length > 0;
  const isFreeResponse = question.type === 'fr' || question.options.length === 0;
  const canSubmit = isMultipleChoice ? !!selectedAnswer : freeResponseAnswer.trim().length > 0;

  const sectionLabel = question.section || question.sectionCode || 'SAT Practice';

  return (
    <motion.section
      layout
      className={`p-6 rounded-2xl bg-white shadow-lg ${className}`}
      data-testid="question-card"
    >
      {questionNumber !== undefined && (
        <h2 className="text-base text-neutral-500 mb-1" data-testid="question-meta">
          Question {questionNumber} · {sectionLabel}
        </h2>
      )}

      <div className="prose max-w-none mb-6">
        <div className="text-lg md:text-xl font-semibold text-neutral-900 leading-relaxed" data-testid="question-stem">
          <MathRenderer 
            content={question.stem} 
            className="whitespace-pre-wrap"
            displayMode={false}
          />
        </div>
      </div>

      {isMultipleChoice && (
        <div className="space-y-3" data-testid="answer-options">
          {question.options.map((option: QuestionOption) => {
            const isSelected = selectedAnswer === option.key;
            const isCorrect = showResult && validationResult?.correctAnswerKey === option.key;
            const isIncorrect = showResult && isSelected && !validationResult?.isCorrect;

            return (
              <motion.button
                key={option.key}
                onClick={() => !showResult && !isSubmitting && onAnswerSelect?.(option.key)}
                disabled={showResult || isSubmitting}
                className={`
                  w-full text-left p-4 rounded-xl border-2 transition-all
                  ${showResult
                    ? isCorrect
                      ? 'border-green-500 bg-green-50'
                      : isIncorrect
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-slate-200 bg-white opacity-60'
                    : isSelected
                    ? 'border-brand-navy bg-brand-navy/5 ring-1 ring-brand-navy shadow-sm'
                    : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
                  }
                  ${showResult ? 'cursor-default' : 'cursor-pointer'}
                `}
                data-testid={`option-${option.key.toLowerCase()}`}
                whileHover={!showResult ? { scale: 1.01 } : {}}
                whileTap={!showResult ? { scale: 0.99 } : {}}
              >
                <div className="flex items-center gap-3">
                  <div className={`
                    flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold
                    ${showResult
                      ? isCorrect
                        ? 'bg-green-500 text-white'
                        : isIncorrect
                        ? 'bg-amber-500 text-white'
                        : 'bg-slate-200 text-slate-600'
                      : isSelected
                      ? 'bg-brand-navy text-white'
                      : 'bg-slate-100 text-slate-600'
                    }
                  `}>
                    {showResult && isCorrect ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : showResult && isIncorrect ? (
                      <XCircle className="h-5 w-5" />
                    ) : (
                      option.key
                    )}
                  </div>
                  <div className={`flex-1 ${
                    showResult
                      ? isCorrect ? 'text-green-900' : isIncorrect ? 'text-amber-900' : 'text-slate-600'
                      : isSelected ? 'text-brand-navy font-medium' : 'text-slate-900'
                  }`}>
                    <MathRenderer content={option.text} displayMode={false} />
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      {isFreeResponse && (
        <div className="space-y-3">
          <label htmlFor="free-response-input" className="block text-sm font-medium text-slate-700">
            Enter your answer:
          </label>
          <Textarea
            id="free-response-input"
            placeholder="Type your answer here..."
            value={freeResponseAnswer}
            onChange={(e) => !showResult && !isSubmitting && onFreeResponseChange?.(e.target.value)}
            disabled={showResult || isSubmitting}
            rows={4}
            className="w-full border-slate-200 focus:border-brand-navy focus:ring-brand-navy"
            data-testid="input-free-response"
          />
          {showResult && validationResult && (
            <div className={`p-4 rounded-xl border ${validationResult.isCorrect ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className={validationResult.isCorrect ? 'text-green-800' : 'text-amber-800'}>
                {validationResult.feedback || (validationResult.isCorrect ? 'Correct!' : 'Incorrect')}
              </p>
            </div>
          )}
        </div>
      )}

      {!showResult && onSubmit && (
        <div className="flex justify-end pt-6">
          <Button
            onClick={onSubmit}
            disabled={!canSubmit || isSubmitting}
            className="px-6 py-2 bg-brand-navy hover:bg-brand-navy/90 text-white font-medium rounded-lg"
            data-testid="button-submit-answer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit Answer'
            )}
          </Button>
        </div>
      )}

      {showResult && question.explanation && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 p-5 bg-blue-50 rounded-xl border border-blue-100"
        >
          <h4 className="font-semibold text-blue-900 mb-2">Explanation</h4>
          <p className="text-blue-800 whitespace-pre-wrap leading-relaxed">
            {question.explanation}
          </p>
        </motion.div>
      )}

      {showResult && (onFeedback || onNext) && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-6">
          {onFeedback && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Was this question helpful?</span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onFeedback('up')}
                  disabled={feedbackSubmitted !== null}
                  className={`p-2 rounded-lg transition-all ${
                    feedbackSubmitted === 'up'
                      ? 'bg-green-100 text-green-600'
                      : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
                  }`}
                  data-testid="button-feedback-up"
                >
                  <ThumbsUp className={`h-4 w-4 ${feedbackSubmitted === 'up' ? 'fill-current' : ''}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onFeedback('down')}
                  disabled={feedbackSubmitted !== null}
                  className={`p-2 rounded-lg transition-all ${
                    feedbackSubmitted === 'down'
                      ? 'bg-amber-100 text-amber-700'
                      : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
                  }`}
                  data-testid="button-feedback-down"
                >
                  <ThumbsDown className={`h-4 w-4 ${feedbackSubmitted === 'down' ? 'fill-current' : ''}`} />
                </Button>
              </div>
            </div>
          )}
          
          {onNext && (
            <Button
              onClick={onNext}
              className="px-6 py-2 bg-brand-navy hover:bg-brand-navy/90 text-white font-medium rounded-lg"
              data-testid="button-next-question"
            >
              Next Question
            </Button>
          )}
        </div>
      )}
    </motion.section>
  );
}

export default QuestionCard;
