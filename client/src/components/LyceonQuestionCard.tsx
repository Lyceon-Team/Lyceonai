import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";

interface LyceonQuestionCardProps {
  questionNumber: number;
  section: string;
  stem: string;
  options: string[];
  onSubmit?: (answer: string) => void;
  showFeedback?: boolean;
  correctAnswer?: string;
  userAnswer?: string;
}

export default function LyceonQuestionCard({
  questionNumber,
  section,
  stem,
  options = ['A. 3', 'B. 4', 'C. 5', 'D. 6'],
  onSubmit,
  showFeedback = false,
  correctAnswer,
  userAnswer
}: LyceonQuestionCardProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(userAnswer || null);

  const handleSubmit = () => {
    if (selectedAnswer && onSubmit) {
      onSubmit(selectedAnswer);
    }
  };

  const isCorrect = showFeedback && selectedAnswer === correctAnswer;
  const isIncorrect = showFeedback && selectedAnswer !== correctAnswer;

  return (
    <motion.section
      layout
      className="p-6 rounded-2xl bg-card border border-border shadow-md"
      data-testid="lyceon-question-card"
    >
      <h2 className="text-base text-muted-foreground mb-1 font-medium" data-testid="question-meta">
        Question {questionNumber} · {section}
      </h2>
      <p className="text-lg font-medium mb-6 text-foreground leading-relaxed" data-testid="question-stem">
        {stem}
      </p>

      <div className="space-y-3" data-testid="answer-options">
        {options.map((opt, idx) => {
          const optionLetter = opt.charAt(0);
          const isSelected = selectedAnswer === optionLetter;
          const isCorrectOption = showFeedback && optionLetter === correctAnswer;
          const isWrongSelection = showFeedback && isSelected && !isCorrect;

          return (
            <motion.button
              key={opt}
              onClick={() => !showFeedback && setSelectedAnswer(optionLetter)}
              className={`
                w-full text-left p-4 rounded-xl border-2 transition-all
                ${isSelected && !showFeedback ? 'border-border bg-secondary' : 'border-border bg-background'}
                ${isCorrectOption ? 'border-green-600 bg-green-50' : ''}
                ${isWrongSelection ? 'border-amber-500 bg-amber-50' : ''}
                ${!showFeedback ? 'hover:border-warm-gray-700 hover:bg-secondary' : ''}
              `}
              disabled={showFeedback}
              data-testid={`option-${optionLetter.toLowerCase()}`}
              whileHover={!showFeedback ? { scale: 1.01 } : {}}
              whileTap={!showFeedback ? { scale: 0.99 } : {}}
            >
              <div className="flex items-center justify-between">
                <span className="text-foreground">{opt}</span>
                {isCorrectOption && (
                  <CheckCircle className="h-5 w-5 text-green-600" data-testid="correct-icon" />
                )}
                {isWrongSelection && (
                  <XCircle className="h-5 w-5 text-amber-500" data-testid="incorrect-icon" />
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      {!showFeedback && (
        <Button
          onClick={handleSubmit}
          disabled={!selectedAnswer}
          className="mt-6 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          data-testid="submit-answer"
        >
          Submit
        </Button>
      )}

      {showFeedback && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-6 p-4 rounded-xl ${isCorrect ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}
          data-testid="feedback-message"
        >
          <p className={`text-sm font-medium ${isCorrect ? 'text-green-700' : 'text-amber-700'}`}>
            {isCorrect ? '✓ Correct!' : `✗ Incorrect. The correct answer is ${correctAnswer}.`}
          </p>
        </motion.div>
      )}
    </motion.section>
  );
}
